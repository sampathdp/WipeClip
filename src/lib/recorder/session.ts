/** One screen recording in progress (desktop app). Runs the MediaRecorders
 * for each track, streams their chunks to the recording folder, pulls
 * interaction events from the native input monitor, and finalizes the
 * folder (format.ts) when stopped.
 *
 * Microphone and webcam use the WebView's media stack (getUserMedia +
 * MediaRecorder). The screen and system audio come either from the same
 * stack (getDisplayMedia; macOS) or, with `native` set, from the app's own
 * capture (Windows.Graphics.Capture + Media Foundation, src-tauri/src/
 * capture), which writes screen.mp4 / system-audio.m4a into the folder
 * itself. Both are hardware-encoded. Nothing is uploaded.
 *
 * All timing goes through one RecordingClock (clock.ts): pause/resume pause
 * every MediaRecorder in the same tick and the event collector drops input
 * from the paused span.
 */
import {
  captureClock,
  captureFrame,
  capturePause,
  captureStart,
  captureStatus,
  captureStop,
  inputDrain,
  inputNow,
  inputStart,
  inputStop,
  recordingAppend,
  recordingBegin,
  recordingDiscard,
  recordingFinish,
  recordingStorage,
  recordingWrite,
  type NativeCaptureStarted,
  type NativeCaptureStopped,
} from "@/lib/platform/recorder";
import { ClockSync, RecordingClock, formatDuration, type SyncSample } from "./clock";
import { EventCollector, type RawInputEvent } from "./events";
import {
  EVENTS_FILE,
  MANIFEST_FILE,
  RECORDING_FORMAT,
  RECORDING_VERSION,
  encodeEvent,
  encodeHeader,
  serializeManifest,
  type CaptureInfo,
  type InputPermissions,
  type InputSettings,
  type InteractionEvent,
  type Marker,
  type RecordingManifest,
  type RecordingTrack,
  type Rect,
  type Screenshot,
  type TrackKind,
} from "./format";
import { pickMimeType } from "./mime";
import { backlogState, ChunkWriter, type BacklogState } from "./writer";

/** Chunk length handed to disk; also the most a crash can lose. */
const TIMESLICE_MS = 1000;
const DRAIN_MS = 500;
const MANIFEST_EVERY_MS = 10_000;
const DISK_CHECK_MS = 15_000;
export const LOW_DISK_BYTES = 500 * 1024 * 1024;
const STOP_DISK_BYTES = 150 * 1024 * 1024;

export interface SessionTrackInput {
  kind: TrackKind;
  stream: MediaStream;
  deviceLabel?: string;
  /** Webcam: background to apply in the editor (RecordingTrack.background). */
  background?: "remove" | "blur";
}

export interface SessionConfig {
  saveDir: string;
  folderName: string;
  tracks: SessionTrackInput[];
  capture: CaptureInfo;
  /** null = interaction metadata off. */
  input: InputSettings | null;
  inputPermissions: InputPermissions;
  videoBitsPerSecond: number;
  audioBitsPerSecond: number;
  app: { version: string | null; platform: string };
  /** Captured surface in desktop coordinates, for mapping events onto the
   * video (null = unknown; events stay in desktop space). */
  surface: Rect | null;
  /** Screen (+ system audio) captured by the app instead of a MediaStream;
   * `tracks` then holds only microphone/webcam. */
  native?: NativeScreen | null;
}

export interface NativeScreen {
  source: string;
  fps: number;
  maxHeight: number | null;
  /** Pointer drawn into the video. */
  cursor: boolean;
  systemAudio: boolean;
}

const NATIVE_SCREEN_FILE = "screen.mp4";
const NATIVE_AUDIO_FILE = "system-audio.m4a";

export type SessionStatus = "starting" | "recording" | "paused" | "stopping" | "stopped" | "failed";

