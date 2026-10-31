// The mixer in the real editor (headless Chrome against a build):
//
//   npx next build desktop, then serve desktop/out (any static server)
//   node tests/desktop/manual/preview-audio.mjs http://localhost:3100/ out-dir
//
// 1. Audio tool: the mix shows the video sound, the master and loudness.
// 2. Playing: the preview goes through the mixer and the meters move
//    (sound actually reaches Web Audio - nothing silent from routing).
// 3. Loudness "Voice and podcasts": the measured loudness is within 1 LU
//    of ffmpeg's ebur128 on the same file, and the gain brings it to -16.
// 4. Solo shows its listening-only note; undo takes the loudness back off.
// Exits non-zero on the first failed check.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ffmpegPath, launch, sleep } from "./cdp.mjs";

const url = process.argv[2] ?? "http://localhost:3100/";
const out = resolve(process.argv[3] ?? join(tmpdir(), "wipeclip-preview-audio"));
mkdirSync(out, { recursive: true });
const video = join(out, "talk.mp4");
// A quiet voice-like tone (about -30 LUFS), the same on both channels.
execFileSync(ffmpegPath(), [
  "-y", "-loglevel", "error",
  "-f", "lavfi", "-i", "color=gray:s=320x180:r=30:d=8",
  "-f", "lavfi", "-i", "aevalsrc=0.04*sin(2*PI*(180+40*sin(2*PI*3*t))*t)*(0.5+0.5*sin(2*PI*4*t)):s=48000:d=8",
  "-map", "0:v", "-map", "1:a", "-ac", "2", "-c:v", "libx264", "-profile:v", "baseline", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", video,
]); // prettier-ignore
const ebur = spawnSync(ffmpegPath(), ["-hide_banner", "-nostats", "-i", video, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" }).stderr;
const reference = Number([...ebur.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop()?.[1]);

const project = { clips: [{ id: "clip_1", sourceId: "src_1", start: 0, end: 8 }], overlays: [], audio: [], effects: [] };
const meta = { id: "src_1", kind: "original", duration: 8, width: 320, height: 180, fps: 30, hasAudio: true, name: "talk.mp4", type: "video/mp4" };
const results = {};
const check = (name, ok, detail) => {
  results[name] = { ok, ...(detail === undefined ? {} : { detail }) };
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail === undefined ? "" : ` - ${JSON.stringify(detail)}`}`);
  if (!ok) throw new Error(name);
};
async function waitFor(fn, ms) {
  for (let t = 0; t < ms; t += 250) {
    const v = await fn();
    if (v) return v;
    await sleep(250);
  }
  return null;
}

const b = await launch();
try {
  await b.goto(url);
  await b.seedProject(readFileSync(video).toString("base64"), project, meta);
  for (let i = 0; i < 3; i++) {
    await b.goto(url);
    if (!/couldn.t load/.test(await b.evaluate("document.body.innerText"))) break;
  }
  if (!(await b.click("Open"))) throw new Error("No Open button - the saved project wasn't listed");
  await waitFor(() => b.evaluate(`[...document.querySelectorAll("button")].some(x => (x.title || x.getAttribute("aria-label") || "").startsWith("Music and audio"))`), 20000);
  check("audio tool", await b.click("Music and audio"));
  await sleep(600);
  const panel = () => b.evaluate(`document.querySelector('aside[aria-label="Properties"]')?.innerText ?? ""`);
  const text = await panel();
  check("mix rows", /Mix/i.test(text) && /Video sound/.test(text) && /Master/.test(text) && /Loudness/.test(text), text.slice(0, 160));

  // Play a moment: the meters read the mixer.
  await b.key(" ", "Space", 32);
  const level = await waitFor(async () => {
    const v = await b.evaluate(`Math.max(...[...document.querySelectorAll('[role=meter]')].map(m => Number(m.getAttribute("aria-valuenow"))))`);
    return v > -50 ? v : null;
  }, 6000);
  await b.key(" ", "Space", 32);
  check("meters move while playing (sound reaches the mixer)", level !== null, level);

  // Loudness: pick a target, which measures right away.
  await b.evaluate(`(() => { const s = document.querySelector('select[aria-label="Loudness"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "voice"); s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  const measured = await waitFor(async () => {
    const t = await panel();
    return /Measured -?[\d.]+ LUFS/.test(t) ? t : null;
  }, 30000);
  check("measured", !!measured, (measured ?? (await panel())).slice(0, 300));
  const lufs = Number(measured.match(/Measured (-?[\d.]+) LUFS/)[1]);
  const gain = Number(measured.match(/Gain ([+-]?[\d.]+) dB/)[1]);
  check("measurement matches ffmpeg ebur128 within 1 LU", Math.abs(lufs - reference) <= 1, { editor: lufs, ffmpeg: reference });
  check("gain brings the mix to -16 LUFS", Math.abs(lufs + gain - -16) <= 0.15 || /as far as the peaks allow/.test(measured), { lufs, gain });

  check("solo note", (await b.click("Solo: hear only this")) && /Solo is for listening only/.test(await panel()));
  await b.click("Solo: hear only this");

  // One undo takes the measurement (and the target) back.
  await b.key("z", "KeyZ", 90, 2);
  await sleep(400);
  const after = await b.evaluate(`document.querySelector('select[aria-label="Loudness"]')?.value`);
  check("undo restores loudness off", after === "off", after);
  // Tauri APIs (invoke) are absent outside the app; expected in plain Chrome.
  const ours = b.errors.filter((e) => !/favicon|404|reading .(invoke|transformCallback).|^\[desktop\] .* unavailable/.test(e));
  check("no page errors", ours.length === 0, ours.slice(0, 3));
} finally {
  await b.close();
}
console.log(JSON.stringify(results, null, 1));
