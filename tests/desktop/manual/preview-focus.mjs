// Manual end-to-end check of focus zooms and pointer effects in the real
// editor preview (not part of `npm run desktop:test:js`: needs Chrome and a
// running dev server).
//
//   npx next dev -p 3005            (website)  - in one terminal
//   node tests/desktop/manual/preview-focus.mjs http://localhost:3005/editor out-dir
//
// It makes a 4-color test video with ffmpeg (from the backend venv), stores
// a saved project in the editor's IndexedDB - a synthetic screen recording
// with one zoom on the red quadrant and one left click - resumes it in
// headless Chrome over the DevTools protocol, steps the playhead and
// checks/screenshots the preview stage. Uses only Node built-ins.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const url = process.argv[2] ?? "http://localhost:3005/editor";
const outDir = resolve(process.argv[3] ?? join(tmpdir(), "wipeclip-preview-focus"));
mkdirSync(outDir, { recursive: true });
const chrome = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ffmpeg = execFileSync("backend/.venv/Scripts/python.exe", ["-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"]).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const video = join(outDir, "quad.mp4");
const q = "s=320x180:r=30:d=6";
execFileSync(ffmpeg, [
  "-y", "-loglevel", "error", "-filter_complex",
  `color=red:${q}[a];color=lime:${q}[b];color=blue:${q}[c];color=white:${q}[d];[a][b][c][d]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0,format=yuv420p[v]`,
  "-map", "[v]", "-c:v", "libx264", "-profile:v", "baseline", "-movflags", "+faststart", video,
]);