export interface SessionCallbacks {
  onStatus: (s: SessionStatus) => void;
  /** Non-fatal problems to show (device unplugged, low disk...). */
  onWarning: (message: string) => void;
  /** The session stopped on its own (capture ended, disk full, write
   * error); the result is already finalized. */
  onAutoStop: (result: FinishedRecording | null, reason: string) => void;
}

export interface FinishedRecording {
  path: string;
  manifest: RecordingManifest;
}

interface TrackRuntime {
  input: SessionTrackInput;
  recorder: MediaRecorder;
  writer: ChunkWriter;
  file: string;
  mimeType: string;
  startedHost: number | null;
  endedHost: number | null;
  stopped: Promise<void>;
}

const now = () => performance.now();

export class RecordingSession {
  private cfg: SessionConfig;
  private cb: SessionCallbacks;
  private clock = new RecordingClock();
  private tracks: TrackRuntime[] = [];
  private eventsWriter: ChunkWriter | null = null;
  private collector: EventCollector | null = null;
  private id: string | null = null;
  path: string | null = null;
  private createdAt = new Date().toISOString();
  private markers: Marker[] = [];
  private screenshots: Screenshot[] = [];
  private warnings: string[] = [];
  private droppedEvents = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private status: SessionStatus = "starting";
  private finishing: Promise<FinishedRecording | null> | null = null;
  private lastSurface: { width: number; height: number } | null = null;
  private recordingId = crypto.randomUUID();
  private draining = false;
  private backlog: BacklogState = "ok";
  private startedAt: number | null = null;
  private nativeInfo: NativeCaptureStarted | null = null;
  private nativeStopped: NativeCaptureStopped | null = null;
  private nativeBytes = { screen: 0, audio: 0 };
  private nativeWarnings = new Set<string>();
  /** capture clock (ms) minus performance.now(); null = not synced. */
  private nativeOffset: number | null = null;

  constructor(cfg: SessionConfig, cb: SessionCallbacks) {
    this.cfg = cfg;
    this.cb = cb;
  }

  get state(): SessionStatus {
    return this.status;
  }

  /** Bytes written to disk so far, all tracks. */
  bytesWritten(): number {
    return this.tracks.reduce((n, t) => n + t.writer.bytes, 0) + this.nativeBytes.screen + this.nativeBytes.audio;
  }

  /** Bytes of the screen video so far (the editor's 300 MB limit applies to it). */
  screenBytes(): number {
    if (this.cfg.native) return this.nativeBytes.screen;
    return this.tracks.find((t) => t.input.kind === "screen")?.writer.bytes ?? 0;
  }

  elapsedMs(): number {
    return this.clock.state === "idle" ? 0 : this.clock.elapsed(now());
  }

  private setStatus(s: SessionStatus) {
    this.status = s;
    this.cb.onStatus(s);
  }

  private warn(message: string) {
    this.warnings.push(message);
    this.cb.onWarning(message);
  }

