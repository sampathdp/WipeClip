// Benchmark of the focus engine and the export rows on short and long
// synthetic recordings. Run with:
//   node --experimental-strip-types --no-warnings tests/desktop/manual/bench-smart-zoom.mts
import { FOCUS_PRESETS, suggestZooms } from "../../../src/lib/editor/focus.ts";
import { cameraPayload, pointerRows } from "../../../src/lib/editor/focusExport.ts";
import { layout } from "../../../src/lib/editor/timeline.ts";
import { DEFAULT_CANVAS, DEFAULT_POINTER, newClip, type MediaSource, type Project } from "../../../src/lib/editor/types.ts";
import type { InteractionEvent } from "../../../src/lib/recorder/format.ts";

/** Clicks every 1.5-4 s around the screen, pointer moves at 60 Hz in
 * between, a typing burst every 40 s. Deterministic. */
function recording(seconds: number): InteractionEvent[] {
  const ev: InteractionEvent[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let pos = { x: 0.5, y: 0.5 };
  for (let t = 1; t < seconds - 2; ) {
    const target = { x: 0.05 + rnd() * 0.9, y: 0.05 + rnd() * 0.9 };
    for (let i = 0; i <= 24; i++) ev.push({ type: "move", t: Math.round((t + i / 60) * 1000), x: pos.x + (target.x - pos.x) * (i / 24), y: pos.y + (target.y - pos.y) * (i / 24) });
    const c = t + 0.9;
    ev.push({ type: "button", t: Math.round(c * 1000), button: "left", down: true, ...target }, { type: "button", t: Math.round(c * 1000) + 90, button: "left", down: false, ...target });
    pos = target;
    if (Math.floor(c / 40) !== Math.floor((c - 4) / 40)) for (let k = 0; k < 40; k++) ev.push({ type: "typing", t: Math.round((c + 0.5 + k * 0.15) * 1000), caret: { x: target.x + k * 0.004, y: target.y } });
    t = c + 1.5 + rnd() * 2.5;
  }
  return ev.sort((a, b) => a.t - b.t);
}

function time<T>(fn: () => T, runs = 3): { ms: number; out: T } {
  let best = Infinity;
  let out!: T;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    out = fn();
    best = Math.min(best, performance.now() - t0);
  }
  return { ms: Math.round(best * 10) / 10, out };
}

let n = 0;
for (const seconds of [60, 15 * 60, 60 * 60]) {
  const events = recording(seconds);
  const analyze = time(() => suggestZooms({ events, duration: seconds, aspect: 16 / 9, sourceId: "s" }, FOCUS_PRESETS.balanced, () => `z${n++}`));
  const src = {
    id: "s", kind: "original", url: "", duration: seconds, width: 1920, height: 1080, fps: 30, hasAudio: false,
    recording: { trackKind: "screen", folder: "", events, manifest: { capture: { coordinateSpace: "capture", cursorCaptured: false } } },
  } as unknown as MediaSource;
  const project: Project = {
    clips: [newClip("c", "s", 0, seconds)], overlays: [], audio: [], effects: [], canvas: DEFAULT_CANVAS,
    zooms: analyze.out.zooms, pointer: { ...DEFAULT_POINTER, cursor: true },
  };
  const lay = layout(project, 30);
  const canvas = { width: 1920, height: 1080 };
  const cam = time(() => cameraPayload(project, lay, { s: src }, canvas), 1);
  let rowsMs = NaN;
  let rowCount = 0;
  try {
    const r = time(() => pointerRows(project, lay, { s: src }, canvas), 1);
    rowsMs = r.ms;
    rowCount = (r.out?.cursor.length ?? 0) + (r.out?.rings.length ?? 0);
  } catch (e) {
    rowCount = -1;
    void e;
  }
  console.log(
    JSON.stringify({ seconds, events: events.length, zooms: analyze.out.zooms.length, analyzeMs: analyze.ms, cameraRowsMs: cam.ms, cameraRows: cam.out[0]?.length ?? 0, pointerRowsMs: rowsMs, pointerRows: rowCount })
  );
}
