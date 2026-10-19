// Manual end-to-end check of a REAL recording in the desktop app on
// Windows (moves the real cursor to a few positions, never clicks). Start the app with WebView2 debugging and fake media devices:
//
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9223 --use-fake-ui-for-media-stream --use-fake-device-for-media-stream'
//   npm run desktop:dev
//   node tests/desktop/manual/desktop-recording.mjs [--keep] [--no-mic]
//
// The screen and system audio go through the app's native capture
// (src-tauri/src/capture), so the pixels are the real screen; the fake
// device flags only provide a synthetic microphone.
//
// It opens the recorder, picks the main display in the in-app picker,
// leaves the pointer out, adds the fake microphone, records ~6 s with a
// pause, a marker and a screenshot while moving the real cursor, stops
// (the recording opens straight in the editor), checks the folder on disk
// (manifest, media durations, events), and deletes the test recording
// unless --keep.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { connect, ffmpegPath, sleep } from "./cdp.mjs";

const keep = process.argv.includes("--keep");
const b = await connect({ port: 9223 });
const r = {};
const step = (s) => console.log(`- ${s}`);

const waitFor = async (expr, ms = 30000, label = expr) => {
  for (let t = 0; t < ms; t += 300) {
    if (await b.evaluate(expr)) return;
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${label}`);
};
const setSelect = (label, value) =>
  b.evaluate(`(() => {
    const lab = [...document.querySelectorAll("label")].find(l => l.textContent.trim().startsWith(${JSON.stringify(label)}));
    const sel = lab?.querySelector("select");
    if (!sel) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, ${JSON.stringify(value)});
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
const mouse = (points, click = false, get = false) =>
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "tests/desktop/manual/mouse.ps1", ...(get ? ["-Get"] : ["-Points", points.map((p) => p.join(",")).join(";")]), ...(click ? ["-Click"] : [])]);

try {
  await b.evaluate(`location.reload(), true`);
  await sleep(4000);
  await waitFor(`!![...document.querySelectorAll("button")].find(b => b.textContent.includes("Record your screen"))`, 120000, "editor start screen");
  step("editor loaded in the desktop app");
  await b.click("Record your screen");
  await waitFor(`!!document.querySelector("[aria-label='Screen recorder']")`);
  await setSelect("Countdown", "0");
  await waitFor(`[...document.querySelectorAll("button")].some(b => b.textContent.trim().startsWith("Display 1"))`, 20000, "source picker");
  r.pickerWindows = await b.evaluate(`[...document.querySelectorAll("[role=tab]")].map(t => t.textContent.trim())`);
  await b.click("Display 1");
  await waitFor(`[...document.querySelectorAll("span")].some(s => s.textContent.startsWith("Display 1") && s.textContent.includes("·"))`, 20000, "display chosen");
  r.source = await b.evaluate(`[...document.querySelectorAll("span")].map(s => s.textContent).find(t => t.startsWith("Display 1") && t.includes("·"))`);
  step(`source: ${r.source}`);
  // Leave the pointer out (native capture can).
  r.hidePointer = await b.evaluate(`(() => { const lab = [...document.querySelectorAll("label")].find(l => l.textContent.includes("Leave the mouse pointer out")); const i = lab?.querySelector("input"); if (!i || i.disabled) return false; if (!i.checked) i.click(); return i.checked; })()`);
  await sleep(1500);
  r.previewDrawn = await b.evaluate(`(() => { const v = document.querySelector("[aria-label='Screen recorder'] video"); return !!v && v.videoWidth > 0; })()`);
  const micValue = await b.evaluate(`(() => { const lab = [...document.querySelectorAll("label")].find(l => l.textContent.trim().startsWith("Microphone")); return [...lab.querySelector("select").options].map(o => o.value).find(v => v !== "off"); })()`);
  if (!process.argv.includes("--no-mic")) await setSelect("Microphone", micValue);
  await sleep(1500);
  r.micMeter = await b.evaluate(`!!document.querySelector("[aria-label='Microphone level']")`);
  r.permissions = await b.evaluate(`[...document.querySelectorAll("[role=alert]")].map(e => e.textContent)`);

  const original = String(mouse([], false, true)).trim().split(",").map(Number);
  await b.click("Start recording");
  await waitFor(`document.body.innerText.includes("Saving to")`, 20000, "recording to start");
  r.folder = await b.evaluate(`[...document.querySelectorAll("p.break-all")].map(p => p.textContent).find(t => t.startsWith("Saving to"))?.slice("Saving to ".length)`);
  step(`recording to ${r.folder}`);
  // Real cursor moves to known physical positions (no clicks), to check the
  // desktop -> capture mapping on a scaled display. Restored afterwards.
  const probes = [[960, 540], [1440, 810], [480, 270]];
  for (const p of probes) {
    mouse([p]);
    await sleep(400);
  }
  r.probes = probes;
  await sleep(800);
  await b.click("Marker");
  await b.click("Screenshot");
  await sleep(700);
  await b.click("Pause");
  mouse([[700, 400]]); // moved while paused: must not be recorded
  await sleep(1200);
  await b.click("Resume");
  await sleep(2000);
  await b.click("Stop");
  if (original.length === 2 && original.every(Number.isFinite)) mouse([original]);
  // Opens in the editor by itself.
  await waitFor(`!document.querySelector("[aria-label='Screen recorder']") && document.body.innerText.includes("Focus and pointer")`, 60000, "editor with the recording");
  r.openedInEditor = true;
  r.editorTracks = await b.evaluate(`[...document.querySelectorAll("span")].map(s => s.textContent.trim()).filter(t => ["Zoom","Audio","Elements"].includes(t))`);
  step(`opened in the editor: ${r.folder}`);

  // --- the folder on disk ---------------------------------------------------------
  const m = JSON.parse(readFileSync(join(r.folder, "recording.json"), "utf8"));
  r.status = m.status;
  r.durationMs = m.durationMs;
  r.capture = { backend: m.capture.backend, surface: m.capture.surface, display: m.capture.display?.name ?? null, unit: m.capture.desktopUnit, video: m.capture.video, space: m.capture.coordinateSpace, cursorCaptured: m.capture.cursorCaptured };
  r.tracks = m.tracks.map((t) => ({ kind: t.kind, path: t.path, bytes: t.bytes, durationMs: t.durationMs, startOffsetMs: t.startOffsetMs }));
  r.pauses = m.pauses;
  r.markers = m.markers.length;
  r.screenshots = m.screenshots.map((s) => existsSync(join(r.folder, s.path)));
  const probe = (file) => {
    try {
      execFileSync(ffmpegPath(), ["-hide_banner", "-i", join(r.folder, file)], { stdio: "pipe" });
    } catch (e) {
      const out = String(e.stderr);
      return { duration: /Duration: ([\d:.]+)/.exec(out)?.[1] ?? null, stream: /Stream #0:0[^\n]*/.exec(out)?.[0]?.slice(0, 120) ?? null };
    }
    return null;
  };
  r.media = Object.fromEntries(m.tracks.map((t) => [t.kind, probe(t.path)]));
  const lines = readFileSync(join(r.folder, "events.jsonl"), "utf8").trim().split("\n");
  const events = lines.slice(1).map((l) => JSON.parse(l));
  r.events = { header: JSON.parse(lines[0]).format, count: events.length, kinds: [...new Set(events.map((e) => e[0]))].join("") };
  const clicks = events.filter((e) => e[0] === "c" && e[3] === 1);
  r.clicks = clicks.map((c) => ({ t: c[1], x: c[4], y: c[5] }));
  // Each probe position should appear as a move at x/1920, y/1080 (display at 0,0).
  const d = m.capture.display?.bounds;
  r.probeHits = d ? probes.map(([x, y]) => events.some((e) => e[0] === "m" && Math.abs(e[2] - (x - d.x) / d.width) < 0.002 && Math.abs(e[3] - (y - d.y) / d.height) < 0.002)) : null;
  r.pausedMoveRecorded = d ? events.some((e) => e[0] === "m" && Math.abs(e[2] - (700 - d.x) / d.width) < 0.002 && Math.abs(e[3] - (400 - d.y) / d.height) < 0.002 && e[1] > (events.find((x) => x[0] === "p")?.[1] ?? 0) && e[1] < (events.find((x) => x[0] === "r")?.[1] ?? 0)) : null;
  const p = events.find((e) => e[0] === "p");
  const rr = events.find((e) => e[0] === "r");
  r.pauseResumeSameTime = !!p && !!rr && p[1] === rr[1];
  r.movesDuringPause = p ? events.filter((e) => e[0] === "m" && e[1] > p[1] && e[1] < rr[1]).length : null;

  r.warnings = m.warnings;
  r.errors = b.errors;
} catch (e) {
  r.failure = String(e?.message ?? e);
  r.errors = b.errors;
} finally {
  b.close();
}
if (r.folder && !keep && existsSync(r.folder)) {
  rmSync(r.folder, { recursive: true, force: true });
  r.deletedTestRecording = true;
}
console.log(JSON.stringify(r, null, 2));