  /** Creates the folder, starts every recorder and the input monitor. On
   * failure everything started so far is stopped and the folder removed. */
  async start(): Promise<void> {
    const screen = this.cfg.tracks.find((t) => t.kind === "screen");
    if (!screen && !this.cfg.native) throw new Error("Choose a screen or window to record first.");

    const plans = this.cfg.tracks.map((t) => {
      const choice = pickMimeType(t.kind, (m) => MediaRecorder.isTypeSupported(m));
      if (!choice) throw new Error(`This system can't record ${t.kind === "screen" || t.kind === "webcam" ? "video" : "audio"} in a supported format.`);
      return { t, choice };
    });

    const begun = await recordingBegin(this.cfg.saveDir, this.cfg.folderName, serializeManifest(this.manifest("recording")));
    this.id = begun.id;
    this.path = begun.path;

    try {
      for (const { t, choice } of plans) this.tracks.push(this.createTrack(t, choice.mimeType, choice.file));

      if (this.cfg.input) await this.startInput(this.cfg.input);

      // All recorders start in the same tick; each one's "start" event
      // gives its real start time for the per-track offsets.
      const started = Promise.all(
        this.tracks.map(
          (tr) =>
            new Promise<void>((resolve, reject) => {
              tr.recorder.onstart = () => {
                tr.startedHost = now();
                resolve();
              };
              tr.recorder.onerror = (e) => reject((e as unknown as { error?: Error }).error ?? new Error("recorder_error"));
            })
        )
      );
      // Recording time 0 is when every recorder is started (same tick).
      // Not the "start" events: measured on WebView2, the H.264 screen
      // recorder's fires ~0.35 s after the audio ones although all files
      // cover the same span (encoder start-up), so anchoring to it would
      // put events and audio ~0.35 s off. Import re-checks this against
      // the decoded file lengths (importPlan.alignRecording).
      // Native capture: its time 0 is set inside the command; the page's
      // clock is placed there (command sent + its own setup time), and the
      // MediaRecorders start right after it returns.
      if (this.cfg.native) {
        const n = this.cfg.native;
        await this.syncNativeClock();
        const sent = now();
        const info = await captureStart({
          recording: this.id,
          source: n.source,
          fps: n.fps,
          maxHeight: n.maxHeight,
          bitrate: this.cfg.videoBitsPerSecond,
          cursor: n.cursor,
          systemAudio: n.systemAudio,
        });
        this.nativeInfo = info;
        this.startedAt = this.nativeOffset !== null ? info.t0Ms - this.nativeOffset : sent + info.setupMs;
        this.cfg.capture = {
          ...this.cfg.capture,
          backend: "native",
          video: { width: info.width, height: info.height, frameRate: info.frameRate },
          cursorCaptured: n.cursor || info.warnings.some((w) => /pointer/i.test(w)),
        };
        for (const w of info.warnings) this.noteNativeWarning(w);
      } else {
        this.startedAt = now();
      }
      for (const tr of this.tracks) {
        tr.recorder.start(TIMESLICE_MS);
      }
      await withTimeout(started, 10_000, "The recording didn't start. Try again or choose a different source.");
      this.clock.start(this.startedAt);
      for (const tr of this.tracks) {
        tr.recorder.onerror = () => {
          this.warn(`${trackName(tr.input.kind)} recording failed.`);
          if (tr.input.kind === "screen") void this.autoStop("The screen recording failed.");
        };
      }

      if (this.collector && this.eventsWriter) {
        this.writeEvents(this.collector.initial(this.initialPointer));
      }
      const v = screen?.stream.getVideoTracks()[0]?.getSettings();
      this.lastSurface = v?.width && v?.height ? { width: v.width, height: v.height } : null;

      this.timers.push(setInterval(() => void this.drain(), DRAIN_MS));
      this.timers.push(setInterval(() => void this.saveManifest(), MANIFEST_EVERY_MS));
      this.timers.push(setInterval(() => void this.checkDisk(), DISK_CHECK_MS));
      this.timers.push(setInterval(() => this.checkBacklog(), TIMESLICE_MS));
      this.watchTracks();
      this.setStatus("recording");
    } catch (e) {
      this.setStatus("failed");
      this.teardown();
      if (this.nativeInfo) await captureStop().catch(() => {});
      await inputStop().catch(() => {});
      for (const tr of this.tracks) if (tr.recorder.state !== "inactive") tr.recorder.stop();
      if (this.path) await recordingDiscard(this.path).catch(() => {});
      throw e;
    }
  }

  private initialPointer: { x: number; y: number } | null = null;

