// Timeline editing in the real editor (headless Chrome): layers following
// the clips, picking several items, trimming at the playhead, closing
// gaps, keyframe diamonds and a clip's own volume curve.
//
//   npx next dev desktop --port 3100      (or serve a `next build desktop`)
//   node tests/desktop/manual/preview-timeline.mjs http://localhost:3100/ out-dir
//
// Exits non-zero on the first failed check.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ffmpegPath, launch, sleep } from "./cdp.mjs";

const url = process.argv[2] ?? "http://localhost:3100/";
const out = resolve(process.argv[3] ?? join(tmpdir(), "wipeclip-preview-timeline"));
mkdirSync(out, { recursive: true });
const video = join(out, "clip.mp4");
execFileSync(ffmpegPath(), [
  "-y", "-loglevel", "error",
  "-f", "lavfi", "-i", "testsrc=s=320x180:r=30:d=8",
  "-f", "lavfi", "-i", "sine=f=440:d=8",
  "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-c:v", "libx264", "-profile:v", "baseline", "-movflags", "+faststart", video,
]);
const text = (id, content, start, end, extra = {}) => ({
  id, kind: "text", start, end, x: 0.5, y: 0.5, width: 0.5, rotation: 0, opacity: 1, animIn: "none", animOut: "none", hidden: false, locked: false,
  text: { content, font: "inter", size: 0.06, weight: 700, italic: false, color: "#ffffff", background: "", backgroundOpacity: 0, strokeColor: "#000000", strokeWidth: 0, shadow: false, align: "center", letterSpacing: 0, lineHeight: 1.2 },
  ...extra,
});
const project = {
  clips: [
    { id: "clipA", sourceId: "src_1", start: 0, end: 4, look: { filter: "bw", intensity: 100 } },
    { id: "clipB", sourceId: "src_1", start: 4, end: 8 },
  ],
  overlays: [
    text("t1", "Intro", 1, 2),
    text("t2", "On B", 5, 6),
    text("t3", "Pinned", 6.5, 7.5, { locked: true }),
    text("t4", "Moving", 2.5, 3.5, {
      keyframes: [
        { t: 0, x: 0.2, y: 0.5, scale: 1, rotation: 0, opacity: 1, ease: "linear" },
        { t: 0.5, x: 0.8, y: 0.5, scale: 1, rotation: 0, opacity: 1, ease: "linear" },
      ],
    }),
  ],
  audio: [],
  effects: [{ id: "fx1", type: "vignette", start: 4.5, end: 5.5, intensity: 50 }],
};
const meta = { id: "src_1", kind: "original", duration: 8, width: 320, height: 180, fps: 30, hasAudio: true, name: "clip.mp4", type: "video/mp4" };
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
/** [start, end] of a timeline item from its aria-label ("Text: On B, 0:05.00 to 0:06.00"). */
const span = (label) =>
  b.evaluate(`(() => {
    const el = [...document.querySelectorAll("[aria-label]")].find(e => e.getAttribute("aria-label").startsWith(${JSON.stringify(label)}));
    if (!el) return null;
    const m = el.getAttribute("aria-label").match(/([\\d:.]+) to ([\\d:.]+)/);
    const s = (x) => x.split(":").reduce((a, v) => a * 60 + Number(v), 0);
    return m ? [s(m[1]), s(m[2])] : null;
  })()`);
