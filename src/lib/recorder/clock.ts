/** Recording time: the position in the finished video, which is wall-clock
 * time since the recording started minus every pause. Two clocks feed it:
 *
 *  - the page's own clock (performance.now(), "host ms"), which the media
 *    recorders, countdown and pause/resume buttons run on, and
 *  - the native input monitor's clock (microseconds since it started),
 *    which timestamps mouse and keyboard events in Rust as they happen.
 *
 * ClockSync maps the second onto the first; RecordingClock maps host time
 * onto recording time. Pure - see tests/desktop/recorder.test.ts.
 */
import type { PauseSpan } from "./format.ts";

interface Segment {
  hostStart: number;
  hostEnd: number | null; // null while running
  recStart: number;
}

export type ClockState = "idle" | "running" | "paused" | "stopped";

export class RecordingClock {
  private segments: Segment[] = [];
  private stoppedAt: number | null = null;
  private pausedAt: number | null = null;

  get state(): ClockState {
    if (this.stoppedAt !== null) return "stopped";
    if (this.segments.length === 0) return "idle";
    return this.pausedAt !== null ? "paused" : "running";
  }

  start(host: number): void {
    if (this.state !== "idle") throw new Error("clock already started");
    this.segments.push({ hostStart: host, hostEnd: null, recStart: 0 });
  }

  /** Returns the recording time the pause happened at. */
  pause(host: number): number {
    if (this.state !== "running") throw new Error(`can't pause while ${this.state}`);
    const seg = this.segments[this.segments.length - 1];
    const at = Math.max(seg.hostStart, host);
    seg.hostEnd = at;
    this.pausedAt = at;
    return seg.recStart + (at - seg.hostStart);
  }

  resume(host: number): number {
    if (this.state !== "paused") throw new Error(`can't resume while ${this.state}`);
    const rec = this.elapsed(host);
    this.segments.push({ hostStart: Math.max(host, this.pausedAt!), hostEnd: null, recStart: rec });
    this.pausedAt = null;
    return rec;
  }

  stop(host: number): number {
    if (this.state === "running") this.pause(host);
    if (this.state !== "paused") throw new Error(`can't stop while ${this.state}`);
    this.stoppedAt = this.pausedAt;
    this.pausedAt = null;
    return this.elapsed(host);
  }

  /** Recording time so far, at host time `host`. */
  elapsed(host: number): number {
    const seg = this.segments[this.segments.length - 1];
    if (!seg) return 0;
    const end = seg.hostEnd ?? Math.max(seg.hostStart, host);
    return seg.recStart + (end - seg.hostStart);
  }

  /** Where host time `host` lands in the video, or null when nothing was
   * being recorded then (before start, while paused, after stop). An event
   * from a pause must not appear at the resume point as if it had just
   * happened, so it gets no time at all. */
  toRecordingTime(host: number): number | null {
    for (const seg of this.segments) {
      if (host < seg.hostStart) return null;
      if (seg.hostEnd === null || host <= seg.hostEnd) return seg.recStart + (host - seg.hostStart);
    }
    return null;
  }

  /** Pauses so far, in recording time. */
  pauses(): PauseSpan[] {
    const out: PauseSpan[] = [];
    for (let i = 1; i < this.segments.length; i++) {
      const prev = this.segments[i - 1];
      out.push({ atMs: this.segments[i].recStart, durationMs: this.segments[i].hostStart - prev.hostEnd! });
    }
    return out;
  }
}

/** One round trip to the input monitor: the page's clock before and after
 * asking, and the monitor's clock in between. */
export interface SyncSample {
  sentHost: number;
  monitorUs: number;
  receivedHost: number;
}

/** Converts input-monitor timestamps to host ms. The offset comes from the
 * round trip with the least latency (NTP-style midpoint), so its error is
 * at most half that round trip - well under a frame for a local IPC call. */
export class ClockSync {
  readonly offsetMs: number;
  readonly uncertaintyMs: number;

  constructor(samples: SyncSample[]) {
    if (samples.length === 0) throw new Error("no clock samples");
    let best = samples[0];
    for (const s of samples) if (s.receivedHost - s.sentHost < best.receivedHost - best.sentHost) best = s;
    const rtt = Math.max(0, best.receivedHost - best.sentHost);
    this.offsetMs = best.sentHost + rtt / 2 - best.monitorUs / 1000;
    this.uncertaintyMs = rtt / 2;
  }

  toHost(monitorUs: number): number {
    return monitorUs / 1000 + this.offsetMs;
  }
}

/** "1:05", "12:03:09". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