  private async startInput(settings: InputSettings) {
    try {
      const info = await inputStart(settings);
      for (const w of info.warnings) this.warn(w);
      this.initialPointer = info.pointer ? { x: info.pointer[0], y: info.pointer[1] } : null;
      const samples: SyncSample[] = [];
      for (let i = 0; i < 5; i++) {
        const sentHost = now();
        const monitorUs = await inputNow();
        samples.push({ sentHost, monitorUs, receivedHost: now() });
      }
      this.collector = new EventCollector({ clock: this.clock, sync: new ClockSync(samples), surface: this.cfg.surface, settings });
      this.eventsWriter = new ChunkWriter(
        (bytes) => recordingAppend(this.id!, EVENTS_FILE, bytes),
        () => this.warn("Couldn't save mouse and keyboard events; the video keeps recording.")
      );
      this.eventsWriter.push(utf8(encodeHeader({ recordingId: this.recordingId, coordinateSpace: this.cfg.capture.coordinateSpace }) + "\n"));
    } catch (e) {
      // The video matters more than its metadata: record without events.
      console.error("[recorder] input monitor unavailable", e);
      this.warn("Mouse and keyboard events can't be recorded on this system; the video still records.");
      this.collector = null;
      this.eventsWriter = null;
    }
  }

  private createTrack(input: SessionTrackInput, mimeType: string, file: string): TrackRuntime {
    const video = input.kind === "screen" || input.kind === "webcam";
    const recorder = new MediaRecorder(input.stream, {
      mimeType,
      ...(video ? { videoBitsPerSecond: input.kind === "webcam" ? Math.min(4_000_000, this.cfg.videoBitsPerSecond) : this.cfg.videoBitsPerSecond } : {}),
      audioBitsPerSecond: this.cfg.audioBitsPerSecond,
    });
    const writer = new ChunkWriter(
      (bytes) => recordingAppend(this.id!, file, bytes),
      (err) => {
        console.error("[recorder] write failed", err.message);
        void this.autoStop(`Recording stopped: ${err.message}`);
      }
    );
    recorder.ondataavailable = (e) => writer.push(e.data);
    const stopped = new Promise<void>((resolve) => recorder.addEventListener("stop", () => resolve(), { once: true }));
    return { input, recorder, writer, file, mimeType, startedHost: null, endedHost: null, stopped };
  }

  private watchTracks() {
    for (const tr of this.tracks) {
      for (const mt of tr.input.stream.getTracks()) {
        mt.addEventListener("ended", () => {
          if (this.status !== "recording" && this.status !== "paused") return;
          tr.endedHost ??= now();
          if (tr.input.kind === "screen") {
            void this.autoStop("Screen capture ended (sharing was stopped, or the display or window went away).");
          } else {
            this.warn(`${trackName(tr.input.kind)} disconnected at ${formatDuration(this.elapsedMs())}; the rest keeps recording.`);
          }
        });
      }
    }
  }

  /** Lines the page clock up with the native one (best of 5 round trips,
   * error at most half of it), so pause/resume/stop can be sent with their
   * exact time instead of whenever the command happens to arrive. */
  private async syncNativeClock() {
    let best = Infinity;
    for (let i = 0; i < 5; i++) {
      try {
        const sent = now();
        const q = await captureClock();
        const back = now();
        if (q > 0 && back - sent < best) {
          best = back - sent;
          this.nativeOffset = q - (sent + back) / 2;
        }
      } catch {
        return;
      }
    }
  }

  private nativeTime(host: number): number | undefined {
    return this.nativeOffset === null ? undefined : host + this.nativeOffset;
  }

  private noteNativeWarning(w: string) {
    if (this.nativeWarnings.has(w)) return;
    this.nativeWarnings.add(w);
    this.warn(w);
  }

  /** Sizes, warnings and "it ended on its own" from the native capture. */
  private async pollNative() {
    const st = await captureStatus();
    this.nativeBytes = { screen: st.screenBytes, audio: st.audioBytes };
    for (const w of st.warnings) this.noteNativeWarning(w);
    if (st.ended) {
      void this.autoStop(st.ended);
      return;
    }
    if (st.contentWidth && st.contentHeight) {
      const size = { width: st.contentWidth, height: st.contentHeight };
      if (!this.lastSurface) this.lastSurface = size;
      else if (size.width !== this.lastSurface.width || size.height !== this.lastSurface.height) {
        this.lastSurface = size;
        const t = this.clock.toRecordingTime(now());
        if (t !== null) this.writeEvents([{ type: "surface", t, ...size }]);
      }
    }
  }