const port = 9333;
const proc = spawn(chrome, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "cdp-"))}`,
  "--window-size=1600,1000", "--autoplay-policy=no-user-gesture-required", "--no-first-run", "about:blank",
]);

async function pageSocket() {
  for (let i = 0; i < 50; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error("Chrome didn't start");
}
const ws = new WebSocket(await pageSocket());
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
  new Promise((res, rej) => {
    pending.set(++nextId, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: nextId, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800));
  return r.result.value;
};
const errors = [];
listeners.push((m) => {
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
});
await send("Runtime.enable");
await send("Page.enable");
async function goto(u) {
  const loaded = new Promise((r) => listeners.push((m) => m.method === "Page.loadEventFired" && r()));
  await send("Page.navigate", { url: u });
  await loaded;
  await sleep(1500);
}

// --- the saved project ---------------------------------------------------------------
const recording = {
  trackKind: "screen",
  folder: "C:/rec",
  events: [
    { type: "move", t: 0, x: 0.5, y: 0.5 },
    { type: "move", t: 1900, x: 0.3, y: 0.3 },
    { type: "button", t: 2000, button: "left", down: true, x: 0.3, y: 0.3 },
    { type: "button", t: 2050, button: "left", down: false, x: 0.3, y: 0.3 },
  ],
  manifest: { format: "wipeclip.recording", version: 1, capture: { surface: "monitor", coordinateSpace: "capture", cursorCaptured: false, region: null, video: { width: 320, height: 180, frameRate: 30 } }, tracks: [] },
};
const project = {
  clips: [{ id: "clip_1", sourceId: "src_1", start: 0, end: 6 }],
  overlays: [],
  audio: [],
  effects: [],
  zooms: [{ id: "zm_1", sourceId: "src_1", start: 1, end: 4.5, zoom: 2, x: 0.25, y: 0.25, easeIn: 0.5, easeOut: 0.5, ease: "smooth", enabled: true, auto: false, reason: "Test click" }],
  pointer: { cursor: true, cursorSize: 0.08, cursorColor: "#ffffff", smoothing: 0.5, clicks: true, leftColor: "#22d3ee", rightColor: "#f59e0b", ringSize: 0.1, ringDuration: 1.5, intensity: 1 },
};

await goto(url);
await evaluate(`(async () => {
  const bytes = Uint8Array.from(atob(${JSON.stringify(readFileSync(video).toString("base64"))}), c => c.charCodeAt(0));
  const db = await new Promise((res, rej) => { const r = indexedDB.open("wipeclip-editor", 1); r.onupgradeneeded = () => { r.result.createObjectStore("project"); r.result.createObjectStore("sources"); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const put = (store, value, key) => new Promise((res, rej) => { const tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(value, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  await put("sources", new Blob([bytes], { type: "video/mp4" }), "src_1");
  await put("sources", ${JSON.stringify(recording)}, "src_1#recording");
  await put("project", { project: ${JSON.stringify(project)}, sources: [{ id: "src_1", kind: "original", duration: 6, width: 320, height: 180, fps: 30, hasAudio: false, name: "quad.mp4", type: "video/mp4" }], savedAt: Date.now() }, "current");
  db.close();
})()`);
await goto(url);
if (!(await evaluate(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Resume"); b?.click(); return !!b; })()`))) {
  throw new Error("No Resume button - the saved project wasn't picked up.");
}
await sleep(3000);

// --- step and check ------------------------------------------------------------------
const playhead = () =>
  evaluate(`[...document.querySelectorAll("*")].map(e => e.childNodes[0]?.textContent?.trim()).find(t => /^\\d+:\\d\\d\\.\\d+$/.test(t ?? "")) ?? null`);
const press = async (modifiers = 0) => {
  for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39, modifiers });
  await sleep(60);
};
const stage = () => evaluate(`(() => { const s = document.querySelector("video").closest(".rounded-xl").getBoundingClientRect(); return { x: s.x, y: s.y, width: s.width, height: s.height }; })()`);
/** Color of the screenshot at stage fractions, read back in the page. */
async function sample(png, points) {
  return evaluate(`(async () => {
    const img = new Image(); img.src = "data:image/png;base64,${png}"; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    return ${JSON.stringify(points)}.map(([fx, fy]) => [...g.getImageData(Math.round(fx * (img.width - 1)), Math.round(fy * (img.height - 1)), 1, 1).data].slice(0, 3));
  })()`);
}
const name = ([r, g, b]) =>
  r > 200 && g > 200 && b > 200 ? "white" : r > 180 && g < 90 && b < 90 ? "red" : g > 180 && r < 120 && b < 90 ? "green" : b > 180 && r < 90 && g < 90 ? "blue" : `rgb(${r},${g},${b})`;

const results = [];
async function check(label, expect) {
  await sleep(900);
  const clip = await stage();
  const { data } = await send("Page.captureScreenshot", { format: "png", clip: { ...clip, scale: 1 } });
  writeFileSync(join(outDir, `${label}.png`), Buffer.from(data, "base64"));
  const points = Object.keys(expect).map((k) => k.split(",").map(Number));
  const got = (await sample(data, points)).map(name);
  const ok = Object.values(expect).every((e, i) => (e instanceof RegExp ? e.test(got[i]) : got[i] === e));
  results.push({ label, playhead: await playhead(), ok, got: Object.fromEntries(Object.keys(expect).map((k, i) => [k, got[i]])) });
}

for (let i = 0; i < 15; i++) await press(); // 0.5 s: before the zoom
await check("t0.5", { "0.1,0.1": "red", "0.9,0.1": "green", "0.1,0.9": "blue", "0.9,0.9": "white" });
await press(8);
await press(8); // 2.5 s: zoomed on the red quadrant; ring and drawn cursor at the click
await check("t2.5", { "0.05,0.05": "red", "0.95,0.95": "red", "0.95,0.05": "red", "0.605,0.64": "white" });
for (let i = 0; i < 3; i++) await press(8); // 5.5 s: zoomed back out
await check("t5.5", { "0.1,0.1": "red", "0.9,0.1": "green", "0.9,0.9": "white" });

const ui = await evaluate(`({
  zoomTrackItem: [...document.querySelectorAll("[role=button]")].some(e => (e.getAttribute("aria-label") || "").startsWith("Zoom:")),
  clickTicks: document.querySelectorAll("span[title='left click']").length,
})`);
const report = { outDir, results, ui, errors };
writeFileSync(join(outDir, "result.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
ws.close();
proc.kill();
process.exit(results.every((r) => r.ok) && ui.zoomTrackItem && ui.clickTicks === 1 && errors.length === 0 ? 0 : 1);