const rect = (selector) =>
  b.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; })()`);
const mouse = (type, x, y, modifiers = 0) => b.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, modifiers });
async function drag(x0, y0, x1, y1, modifiers = 0) {
  await mouse("mousePressed", x0, y0, modifiers);
  for (let i = 1; i <= 8; i++) {
    await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0 + ((x1 - x0) * i) / 8, y: y0 + ((y1 - y0) * i) / 8, button: "left", buttons: 1, modifiers });
    await sleep(30);
  }
  await mouse("mouseReleased", x1, y1, modifiers);
  await sleep(300);
}
async function clickAt(x, y, modifiers = 0) {
  await mouse("mousePressed", x, y, modifiers);
  await mouse("mouseReleased", x, y, modifiers);
  await sleep(250);
}
const near = (a, b2) => Array.isArray(a) && a.every((v, i) => Math.abs(v - b2[i]) < 0.12);
const chip = () => b.evaluate(`[...document.querySelectorAll('[role=status]')].map(e => e.innerText).find(t => /^[0-9]+ selected/.test(t)) ?? ""`);
const CTRL = 2;
const SHIFT = 8;

try {
  await b.goto(url);
  await b.seedProject(readFileSync(video).toString("base64"), project, meta);
  await b.goto(url);
  if (!(await b.click("Open"))) throw new Error("No Open button");
  check("editor open", !!(await waitFor(() => span("Text: On B"), 20000)));
  // Fit the timeline and measure pixels per second from clip A (4 s).
  const a = await rect('[data-pick="clip:clipA"]');
  const pps = (a.w + 2) / 4;
  const x0 = a.x - 1; // timeline 0
  const at = (t) => x0 + t * pps;

  // 1. Trim clip A's end by 1 s: layers on B move back, the locked one stays.
  await drag(a.x + a.w - 3, a.y + 8, a.x + a.w - 3 - pps, a.y + 8);
  check("trim: text on B follows", near(await span("Text: On B"), [4, 5]), await span("Text: On B"));
  check("trim: effect follows", near(await span("Effects: Vignette"), [3.5, 4.5]), await span("Effects: Vignette"));
  check("trim: locked text stays", near(await span("Text: Pinned"), [6.5, 7.5]), await span("Text: Pinned"));
  check("trim: text on A stays", near(await span("Text: Intro"), [1, 2]), await span("Text: Intro"));
  await b.key("z", "KeyZ", 90, CTRL);
  check("undo restores", near(await span("Text: On B"), [5, 6]), await span("Text: On B"));

  // 2. Move clip B in front of A: its text goes with it.
  const bClip = await rect('[data-pick="clip:clipB"]');
  await drag(bClip.x + bClip.w / 2, bClip.y + 10, a.x + 5, bClip.y + 10);
  check("move: text on B goes with it", near(await span("Text: On B"), [1, 2]), await span("Text: On B"));
  check("move: text on A goes with it", near(await span("Text: Intro"), [5, 6]), await span("Text: Intro"));
  await b.key("z", "KeyZ", 90, CTRL);
  check("undo move", near(await span("Text: Intro"), [1, 2]), await span("Text: Intro"));

  // 3. Select all, then Escape.
  await b.key("a", "KeyA", 65, CTRL);
  check("select all", /7 selected/.test(await chip()), await chip());
  await b.key("Escape", "Escape", 27);
  check("escape clears", (await chip()) === "");

  // 4. Shift-click two texts and drag one: both move, by the same amount.
  const t1 = await rect('[data-pick="overlay:t1"]');
  const t2 = await rect('[data-pick="overlay:t2"]');
  await clickAt(t1.x + t1.w / 2, t1.y + t1.h / 2);
  await clickAt(t2.x + t2.w / 2, t2.y + t2.h / 2, SHIFT);
  check("shift-click picks two", /2 selected/.test(await chip()), await chip());
  await drag(t1.x + t1.w / 2, t1.y + t1.h / 2, t1.x + t1.w / 2 + pps * 0.5, t1.y + t1.h / 2);
  check("drag moves both: first", near(await span("Text: Intro"), [1.5, 2.5]), await span("Text: Intro"));
  check("drag moves both: second", near(await span("Text: On B"), [5.5, 6.5]), await span("Text: On B"));
  await b.key("z", "KeyZ", 90, CTRL);

  // 5. A box drawn over the text row picks what it touches.
  await b.key("Escape", "Escape", 27);
  const row = await rect('[data-pick="overlay:t1"]');
  await drag(at(0.2), row.y + row.h + 2, at(6.2), row.y - 2);
  check("box select", /3 selected/.test(await chip()), await chip());
  await b.key("Escape", "Escape", 27);

  // 6. Q at 2 s trims clip A's first 2 s; everything after moves up 2 s.
  const ruler = await rect('[data-pick="clip:clipA"]');
  await clickAt(at(2), ruler.y - 14); // the ruler, above the video row
  await b.key("q", "KeyQ", 81);
  check("Q trims the clip: later text moves", near(await span("Text: On B"), [3, 4]), await span("Text: On B"));
  check("Q: text in the removed part is trimmed", near(await span("Text: Intro"), [0, 0]) || (await span("Text: Intro")) === null || near(await span("Text: Intro"), [0, 0.1]), await span("Text: Intro"));
  await b.key("z", "KeyZ", 90, CTRL);

  // 7. Shift+Delete on Intro closes its gap on the text row.
  const t1b = await rect('[data-pick="overlay:t1"]');
  await clickAt(t1b.x + t1b.w / 2, t1b.y + t1b.h / 2);
  await b.key("Delete", "Delete", 46, SHIFT);
  check("close gap: Intro gone", (await span("Text: Intro")) === null);
  check("close gap: On B moved back by 1 s", near(await span("Text: On B"), [4, 5]), await span("Text: On B"));
  await b.key("z", "KeyZ", 90, CTRL);

  // 8. Keyframe diamonds: drag one later, then Alt+click it away.
  const keySpan = () =>
    b.evaluate(`[...document.querySelectorAll('[aria-label^="Keyframe at"]')].map(e => e.getAttribute("aria-label").match(/at ([\\d:.]+)/)[1])`);
  check("diamonds shown", (await keySpan()).length === 2, await keySpan());
  const dia = await b.evaluate(`(() => { const r = document.querySelectorAll('[aria-label^="Keyframe at"]')[1].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await drag(dia.x, dia.y, dia.x + pps * 0.3, dia.y);
  check("diamond dragged later", (await keySpan())[1] === "0:03.3.", await keySpan());
  await b.key("z", "KeyZ", 90, CTRL);
  check("undo diamond", (await keySpan())[1] === "0:03.0.", await keySpan());
  await clickAt(dia.x, dia.y, 1); // Alt
  check("Alt+click removes the keyframe", (await keySpan()).length === 1, await keySpan());
  await b.key("z", "KeyZ", 90, CTRL);

  // 9. A clip's own sound has its own row under the video: select it,
  //    double-click to add a volume point; mute; detach.
  const SOUND = '[aria-label^="Clip sound:"][aria-label*="Clip 1"]';
  check("clip sound row", !!(await rect(SOUND)), await b.evaluate(`[...document.querySelectorAll("[aria-label^='Clip sound']")].length`));
  const s1 = await rect(SOUND);
  await clickAt(s1.x + s1.w / 2, s1.y + s1.h / 2);
  check("clicking the sound selects its clip", await b.evaluate(`document.querySelector('[data-pick="clip:clipA"][aria-pressed=true]') !== null`));
  check("the sound can't be dragged away", near(await span("Clip sound: Clip 1"), [0, 4]), await span("Clip sound: Clip 1"));
  for (const type of ["mousePressed", "mouseReleased"]) {
    await b.send("Input.dispatchMouseEvent", { type, x: s1.x + s1.w / 2, y: s1.y + 4, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 2 });
  }
  await sleep(300);
  const points = () => b.evaluate(`document.querySelector(${JSON.stringify(SOUND)})?.querySelectorAll("circle").length ?? 0`);
  check("double-click adds a volume point", (await points()) === 1, await points());
  await b.click("Speed & sound");
  await sleep(300);
  check("fade controls in the clip panel", await b.evaluate(`document.body.innerText.includes("Sound fade in")`));
  check("mute clip sound", await b.click("Mute all clip sound"));
  check("muted label", /🔇/.test(await b.evaluate(`document.querySelector(${JSON.stringify(SOUND)}).getAttribute("aria-label")`)));
  await b.key("z", "KeyZ", 90, CTRL);
  check("detach audio", await b.click("Move the selected clip's sound"));
  await sleep(300);
  check("detached: new audio track item", (await span("Audio: Audio from clip 1")) !== null, await span("Audio: Audio from clip 1"));
  check("detached: clip sound shows silent", /silent/.test(await b.evaluate(`document.querySelector(${JSON.stringify(SOUND)}).getAttribute("aria-label")`)));
  await b.key("z", "KeyZ", 90, CTRL);

  // 10. Markers, jumping, the in/out range, slip and roll.
  const now = async () => {
    const m = (await b.evaluate("document.body.innerText")).match(/(\d+:\d\d\.\d) \/ \d+:\d\d\.\d/);
    return m ? m[1] : null;
  };
  const markerLabel = () => b.evaluate(`[...document.querySelectorAll('[aria-label^="Marker 1 at"]')].map(e => e.getAttribute("aria-label")).join("|")`);
  const rulerY = (await rect('[data-pick="clip:clipA"]')).y - 14;
  await clickAt(at(2), rulerY);
  await b.key("Escape", "Escape", 27);
  await b.key("m", "KeyM", 77);
  check("M drops a marker", (await markerLabel()) === "Marker 1 at 0:02.0", await markerLabel());
  const mk = await rect('[aria-label^="Marker 1 at"]');
  await drag(mk.x + 1, mk.y + 6, mk.x + 1 + pps * 0.5, mk.y + 6);
  check("marker dragged", (await markerLabel()) === "Marker 1 at 0:02.5", await markerLabel());
  await clickAt(at(0.05), rulerY);
  await b.key("ArrowDown", "ArrowDown", 40);
  check("Down jumps to the marker", (await now()) === "0:02.5", await now());
  await b.key("ArrowDown", "ArrowDown", 40);
  check("Down jumps to the cut", (await now()) === "0:04.0", await now());
  await b.key("ArrowUp", "ArrowUp", 38);
  check("Up jumps back", (await now()) === "0:02.5", await now());
  const mk2 = await rect('[aria-label^="Marker 1 at"]');
  await clickAt(mk2.x + 1, mk2.y + 6, 1); // Alt
  check("Alt+click removes the marker", (await markerLabel()) === "", await markerLabel());
  await b.key("z", "KeyZ", 90, CTRL);

  await clickAt(at(1), rulerY);
  await b.key("i", "KeyI", 73);
  await clickAt(at(3), rulerY);
  await b.key("o", "KeyO", 79);
  check("I / O set the range", await b.evaluate(`!!document.querySelector('[aria-label="Range 0:01.0 to 0:03.0"]')`));
  check("cut the range", await b.click("Remove the range"));
  check("range cut: later text moves up", near(await span("Text: On B"), [3, 4]), await span("Text: On B"));
  await b.key("z", "KeyZ", 90, CTRL);
  check("zoom slider", await b.evaluate(`!!document.querySelector('input[aria-label="Timeline zoom"]')`));

  // Slip clip B (source 4-8) 1 s earlier: same place, earlier video; text stays.
  const cb = await rect('[data-pick="clip:clipB"]');
  await drag(cb.x + cb.w / 2, cb.y + 10, cb.x + cb.w / 2 + pps, cb.y + 10, 1);
  const clipLabel = (id) => b.evaluate(`document.querySelector('[data-pick="clip:${id}"]').getAttribute("aria-label")`);
  check("slip shows earlier video", /0:03\.0 to 0:07\.0/.test(await clipLabel("clipB")), await clipLabel("clipB"));
  check("slip keeps the text", near(await span("Text: On B"), [5, 6]), await span("Text: On B"));
  await b.key("z", "KeyZ", 90, CTRL);
  // Roll the cut 1 s later: A longer, B starts later in its video, total the same.
  const ca = await rect('[data-pick="clip:clipA"]');
  await drag(ca.x + ca.w - 3, ca.y + 8, ca.x + ca.w - 3 + pps, ca.y + 8, 1);
  check("roll: clip A longer", /0:00\.0 to 0:05\.0/.test(await clipLabel("clipA")), await clipLabel("clipA"));
  check("roll: clip B starts later", /0:05\.0 to 0:08\.0/.test(await clipLabel("clipB")), await clipLabel("clipB"));
  await b.key("z", "KeyZ", 90, CTRL);

  // 10b. Look strength over time: Fade in on clip A's black & white look.
  const ca2 = await rect('[data-pick="clip:clipA"]');
  await clickAt(ca2.x + ca2.w / 2, ca2.y + 20);
  check("open the look panel", await b.click("Look"));
  await sleep(400);
  check("look strength section", await b.evaluate(`document.body.innerText.toLowerCase().includes("look strength over time")`));
  check("fade the look in", await b.click("Fade in"));
  await sleep(200);
  const mixAt = async (t) => {
    await clickAt(at(t), rulerY);
    await sleep(250);
    return b.evaluate(`document.getElementById("look-clipA-mix")?.getAttribute("k2") ?? "none"`);
  };
  check("preview: no look at the clip's start", Number(await mixAt(0.02)) < 0.06, await mixAt(0.02));
  check("preview: half way through the fade", Math.abs(Number(await mixAt(0.5)) - 0.5) < 0.06, await mixAt(0.5));
  check("preview: full look after the fade", (await mixAt(2)) === "1.000", await mixAt(2));
  await b.key("z", "KeyZ", 90, CTRL);
  check("undo the fade", (await mixAt(0.02)) === "1.000", await mixAt(0.02));

  // 10c. Groups: Ctrl+G, a click picks the whole group, it moves together, Ctrl+Shift+G.
  await b.key("Escape", "Escape", 27);
  const g1 = await rect('[data-pick="overlay:t1"]');
  const g2 = await rect('[data-pick="overlay:t2"]');
  await clickAt(g1.x + g1.w / 2, g1.y + g1.h / 2);
  await clickAt(g2.x + g2.w / 2, g2.y + g2.h / 2, SHIFT);
  await b.key("g", "KeyG", 71, CTRL);
  await b.key("Escape", "Escape", 27);
  check("grouped items show a stripe", await b.evaluate(`!!document.querySelector('[data-pick="overlay:t1"] span[style*="background"]')`));
  await clickAt(g1.x + g1.w / 2, g1.y + g1.h / 2);
  check("a click picks the whole group", /2 selected/.test(await chip()), await chip());
  await drag(g1.x + g1.w / 2, g1.y + g1.h / 2, g1.x + g1.w / 2 + pps * 0.5, g1.y + g1.h / 2);
  check("the group moves together", near(await span("Text: On B"), [5.5, 6.5]), await span("Text: On B"));
  await b.key("z", "KeyZ", 90, CTRL);
  await b.key("g", "KeyG", 71, CTRL | SHIFT);
  await b.key("Escape", "Escape", 27);
  await clickAt(g1.x + g1.w / 2, g1.y + g1.h / 2);
  check("ungrouped: a click picks one", (await chip()) === "", await chip());

  // 11. Unlinked: trimming a clip leaves the layers in place.
  check("unlink", await b.click("Linked:"));
  const a2 = await rect('[data-pick="clip:clipA"]');
  await drag(a2.x + a2.w - 3, a2.y + 8, a2.x + a2.w - 3 - pps, a2.y + 8);
  check("unlinked: text stays", near(await span("Text: On B"), [5, 6]), await span("Text: On B"));
  // The desktop shell's native calls (sign-in storage) don't exist in a plain browser.
  const errors = b.errors.filter((e) => !/reading '(invoke|transformCallback)'|tauri-apps/.test(e));
  check("no page errors", errors.length === 0, errors.slice(0, 3));
  const { data } = await b.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(out, "timeline.png"), Buffer.from(data, "base64"));
} finally {
  b.close();
}
console.log(JSON.stringify(results, null, 1));
