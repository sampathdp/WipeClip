/** On-disk format of a WipeClip screen recording (desktop app).
 *
 * A recording is a folder the user owns, e.g.
 *
 *   WipeClip Recording 2026-10-11 at 14.03.22/
 *     recording.json      manifest (this file's RecordingManifest)
 *     screen.mp4          display/window video
 *     system-audio.m4a    optional, captured with the display
 *     microphone.m4a      optional
 *     webcam.mp4          optional
 *     events.jsonl        interaction events (see encodeEvent)
 *     screenshots/*.png   optional
 *
 * Every path in the manifest is relative to the folder, so the folder can
 * be moved or copied as a whole. Each media file is written incrementally
 * while recording; the manifest is written first with status "recording"
 * and rewritten with status "complete" when the recording is finalized,
 * which is how an interrupted recording is recognized later.
 *
 * Versioning: `version` is bumped only for changes old readers would
 * misread. Readers accept any version up to their own and ignore fields
 * and event types they don't know.
 *
 * Pure module (no DOM, no Tauri) - covered by tests/desktop/recorder.test.ts.
 */

export const RECORDING_FORMAT = "wipeclip.recording";
export const RECORDING_VERSION = 1;
export const EVENTS_FORMAT = "wipeclip.events";
export const EVENTS_VERSION = 1;
export const MANIFEST_FILE = "recording.json";
export const EVENTS_FILE = "events.jsonl";

export type TrackKind = "screen" | "system-audio" | "microphone" | "webcam";

