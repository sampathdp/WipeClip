// Before/after metrics for the focus engine on fixed scenarios: how many
// zooms, how often the camera zooms out and back in, how often it starts
// a move, and how many clicks happen outside the view. Run with:
//   node --experimental-strip-types --no-warnings tests/desktop/manual/smart-zoom-scenarios.mts
import { FOCUS_PRESETS, suggestZooms } from "../../../src/lib/editor/focus.ts";
import { buildCameraTrack, evalCamera } from "../../../src/lib/editor/camera.ts";
import { FULL_CROP } from "../../../src/lib/editor/types.ts";
import type { InteractionEvent } from "../../../src/lib/recorder/format.ts";

let n = 0;
const ids = () => `z${n++}`;
const click = (t: number, x: number, y: number): InteractionEvent[] => [
  { type: "move", t: t * 1000 - 600, x: x - 0.05, y },
  { type: "move", t: t * 1000 - 500, x, y },
  { type: "button", t: t * 1000, button: "left", down: true, x, y },
  { type: "button", t: t * 1000 + 80, button: "left", down: false, x, y },
];
const typ = (t0: number, secs: number, x: number, y: number, caret = true): InteractionEvent[] => {
  const o: InteractionEvent[] = [];
  for (let k = 0; k * 0.15 < secs; k++)
    o.push({ type: "typing", t: Math.round((t0 + k * 0.15) * 1000), ...(caret ? { caret: { x: x + (k % 40) * 0.006, y: y + Math.floor(k / 40) * 0.03 } } : {}) } as InteractionEvent);
  return o;
};

function metrics(events: InteractionEvent[], duration: number, preset: keyof typeof FOCUS_PRESETS) {
  events.sort((a, b) => a.t - b.t);
  const { zooms } = suggestZooms({ events, duration, aspect: 16 / 9, sourceId: "s" }, FOCUS_PRESETS[preset], ids);
  const tr = buildCameraTrack(zooms, "s", FULL_CROP);
  let zoomOuts = 0;
  let moves = 0;
  let wasIn = false;
  let wasMoving = false;
  let prev = evalCamera(tr, 0);
  for (let t = 0; t < duration; t += 1 / 30) {
    const w = evalCamera(tr, t);
    const zin = w.s < 0.9;
    if (wasIn && !zin) zoomOuts++;
    wasIn = zin;
    const moving = Math.abs(w.x - prev.x) + Math.abs(w.y - prev.y) + Math.abs(w.s - prev.s) > 1e-4;
    if (moving && !wasMoving) moves++;
    wasMoving = moving;
    prev = w;
  }
  let outside = 0;
  for (const e of events) {
    if (e.type !== "button" || !e.down) continue;
    const w = evalCamera(tr, e.t / 1000);
    if (e.x < w.x || e.x > w.x + w.s || e.y < w.y || e.y > w.y + w.s) outside++;
  }
  // Zoom-outs in the middle: the camera returns to the full frame and
  // zooms in again (the last zoom-out is the end of the activity).
  return { zooms: zooms.length, zoomOutsBetween: Math.max(0, zoomOuts - 1), cameraMoves: moves, clicksOutsideView: outside };
}

const out: Record<string, unknown> = {};
for (const preset of ["balanced", "dynamic"] as const) {
  for (const gap of [2, 3, 3.5, 4, 5]) {
    const ev: InteractionEvent[] = [];
    for (let i = 0; i < 8; i++) ev.push(...click(2 + i * gap, 0.4 + (i % 2) * 0.05, 0.5));
    out[`${preset} same area, clicks ${gap}s apart`] = metrics(ev, 60, preset);
  }
  for (const gap of [3, 4]) {
    const ev: InteractionEvent[] = [];
    for (let i = 0; i < 8; i++) ev.push(...click(2 + i * gap, i % 2 ? 0.8 : 0.2, 0.5));
    out[`${preset} two areas, clicks ${gap}s apart`] = metrics(ev, 60, preset);
  }
  out[`${preset} 90 s of multi-line typing`] = metrics([...click(0.5, 0.3, 0.3), ...typ(1, 90, 0.3, 0.3)], 100, preset);
  out[`${preset} typing, 3.5 s thinking pauses, shortcut with pointer far away`] = metrics(
    [
      ...click(0.8, 0.3, 0.3),
      { type: "move", t: 1500, x: 0.9, y: 0.9 },
      ...[0, 1, 2, 3, 4].flatMap((b) => typ(1 + b * 6.5, 3, 0.3, 0.3)),
      { type: "key", t: 9000, combo: "Ctrl+S" } as InteractionEvent,
      { type: "key", t: 22000, combo: "Ctrl+B" } as InteractionEvent,
    ],
    40,
    preset
  );
}
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(70), JSON.stringify(v));
