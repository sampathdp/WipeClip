/** Turns raw input-monitor events (Rust, desktop coordinates, monitor
 * clock) into recording events (capture coordinates, recording time).
 * Pure - see tests/desktop/recorder.test.ts.
 */
import type { ClockSync, RecordingClock } from "./clock.ts";
import { desktopToCapture, rectDesktopToCapture, type Point } from "./coords.ts";
import type { InputSettings, InteractionEvent, MouseButton, Rect } from "./format.ts";

/** As sent by the input_drain command (src-tauri/src/input/mod.rs). */
export type RawInputEvent =
  | { k: "move"; t: number; x: number; y: number }
  | { k: "button"; t: number; button: MouseButton; down: boolean; x: number; y: number }
  | { k: "scroll"; t: number; dx: number; dy: number; x: number; y: number }
  | { k: "key"; t: number; combo: string }
  | { k: "typing"; t: number; caret: Rect | null }
  | { k: "window"; t: number; app: string; title: string | null; bounds: Rect | null };

export interface CollectorOptions {
  clock: RecordingClock;
  sync: ClockSync;
  /** Captured surface in desktop coordinates; null keeps events in
   * desktop space (CaptureInfo.coordinateSpace "desktop"). */
  surface: Rect | null;
  settings: InputSettings;
}

export class EventCollector {
  private lastPointer: Point | null = null;
  private lastWindow: Extract<InteractionEvent, { type: "window" }> | null = null;
  private opts: CollectorOptions;
  count = 0;

  constructor(opts: CollectorOptions) {
    this.opts = opts;
  }

  private place(x: number, y: number): Point {
    const { surface } = this.opts;
    return surface ? desktopToCapture({ x, y }, surface) : { x, y };
  }

  private placeRect(r: Rect | null): Rect | null {
    if (!r) return null;
    return this.opts.surface ? rectDesktopToCapture(r, this.opts.surface) : r;
  }

  /** Caret box to its center and height in event space. */
  private placeCaret(r: Rect | null): { x: number; y: number; h: number } | null {
    const p = this.placeRect(r);
    if (!p || !(p.height > 0)) return null;
    return { x: p.x + p.width / 2, y: p.y + p.height / 2, h: p.height };
  }

  /** Converts one drained batch. Events from before the start, during a
   * pause or after the stop are dropped (their position still updates the
   * pointer, so the resume sample is right). */
  ingest(batch: RawInputEvent[]): InteractionEvent[] {
    const { clock, sync, settings } = this.opts;
    const sorted = [...batch].sort((a, b) => a.t - b.t);
    const out: InteractionEvent[] = [];
    for (const raw of sorted) {
      if (raw.k !== "key" && raw.k !== "window" && raw.k !== "typing") this.lastPointer = this.place(raw.x, raw.y);
      const t = clock.toRecordingTime(sync.toHost(raw.t));
      let e: InteractionEvent | null = null;
      switch (raw.k) {
        case "move":
          if (settings.mouse) e = { type: "move", t: 0, ...this.lastPointer! };
          break;
        case "button":
          if (settings.clicks) e = { type: "button", t: 0, button: raw.button, down: raw.down, ...this.lastPointer! };
          break;
        case "scroll":
          if (settings.scroll) e = { type: "scroll", t: 0, dx: raw.dx, dy: raw.dy, ...this.lastPointer! };
          break;
        case "key":
          if (settings.keyboard === "shortcuts") e = { type: "key", t: 0, combo: raw.combo };
          break;
        case "typing":
          if (settings.typing) e = { type: "typing", t: 0, caret: this.placeCaret(raw.caret) };
          break;
        case "window":
          if (settings.activeWindow) {
            const w = {
              type: "window" as const,
              t: 0,
              app: raw.app,
              title: settings.windowTitles ? raw.title : null,
              rect: this.placeRect(raw.bounds),
            };
            // Remember even while paused, so resume can restate it.
            this.lastWindow = w;
            e = w;
          }
          break;
      }
      if (e && t !== null) {
        e.t = t;
        out.push(e);
      }
    }
    this.count += out.length;
    return out;
  }

  /** Marks the cut and returns the events to store for it. */
  pause(host: number): InteractionEvent[] {
    const t = this.opts.clock.pause(host);
    return [{ type: "pause", t }];
  }

  /** Restates where the pointer and active window are at the resume
   * point - they may have changed while paused, and a reader must not
   * animate the pointer across the cut from its pre-pause position. */
  resume(host: number): InteractionEvent[] {
    const t = this.opts.clock.resume(host);
    const out: InteractionEvent[] = [{ type: "resume", t }];
    if (this.lastPointer && this.opts.settings.mouse) out.push({ type: "move", t, ...this.lastPointer });
    if (this.lastWindow) out.push({ ...this.lastWindow, t });
    this.count += out.length;
    return out;
  }

  /** The pointer's position at the very start, if the monitor reported it. */
  initial(pointer: { x: number; y: number } | null): InteractionEvent[] {
    if (!pointer || !this.opts.settings.mouse) return [];
    this.lastPointer = this.place(pointer.x, pointer.y);
    this.count++;
    return [{ type: "move", t: 0, ...this.lastPointer }];
  }
}