export interface RecordingTrack {
  kind: TrackKind;
  /** Relative to the recording folder. */
  path: string;
  mimeType: string;
  /** When this track's first sample was captured, relative to the screen
   * track's start (recording time 0). Positive = started later. */
  startOffsetMs: number;
  durationMs: number;
  bytes: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width?: number;
  height?: number;
  /** Microphone/camera name as the OS reports it. */
  deviceLabel?: string;
  /** The device disconnected or stopped before the recording ended. */
  endedEarly?: boolean;
  /** Webcam: the background chosen in the recorder, applied when the editor
   * opens the recording (the file itself is the original camera). Optional,
   * added without a format bump: readers that don't know it ignore it. */
  background?: "remove" | "blur";
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A display in desktop coordinates (see DesktopUnit). */
export interface DisplayInfo {
  id: string;
  name: string;
  bounds: Rect;
  scaleFactor: number;
  primary: boolean;
}

/** Units of the OS's global desktop coordinates, which raw mouse positions
 * and display bounds share: physical pixels on Windows (the app is
 * per-monitor DPI aware), points on macOS. */
export type DesktopUnit = "physical-pixels" | "points";

export interface CaptureInfo {
  surface: "monitor" | "window" | "browser" | "unknown";
  /** The captured display, when it could be identified. Needed to place
   * mouse events on the video; without it events stay in desktop space. */
  display: DisplayInfo | null;
  desktopUnit: DesktopUnit;
  /** Part of the captured surface the user selected, as fractions (0..1).
   * The video itself holds the whole surface; the editor applies this as
   * the clip's crop, so it stays adjustable. null = whole surface. */
  region: Rect | null;
  /** Encoded video size and frame rate at the start of the recording. */
  video: { width: number; height: number; frameRate: number };
  requested: { width: number | null; height: number | null; frameRate: number };
  /** What event x/y are relative to:
   *  - "capture": fractions of the captured surface (0..1; outside that
   *    range when the pointer is on another display),
   *  - "desktop": raw desktop coordinates in `desktopUnit` (the captured
   *    surface couldn't be located, e.g. a single window). */
  coordinateSpace: "capture" | "desktop";
  /** Whether the system cursor is drawn into the video: false only when
   * the capture backend confirmed it hid it (then the editor may draw a
   * reconstructed one without showing two). null = unknown (older
   * recordings) - treated as captured. Added in format v1 without a bump:
   * readers that don't know it ignore it. */
  cursorCaptured?: boolean | null;
  /** What captured the screen: the WebView (getDisplayMedia) or the app
   * itself (Windows.Graphics.Capture, src-tauri/src/capture). Informational;
   * optional, readers that don't know it ignore it. */
  backend?: "webview" | "native";
}

export interface InputSettings {
  mouse: boolean;
  clicks: boolean;
  scroll: boolean;
  /** "shortcuts": only key combinations (Ctrl/Cmd/Alt + key) and function
   * keys - never plain typing. See src-tauri/src/input/keys.rs. */
  keyboard: "off" | "shortcuts";
  activeWindow: boolean;
  /** Window titles can contain document names, email subjects etc.;
   * recorded only when explicitly enabled. */
  windowTitles: boolean;
  /** Pointer position samples per second while it moves. */
  sampleHz: number;
  /** That the user is typing, and where the text cursor is - never which
   * keys (src-tauri/src/input: at most one event per 120 ms, no key
   * identity). Used for focus zooms on typing. Optional: older
   * recordings don't have it. */
  typing?: boolean;
}

export type PermissionState = "granted" | "denied" | "unknown" | "unsupported";

export interface InputPermissions {
  mouse: PermissionState;
  keyboard: PermissionState;
  activeWindow: PermissionState;
}

export interface Marker {
  id: string;
  tMs: number;
  label: string;
}

export interface Screenshot {
  path: string;
  tMs: number;
  width: number;
  height: number;
}

/** A pause, at recording time `atMs`; `durationMs` of wall-clock time was
 * left out of every track. */
export interface PauseSpan {
  atMs: number;
  durationMs: number;
}

export type RecordingStatus = "recording" | "complete" | "recovered";

export interface RecordingManifest {
  format: typeof RECORDING_FORMAT;
  version: number;
  id: string;
  createdAt: string; // ISO 8601
  updatedAt: string;
  status: RecordingStatus;
  app: { name: string; version: string | null; platform: string };
  durationMs: number;
  capture: CaptureInfo;
  tracks: RecordingTrack[];
  input: {
    path: string | null;
    settings: InputSettings;
    permissions: InputPermissions;
    eventCount: number;
    /** Events the OS delivered faster than they could be stored. */
    droppedEvents: number;
  };
  markers: Marker[];
  screenshots: Screenshot[];
  pauses: PauseSpan[];
  /** Human-readable notes, e.g. "Microphone disconnected at 01:12". */
  warnings: string[];
}

export const DEFAULT_INPUT_SETTINGS: InputSettings = {
  mouse: true,
  clicks: true,
  scroll: true,
  keyboard: "off",
  activeWindow: false,
  windowTitles: false,
  sampleHz: 60,
  typing: true,
};

export class RecordingFormatError extends Error {}

/** Reads a manifest, filling defaults for fields older writers left out.
 * Throws RecordingFormatError for anything that isn't a WipeClip
 * recording or comes from a newer, incompatible app version. */
export function parseManifest(raw: unknown): RecordingManifest {
  const m = (typeof raw === "string" ? safeJson(raw) : raw) as Partial<RecordingManifest> | null;
  if (!m || typeof m !== "object" || m.format !== RECORDING_FORMAT) {
    throw new RecordingFormatError("This isn't a WipeClip recording.");
  }
  if (typeof m.version !== "number" || m.version < 1) {
    throw new RecordingFormatError("This recording's file is damaged (missing version).");
  }
  if (m.version > RECORDING_VERSION) {
    throw new RecordingFormatError("This recording was made by a newer version of WipeClip. Update the app to open it.");
  }
  const tracks = Array.isArray(m.tracks) ? m.tracks.filter(isTrack) : [];
  for (const t of tracks) assertRelative(t.path);
  const input = m.input ?? ({} as Partial<RecordingManifest["input"]>);
  if (input.path) assertRelative(input.path);
  const screenshots = Array.isArray(m.screenshots) ? m.screenshots : [];
  for (const s of screenshots) assertRelative(s.path);
  const capture = (m.capture ?? {}) as Partial<CaptureInfo>;
  return {
    format: RECORDING_FORMAT,
    version: m.version,
    id: String(m.id ?? ""),
    createdAt: String(m.createdAt ?? ""),
    updatedAt: String(m.updatedAt ?? m.createdAt ?? ""),
    status: m.status === "complete" || m.status === "recovered" ? m.status : "recording",
    app: { name: "WipeClip", version: null, platform: "unknown", ...m.app },
    durationMs: num(m.durationMs),
    capture: {
      surface: capture.surface ?? "unknown",
      display: capture.display ?? null,
      desktopUnit: capture.desktopUnit ?? "physical-pixels",
      region: capture.region ?? null,
      video: { width: 0, height: 0, frameRate: 30, ...capture.video },
      requested: { width: null, height: null, frameRate: 30, ...capture.requested },
      coordinateSpace: capture.coordinateSpace === "capture" ? "capture" : "desktop",
      cursorCaptured: typeof capture.cursorCaptured === "boolean" ? capture.cursorCaptured : null,
    },
    tracks,
    input: {
      path: input.path ?? null,
      settings: { ...DEFAULT_INPUT_SETTINGS, ...input.settings },
      permissions: { mouse: "unknown", keyboard: "unknown", activeWindow: "unknown", ...input.permissions },
      eventCount: num(input.eventCount),
      droppedEvents: num(input.droppedEvents),
    },
    markers: Array.isArray(m.markers) ? m.markers : [],
    screenshots,
    pauses: Array.isArray(m.pauses) ? m.pauses : [],
    warnings: Array.isArray(m.warnings) ? m.warnings.map(String) : [],
  };
}

export function serializeManifest(m: RecordingManifest): string {
  return JSON.stringify(m, null, 2) + "\n";
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    throw new RecordingFormatError("This recording's file is damaged (not valid JSON).");
  }
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function isTrack(t: unknown): t is RecordingTrack {
  const x = t as RecordingTrack;
  return !!x && typeof x.path === "string" && ["screen", "system-audio", "microphone", "webcam"].includes(x.kind);
}

/** Media paths must stay inside the recording folder. */
function assertRelative(path: string) {
  if (!path || path.startsWith("/") || path.startsWith("\\") || /^[a-zA-Z]:/.test(path) || path.split(/[\\/]/).includes("..")) {
    throw new RecordingFormatError("This recording's file is damaged (invalid media path).");
  }
}

// --- Interaction events ----------------------------------------------------
//
// events.jsonl: one JSON value per line. Line 1 is an EventsHeader; every
// other line is one event as a compact array, so a 10-minute recording at
// 60 pointer samples per second stays around 1-2 MB:
//
//   ["m", t, x, y]                     pointer moved
//   ["c", t, button, down, x, y]       button "l" | "r" | "m" | "o", down 1/0
//   ["s", t, dx, dy, x, y]             scroll, in wheel notches / lines
//   ["k", t, combo]                    shortcut, e.g. "Ctrl+Shift+S"
//   ["b", t, id, label]                bookmark/marker
//   ["w", t, app, title, rect|null]    active window changed or moved
//   ["p", t] / ["r", t]                paused / resumed (same t: the cut)
//   ["v", t, width, height]            captured surface size changed
//
// t is recording time in milliseconds (pauses excluded); x/y follow
// CaptureInfo.coordinateSpace. Lines are appended as events arrive and are
// nearly but not strictly sorted - readers sort by t (decodeEvents does).

export interface EventsHeader {
  format: typeof EVENTS_FORMAT;
  version: number;
  recordingId: string;
  coordinateSpace: CaptureInfo["coordinateSpace"];
  timeUnit: "ms";
}

export type MouseButton = "left" | "right" | "middle" | "other";

export type InteractionEvent =
  | { type: "move"; t: number; x: number; y: number }
  | { type: "button"; t: number; button: MouseButton; down: boolean; x: number; y: number }
  | { type: "scroll"; t: number; dx: number; dy: number; x: number; y: number }
  | { type: "key"; t: number; combo: string }
  /** Typing activity. caret: center of the text cursor (same space as
   * pointer x/y) and its height (fraction of the captured height), when
   * the app exposed it. Never which key. */
  | { type: "typing"; t: number; caret: { x: number; y: number; h: number } | null }
  | { type: "marker"; t: number; id: string; label: string }
  | { type: "window"; t: number; app: string; title: string | null; rect: Rect | null }
  | { type: "pause"; t: number }
  | { type: "resume"; t: number }
  | { type: "surface"; t: number; width: number; height: number };

const BUTTON_CODES: Record<MouseButton, string> = { left: "l", right: "r", middle: "m", other: "o" };
const BUTTON_NAMES: Record<string, MouseButton> = { l: "left", r: "right", m: "middle", o: "other" };

/** Rounds to 5 decimals: sub-pixel even on an 8K display for normalized
 * coordinates, and keeps the file small. */
export function round5(v: number): number {
  return Math.round(v * 1e5) / 1e5;
}

function ms(t: number): number {
  return Math.round(t * 10) / 10;
}

export function encodeEvent(e: InteractionEvent): string {
  const t = ms(e.t);
  switch (e.type) {
    case "move":
      return JSON.stringify(["m", t, round5(e.x), round5(e.y)]);
    case "button":
      return JSON.stringify(["c", t, BUTTON_CODES[e.button], e.down ? 1 : 0, round5(e.x), round5(e.y)]);
    case "scroll":
      return JSON.stringify(["s", t, round5(e.dx), round5(e.dy), round5(e.x), round5(e.y)]);
    case "key":
      return JSON.stringify(["k", t, e.combo]);
    case "typing":
      return JSON.stringify(e.caret ? ["i", t, round5(e.caret.x), round5(e.caret.y), round5(e.caret.h)] : ["i", t]);
    case "marker":
      return JSON.stringify(["b", t, e.id, e.label]);
    case "window":
      return JSON.stringify([
        "w",
        t,
        e.app,
        e.title,
        e.rect ? [round5(e.rect.x), round5(e.rect.y), round5(e.rect.width), round5(e.rect.height)] : null,
      ]);
    case "pause":
      return JSON.stringify(["p", t]);
    case "resume":
      return JSON.stringify(["r", t]);
    case "surface":
      return JSON.stringify(["v", t, e.width, e.height]);
  }
}

/** One line back to an event; null for unknown types (newer writers) or
 * malformed lines, which are skipped rather than failing the import. */
export function decodeEvent(line: string): InteractionEvent | null {
  let a: unknown;
  try {
    a = JSON.parse(line);
  } catch {
    return null;
  }
  if (!Array.isArray(a) || typeof a[0] !== "string" || typeof a[1] !== "number") return null;
  const t = a[1];
  const n = (i: number) => (typeof a[i] === "number" ? (a[i] as number) : NaN);
  let e: InteractionEvent | null = null;
  switch (a[0]) {
    case "m":
      e = { type: "move", t, x: n(2), y: n(3) };
      break;
    case "c":
      if (!BUTTON_NAMES[a[2]]) return null;
      e = { type: "button", t, button: BUTTON_NAMES[a[2]], down: a[3] === 1, x: n(4), y: n(5) };
      break;
    case "s":
      e = { type: "scroll", t, dx: n(2), dy: n(3), x: n(4), y: n(5) };
      break;
    case "k":
      return typeof a[2] === "string" ? { type: "key", t, combo: a[2] } : null;
    case "i": {
      const ok = [2, 3, 4].every((i) => Number.isFinite(a[i]));
      return { type: "typing", t, caret: ok ? { x: a[2] as number, y: a[3] as number, h: a[4] as number } : null };
    }
    case "b":
      return { type: "marker", t, id: String(a[2] ?? ""), label: String(a[3] ?? "") };
    case "w": {
      const r = a[4];
      const rect = Array.isArray(r) && r.length === 4 ? { x: r[0], y: r[1], width: r[2], height: r[3] } : null;
      return { type: "window", t, app: String(a[2] ?? ""), title: typeof a[3] === "string" ? a[3] : null, rect };
    }
    case "p":
      return { type: "pause", t };
    case "r":
      return { type: "resume", t };
    case "v":
      e = { type: "surface", t, width: n(2), height: n(3) };
      break;
    default:
      return null;
  }
  // Numeric fields must all be present.
  return Object.values(e).every((v) => typeof v !== "number" || Number.isFinite(v)) ? e : null;
}

export function encodeHeader(h: Omit<EventsHeader, "format" | "version" | "timeUnit">): string {
  const header: EventsHeader = { format: EVENTS_FORMAT, version: EVENTS_VERSION, timeUnit: "ms", ...h };
  return JSON.stringify(header);
}

export interface DecodedEvents {
  header: EventsHeader | null;
  events: InteractionEvent[];
  skipped: number;
}

/** Parses a whole events.jsonl. Tolerates a truncated last line (the app
 * closed mid-write) and lines from newer versions; sorts by time. */
export function decodeEvents(text: string): DecodedEvents {
  const lines = text.split(/\r?\n/);
  let header: EventsHeader | null = null;
  const events: InteractionEvent[] = [];
  let skipped = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (i === 0 && line.startsWith("{")) {
      try {
        const h = JSON.parse(line) as EventsHeader;
        if (h.format === EVENTS_FORMAT) {
          if (h.version > EVENTS_VERSION) throw new RecordingFormatError("These events were recorded by a newer version of WipeClip.");
          header = h;
          continue;
        }
      } catch (err) {
        if (err instanceof RecordingFormatError) throw err;
      }
    }
    const e = decodeEvent(line);
    if (e) events.push(e);
    else skipped++;
  }
  // Stable sort keeps same-time events (pause then resume) in file order.
  events.sort((a, b) => a.t - b.t);
  return { header, events, skipped };
}