  private writeEvents(events: InteractionEvent[]) {
    if (!this.eventsWriter || events.length === 0) return;
    this.eventsWriter.push(utf8(events.map(encodeEvent).join("\n") + "\n"));
  }

  private ingest(batch: { events: RawInputEvent[]; dropped: number }) {
    // The native side counts drops since the previous drain.
    this.droppedEvents += batch.dropped;
    if (this.collector) this.writeEvents(this.collector.ingest(batch.events));
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      if (this.collector) this.ingest(await inputDrain());
      if (this.nativeInfo) {
        await this.pollNative();
        return;
      }
      // Display resolution changed (or a captured window was resized).
      const screen = this.tracks.find((t) => t.input.kind === "screen");
      const s = screen?.input.stream.getVideoTracks()[0]?.getSettings();
      if (s?.width && s?.height && this.lastSurface && (s.width !== this.lastSurface.width || s.height !== this.lastSurface.height)) {
        this.lastSurface = { width: s.width, height: s.height };
        const t = this.clock.toRecordingTime(now());
        if (t !== null) this.writeEvents([{ type: "surface", t, width: s.width, height: s.height }]);
      }
    } catch (e) {
      console.error("[recorder] drain failed", e);
    } finally {
      this.draining = false;
    }
  }

  /** Bytes handed to the writers that haven't reached disk yet. */
  pendingBytes(): number {
    return this.tracks.reduce((n, t) => n + t.writer.backlog, 0) + (this.eventsWriter?.backlog ?? 0);
  }

  /** Stops before a stalled disk turns into unbounded memory use (see
   * BACKLOG_STOP_BYTES); warns once each time writes fall behind. */
  private checkBacklog() {
    const state = backlogState(this.pendingBytes());
    if (state === this.backlog) return;
    const was = this.backlog;
    this.backlog = state;
    if (state === "stalled") void this.autoStop("Recording stopped: the disk stopped keeping up, so nothing more could be saved safely.");
    else if (state === "slow" && was === "ok") this.warn("The disk is falling behind; part of the recording is waiting in memory.");
  }

  private async checkDisk() {
    try {
      const { freeBytes } = await recordingStorage(this.cfg.saveDir);
      if (freeBytes === null) return;
      if (freeBytes < STOP_DISK_BYTES) void this.autoStop("Recording stopped: the disk is almost full.");
      else if (freeBytes < LOW_DISK_BYTES) this.cb.onWarning(`Less than ${Math.round(freeBytes / 1024 / 1024)} MB of disk space left.`);
    } catch {
      // keep recording; the write itself will fail if the disk is gone
    }
  }

  pause(): void {
    if (this.status !== "recording") return;
    const host = now();
    if (this.nativeInfo) void capturePause(true, this.nativeTime(host)).catch((e) => console.error("[recorder] native pause failed", e));
    for (const tr of this.tracks) if (tr.recorder.state === "recording") tr.recorder.pause();
    if (this.collector) this.writeEvents(this.collector.pause(host));
    else this.clock.pause(host);
    this.setStatus("paused");
  }

  resume(): void {
    if (this.status !== "paused") return;
    const host = now();
    if (this.nativeInfo) void capturePause(false, this.nativeTime(host)).catch((e) => console.error("[recorder] native resume failed", e));
    for (const tr of this.tracks) if (tr.recorder.state === "paused") tr.recorder.resume();
    if (this.collector) this.writeEvents(this.collector.resume(host));
    else this.clock.resume(host);
    this.setStatus("recording");
  }

  addMarker(label?: string): Marker | null {
    if (this.status !== "recording" && this.status !== "paused") return null;
    const t = Math.round(this.clock.elapsed(now()));
    const marker: Marker = { id: `m${this.markers.length + 1}`, tMs: t, label: label ?? `Marker ${this.markers.length + 1}` };
    this.markers.push(marker);
    this.writeEvents([{ type: "marker", t, id: marker.id, label: marker.label }]);
    return marker;
  }

  /** Saves the current frame of the screen (cropped to the region) as a
   * PNG in the recording's screenshots folder. */
  screenshot(): Promise<Screenshot | null> {
    if (!this.id || this.finishing || (this.status !== "recording" && this.status !== "paused")) return Promise.resolve(null);
    // finish() waits for shots in flight, so a screenshot taken just before
    // Stop is still written and listed in the manifest.
    const job = this.takeScreenshot();
    this.pendingShots.add(job);
    void job.catch(() => {}).finally(() => this.pendingShots.delete(job));
    return job;
  }
  private pendingShots = new Set<Promise<Screenshot | null>>();

  private async takeScreenshot(): Promise<Screenshot | null> {
    if (!this.id) return null;
    const screen = this.tracks.find((t) => t.input.kind === "screen");
    const track = screen?.input.stream.getVideoTracks()[0];
    if (!track && !this.nativeInfo) return null;
    const tMs = Math.round(this.clock.elapsed(now()));
    // Reserve the number first so two quick presses don't share a name.
    const n = ++this.shotCount;
    const { blob, width, height } = track ? await grabFrame(track, this.cfg.capture.region) : await grabNativeFrame(this.cfg.capture.region);
    const path = `screenshots/shot-${String(n).padStart(3, "0")}.png`;
    await recordingWrite(this.id, path, new Uint8Array(await blob.arrayBuffer()));
    const shot = { path, tMs, width, height };
    this.screenshots.push(shot);
    return shot;
  }
  private shotCount = 0;

  /** Stops every recorder, writes the remaining data and the final
   * manifest. Safe to call more than once. */
  stop(): Promise<FinishedRecording | null> {
    this.finishing ??= this.finish();
    return this.finishing;
  }

  private async autoStop(reason: string) {
    if (this.finishing || (this.status !== "recording" && this.status !== "paused")) return;
    this.warn(reason);
    try {
      this.cb.onAutoStop(await this.stop(), reason);
    } catch (e) {
      this.cb.onAutoStop(null, `${reason} It couldn't be finalized (${e instanceof Error ? e.message : String(e)}); what was recorded is still in its folder.`);
    }
  }

  private async finish(): Promise<FinishedRecording | null> {
    if (!this.id || this.status === "failed") return null;
    this.setStatus("stopping");
    // Let screenshots already taken reach disk before the files close.
    if (this.pendingShots.size) await withTimeout(Promise.allSettled([...this.pendingShots]), 5_000, "").catch(() => {});
    const host = now();
    if (this.clock.state === "running" || this.clock.state === "paused") this.clock.stop(host);
    this.teardown();
    const nativeStop = this.nativeInfo ? captureStop(this.nativeTime(host)) : null;
    for (const tr of this.tracks) {
      tr.endedHost ??= host;
      if (tr.recorder.state !== "inactive") tr.recorder.stop();
    }
    await withTimeout(Promise.all(this.tracks.map((t) => t.stopped)), 10_000, "").catch(() => {});
    if (nativeStop) {
      try {
        this.nativeStopped = await nativeStop;
        this.nativeBytes = { screen: this.nativeStopped.screenBytes, audio: this.nativeStopped.audioBytes };
        for (const w of this.nativeStopped.warnings) this.noteNativeWarning(w);
      } catch (e) {
        // The files are fragmented MP4: what reached disk still plays.
        this.warnings.push(`Screen: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (this.collector) {
      try {
        this.ingest(await inputStop());
      } catch {
        // already reported when it failed to start
      }
    } else if (this.cfg.input) {
      await inputStop().catch(() => {});
    }
    await Promise.all([...this.tracks.map((t) => t.writer.flush()), this.eventsWriter?.flush()]);
    for (const t of this.tracks) if (t.writer.error) this.warnings.push(`${trackName(t.input.kind)}: ${t.writer.error.message}`);
    const manifest = this.manifest("complete");
    try {
      const path = await recordingFinish(this.id, serializeManifest(manifest));
      this.setStatus("stopped");
      return { path, manifest };
    } catch (e) {
      this.setStatus("failed");
      throw e;
    }
  }

  /** Stops and deletes the recording. */
  async cancel(): Promise<void> {
    const result = await this.stop().catch(() => null);
    const path = result?.path ?? this.path;
    if (path) await recordingDiscard(path);
  }

  private teardown() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  private async saveManifest() {
    if (!this.id || (this.status !== "recording" && this.status !== "paused")) return;
    try {
      await recordingWrite(this.id, MANIFEST_FILE, utf8(serializeManifest(this.manifest("recording"))));
    } catch {
      // next attempt in a few seconds; finish() writes it for sure
    }
  }

  private manifest(status: RecordingManifest["status"]): RecordingManifest {
    const total = this.elapsedMs();
    const screenStart = this.tracks.find((t) => t.input.kind === "screen")?.startedHost ?? null;
    const started = this.tracks.length > 0 || this.nativeInfo !== null;
    const tracks = started ? [...this.nativeTracks(total), ...this.tracks.map((t) => this.describeTrack(t, screenStart, total))] : this.plannedTracks();
    const isoNow = new Date().toISOString();
    return {
      format: RECORDING_FORMAT,
      version: RECORDING_VERSION,
      id: this.recordingId,
      createdAt: this.createdAt,
      updatedAt: isoNow,
      status,
      app: { name: "WipeClip", ...this.cfg.app },
      durationMs: Math.round(total),
      capture: this.cfg.capture,
      tracks,
      input: {
        path: this.cfg.input ? EVENTS_FILE : null,
        settings: this.cfg.input ?? {
          mouse: false,
          clicks: false,
          scroll: false,
          keyboard: "off",
          activeWindow: false,
          windowTitles: false,
          sampleHz: 0,
        },
        permissions: this.cfg.inputPermissions,
        eventCount: this.collector?.count ?? 0,
        droppedEvents: this.droppedEvents,
      },
      markers: this.markers,
      screenshots: this.screenshots,
      pauses: this.clock.state === "idle" ? [] : this.clock.pauses(),
      warnings: this.warnings,
    };
  }

  private plannedTracks(): RecordingTrack[] {
    return [
      ...this.nativeTracks(0),
      ...this.cfg.tracks.map((t) => {
        const c = pickMimeType(t.kind, (m) => MediaRecorder.isTypeSupported(m));
        return baseTrack(t, c?.file ?? `${t.kind}.webm`, c?.mimeType ?? "");
      }),
    ];
  }

  /** screen.mp4 and system-audio.m4a written by the native capture. Both
   * run from recording time 0 to the stop (the audio is filled with
   * silence while nothing plays). */
  private nativeTracks(total: number): RecordingTrack[] {
    const n = this.cfg.native;
    if (!n) return [];
    const info = this.nativeInfo;
    const out: RecordingTrack[] = [
      {
        ...baseTrack({ kind: "screen" }, NATIVE_SCREEN_FILE, "video/mp4;codecs=avc1"),
        durationMs: Math.round(total),
        bytes: this.nativeBytes.screen,
        width: info?.width ?? this.cfg.capture.video.width,
        height: info?.height ?? this.cfg.capture.video.height,
      },
    ];
    const audio = info ? info.systemAudio : n.systemAudio;
    // Dropped only if it failed and left nothing behind.
    if (audio && !(this.nativeStopped && !this.nativeStopped.systemAudio && this.nativeBytes.audio === 0)) {
      out.push({
        ...baseTrack({ kind: "system-audio" }, NATIVE_AUDIO_FILE, "audio/mp4;codecs=mp4a.40.2"),
        durationMs: Math.round(total),
        bytes: this.nativeBytes.audio,
      });
    }
    return out;
  }

  private describeTrack(t: TrackRuntime, screenStart: number | null, total: number): RecordingTrack {
    // All tracks start together (see start()); a non-zero offset would only
    // repeat the start-event jitter. Kept in the format for other backends.
    void screenStart;
    const offset = 0;
    // Recording time when this track ended (device unplugged) or the end.
    const endRec = t.endedHost !== null ? (this.clock.toRecordingTime(t.endedHost) ?? total) : total;
    const vs = t.input.stream.getVideoTracks()[0]?.getSettings();
    return {
      ...baseTrack(t.input, t.file, t.mimeType),
      startOffsetMs: Math.round(offset),
      durationMs: Math.max(0, Math.round(endRec - Math.max(0, offset))),
      bytes: t.writer.bytes,
      width: vs?.width,
      height: vs?.height,
      endedEarly: t.endedHost !== null && endRec < total - 500 ? true : undefined,
    };
  }
}

function baseTrack(t: Pick<SessionTrackInput, "kind" | "deviceLabel" | "background">, file: string, mimeType: string): RecordingTrack {
  const video = t.kind === "screen" || t.kind === "webcam";
  return {
    kind: t.kind,
    path: file,
    mimeType,
    startOffsetMs: 0,
    durationMs: 0,
    bytes: 0,
    hasVideo: video,
    hasAudio: !video,
    deviceLabel: t.deviceLabel,
    ...(t.kind === "webcam" && t.background ? { background: t.background } : {}),
  };
}

function trackName(kind: TrackKind): string {
  return { screen: "Screen", "system-audio": "System audio", microphone: "Microphone", webcam: "Webcam" }[kind];
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message || "timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/** The native capture's latest frame (cropped to the region) as a PNG. */
async function grabNativeFrame(region: Rect | null): Promise<{ blob: Blob; width: number; height: number }> {
  const img = await captureFrame();
  const bitmap = await createImageBitmap(img);
  try {
    return await cropToPng(bitmap, img.width, img.height, region);
  } finally {
    bitmap.close();
  }
}

async function cropToPng(source: CanvasImageSource, w: number, h: number, region: Rect | null): Promise<{ blob: Blob; width: number; height: number }> {
  const r = region ?? { x: 0, y: 0, width: 1, height: 1 };
  const sw = Math.max(1, Math.round(r.width * w));
  const sh = Math.max(1, Math.round(r.height * h));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  canvas.getContext("2d")!.drawImage(source, Math.round(r.x * w), Math.round(r.y * h), sw, sh, 0, 0, sw, sh);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode_failed"))), "image/png"));
  return { blob, width: sw, height: sh };
}

/** Current frame of a video track as a PNG. ImageCapture where the WebView
 * has it (WebView2); otherwise through a temporary <video>. */
export async function grabFrame(
  track: MediaStreamTrack,
  region: { x: number; y: number; width: number; height: number } | null
): Promise<{ blob: Blob; width: number; height: number }> {
  let source: CanvasImageSource;
  let w: number;
  let h: number;
  let cleanup = () => {};
  const IC = (globalThis as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { grabFrame(): Promise<ImageBitmap> } }).ImageCapture;
  // grabFrame() waits for the next frame, and screen capture sends frames
  // only when something on screen changes: on a still screen it can wait
  // indefinitely. Fall back to a video element's current frame.
  const grab = IC ? new IC(track).grabFrame() : null;
  const bitmap = grab
    ? await withTimeout(grab, 1_500, "").catch(() => {
        void grab.then((late) => late.close(), () => {}); // a frame arriving later is not leaked
        return null;
      })
    : null;
  if (bitmap) {
    source = bitmap;
    w = bitmap.width;
    h = bitmap.height;
    cleanup = () => bitmap.close();
  } else {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.srcObject = new MediaStream([track]);
    cleanup = () => {
      v.pause();
      v.srcObject = null;
    };
    await withTimeout(v.play(), 3_000, "").catch(() => {});
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    source = v;
    w = v.videoWidth;
    h = v.videoHeight;
    if (!w || !h) {
      cleanup();
      throw new Error("no frame from the screen yet - try again in a moment");
    }
  }
  try {
    return await cropToPng(source, w, h, region);
  } finally {
    cleanup();
  }
}
