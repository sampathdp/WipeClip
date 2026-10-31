// Minimal Chrome DevTools Protocol driver for the manual browser checks
// (Node built-ins only: child_process, fetch, WebSocket).
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function ffmpegPath() {
  return execFileSync("backend/.venv/Scripts/python.exe", ["-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"]).toString().trim();
}

/** `args`: extra Chrome flags, e.g. --host-resolver-rules to take hosts offline. */
export async function launch({ port = 9333, chrome = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", args = [] } = {}) {
  const proc = spawn(chrome, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "cdp-"))}`,
    "--window-size=1600,1000", "--autoplay-policy=no-user-gesture-required", "--no-first-run", ...args, "about:blank",
  ]);
  return connect({ port, proc });
}

/** Attach to an already running page with a DevTools port (e.g. the
 * desktop app's WebView2 started with --remote-debugging-port). */
export async function connect({ port, proc = null }) {
  let wsUrl = null;
  for (let i = 0; i < 100 && !wsUrl; i++) {
    try {
      // WebView2 may listen on IPv4 or only on IPv6 loopback.
      for (const host of ["127.0.0.1", "[::1]"]) {
        if (wsUrl) break;
        try {
          wsUrl = (await (await fetch(`http://${host}:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl ?? null;
        } catch {}
      }
    } catch {}
    if (!wsUrl) await sleep(200);
  }
  if (!wsUrl) throw new Error("Chrome didn't start");
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => (ws.onopen = r));
  let nextId = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    } else if (msg.method) listeners.forEach((l) => l(msg));
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++nextId, { resolve, reject });
      ws.send(JSON.stringify({ id: nextId, method, params }));
    });
  const errors = [];
  listeners.push((m) => {
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      errors.push(d.exception?.description ?? (d.exception?.value !== undefined ? `${d.text} ${JSON.stringify(d.exception.value)}` : `${d.text} at ${d.url ?? ""}:${d.lineNumber}`));
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  });
  await send("Runtime.enable");
  await send("Page.enable");
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800));
    return r.result.value;
  };
  const goto = async (u) => {
    const loaded = new Promise((r) => listeners.push((m) => m.method === "Page.loadEventFired" && r()));
    await send("Page.navigate", { url: u });
    await loaded;
    await sleep(1500);
    // Seeding needs the editor's database at its current version; a
    // production build can create it a little later than the load event.
    for (let i = 0; i < 100; i++) {
      const ready = await evaluate(`indexedDB.databases().then((ds) => ds.some((d) => d.name === "wipeclip-editor" && d.version >= 2))`);
      if (ready) break;
      await sleep(150);
    }
  };
  const key = async (k, code, vk, modifiers = 0) => {
    for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: vk, modifiers });
    await sleep(60);
  };
  /** Clicks an enabled button: exact text first, then text prefix, then aria-label/title prefix. */
  const click = (text) =>
    evaluate(`(() => { const t = ${JSON.stringify(text)}; const bs = [...document.querySelectorAll("button")].filter(b => !b.disabled); const b = bs.find(b => b.textContent.trim() === t) ?? bs.find(b => b.textContent.trim().startsWith(t)) ?? bs.find(b => (b.getAttribute("aria-label") || b.title || "").startsWith(t)); b?.click(); return !!b; })()`);
  /** Saves a project the editor lists under Recent projects (as "Seeded
   * project", opened with its "Open" button). Open the editor page once
   * first, so its database exists at the current version. */
  const seedProject = (videoB64, project, sourceMeta, recording) =>
    evaluate(`(async () => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(videoB64)}), c => c.charCodeAt(0));
      // Opened at the editor's schema version (projectStore.ts), stores created if the page hasn't yet.
      const db = await new Promise((res, rej) => { const r = indexedDB.open("wipeclip-editor", 2); r.onupgradeneeded = () => { for (const n of ["project", "sources", "projects"]) if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const put = (store, value, key) => new Promise((res, rej) => { const tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(value, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
      await put("sources", new Blob([bytes], { type: "video/mp4" }), ${JSON.stringify(sourceMeta.id)});
      ${recording ? `await put("sources", ${JSON.stringify(recording)}, ${JSON.stringify(sourceMeta.id + "#recording")});` : ""}
      await put("projects", { id: "prj_seed", name: "Seeded project", createdAt: Date.now(), project: ${JSON.stringify(project)}, sources: [${JSON.stringify(sourceMeta)}], savedAt: Date.now() }, "prj_seed");
      db.close();
    })()`);
  /** Color names of the preview stage at fractions, from a screenshot. */
  const stageColors = async (points, savePath) => {
    const clip = await evaluate(`(() => { const s = document.querySelector("video").closest(".rounded-xl").getBoundingClientRect(); return { x: s.x, y: s.y, width: s.width, height: s.height }; })()`);
    const { data } = await send("Page.captureScreenshot", { format: "png", clip: { ...clip, scale: 1 } });
    if (savePath) (await import("node:fs")).writeFileSync(savePath, Buffer.from(data, "base64"));
    return evaluate(`(async () => {
      const img = new Image(); img.src = "data:image/png;base64,${data}"; await img.decode();
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      const g = c.getContext("2d"); g.drawImage(img, 0, 0);
      return ${JSON.stringify(points)}.map(([fx, fy]) => [...g.getImageData(Math.round(fx * (img.width - 1)), Math.round(fy * (img.height - 1)), 1, 1).data].slice(0, 3));
    })()`);
  };
  const close = () => {
    ws.close();
    proc?.kill();
  };
  return { send, evaluate, goto, key, click, seedProject, stageColors, errors, close };
}
