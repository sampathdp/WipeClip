"use client";

/** Screen recorder workspace (desktop app only):
 *   choose source -> configure audio/video -> record -> review -> editor.
 *
 * On Windows the screen and system audio are captured by the app itself
 * (src-tauri/src/capture: in-app source picker, no browser share bar or
 * border, pointer can be left out). Elsewhere capture runs on the WebView's
 * media APIs (getDisplayMedia). Microphone and webcam always use
 * getUserMedia and MediaRecorder;
 * everything is written straight to a folder on the user's disk by the
 * native side (src-tauri/src/recording). Mouse/keyboard metadata comes from
 * the native input monitor (src-tauri/src/input). Nothing is uploaded.
 * See docs/desktop/RECORDER.md.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirmAction, getDesktopCapabilities } from "@/lib/platform";
import {
  captureExcludeWindow,
  captureSupport,
  captureThumbnail,
  inputPermissions,
  onMiniAction,
  recorderMini,
  sendMiniState,
  inputRequestAccess,
  onRecorderShortcut,
  openPrivacySettings,
  recorderDisplays,
  recorderShortcuts,
  recorderWindow,
  recordingChooseDir,
  recordingDefaultDir,
  recordingDiscard,
  recordingOpen,
  recordingReveal,
  recordingScanIncomplete,
  recordingStorage,
  type FoundRecording,
  type NativeCaptureSource,
  type NativeCaptureSupport,
  type NativeInputPermissions,
  type PrivacyKind,
  type ShortcutAction,
  type ShortcutStatus,
} from "@/lib/platform/recorder";
import {
  EDITOR_MAX_VIDEO_BYTES,
  RecordingTooLargeError,
  loadRecordingBundle,
  readTrackFile,
  recoverRecording,
  type RecordingBundle,
} from "@/lib/recorder/bundle";
import { formatDuration } from "@/lib/recorder/clock";
import { matchDisplay } from "@/lib/recorder/coords";
import {
  DEFAULT_INPUT_SETTINGS,
  RecordingFormatError,
  parseManifest,
  type CaptureInfo,
  type DisplayInfo,
  type InputSettings,
  type Rect,
} from "@/lib/recorder/format";
import { LOW_DISK_BYTES, RecordingSession, type FinishedRecording, type SessionTrackInput } from "@/lib/recorder/session";
import { CloseIcon } from "@/components/editor/icons";
import ToolFeedback from "@/components/ToolFeedback";
import { LevelMeter, LivePreview, Note, RegionSelector, Section, Select, Toggle, formatBytes, useAudioLevel } from "./parts";
import SourcePicker from "./SourcePicker";

type Step = "setup" | "countdown" | "recording" | "review";
type Platform = "windows" | "macos" | "linux" | "web";
type Resolution = "native" | "1080" | "720";
type Quality = "low" | "standard" | "high";

/** Bits per pixel per frame; H.264 screen content compresses well. */
const QUALITY_BPP: Record<Quality, number> = { low: 0.04, standard: 0.07, high: 0.12 };
const MIN_START_BYTES = 150 * 1024 * 1024;
const EXPORT_MAX_MS = 10 * 60 * 1000;

interface Source {
  stream: MediaStream;
  surface: CaptureInfo["surface"];
  native: { width: number; height: number };
  maxFrameRate: number | null;
  hasSystemAudio: boolean;
  /** false only when the web engine confirmed the cursor is left out. */
  cursorCaptured: boolean;
  /** Set for the app's own capture (Windows): `stream` is then only a
   * preview, drawn from thumbnails into `preview`. */
  nativeSource?: NativeCaptureSource;
  preview?: HTMLCanvasElement;
}

function drawPreview(canvas: HTMLCanvasElement, img: ImageData) {
  if (canvas.width !== img.width || canvas.height !== img.height) {
    canvas.width = img.width;
    canvas.height = img.height;
  }
  canvas.getContext("2d")?.putImageData(img, 0, 0);
}

/** Same limits as the native encoder (src-tauri/src/capture/video.rs). */
function nativeOutputSize(w: number, h: number, maxHeight: number | null) {
  let oh = Math.max(2, maxHeight ? Math.min(maxHeight, h) : h);
  let ow = (w * oh) / Math.max(1, h);
  const s = Math.min(4096 / ow, 2304 / oh, 1);
  ow *= s;
  oh *= s;
  const even = (v: number) => Math.max(2, Math.round(v) & ~1);
  return { width: even(ow), height: even(oh) };
}

interface Support {
  display: boolean;
  media: boolean;
  recorder: boolean;
}

function stopStream(s: MediaStream | null | undefined) {
  s?.getTracks().forEach((t) => t.stop());
}

function folderName(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `WipeClip Recording ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} at ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}

function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : typeof e === "string" ? e : fallback;
}

/** getUserMedia/getDisplayMedia failures in words, with the settings page
 * that fixes them where there is one. */
function mediaError(e: unknown, what: "screen" | "microphone" | "camera", platform: Platform): { message: string; settings?: PrivacyKind } {
  const name = (e as DOMException)?.name;
  const thing = what === "screen" ? "screen recording" : what;
  if (name === "NotAllowedError" || name === "SecurityError") {
    if (what === "screen" && platform === "windows") return { message: "Screen selection was cancelled." };
    return {
      message:
        platform === "macos"
          ? `WipeClip isn't allowed to use ${thing}. Turn it on for WipeClip in System Settings > Privacy & Security${what === "screen" ? ", then quit and reopen WipeClip" : ""}.`
          : `Access to the ${thing} was blocked. Allow it for WipeClip in Windows Settings > Privacy & security.`,
      settings: what === "screen" ? "screen" : what,
    };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return { message: `No ${what === "screen" ? "screen to capture" : what} was found.` };
  if (name === "NotReadableError" || name === "AbortError") return { message: `The ${thing === "screen recording" ? "screen" : what} is in use by another app or couldn't be started.` };
  if (name === "NotSupportedError" || name === "TypeError") return { message: `${what === "screen" ? "Screen capture" : `The ${what}`} isn't supported by this system's web engine.` };
  return { message: errorText(e, `Couldn't start the ${what}.`) };
}

const AUTO_OPEN_KEY = "wipeclip.recorder.autoOpen";
function readAutoOpen(): boolean {
  try {
    return localStorage.getItem(AUTO_OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

export default function ScreenRecorder({
  onClose,
  onOpenInEditor,
}: {
  onClose: () => void;
  onOpenInEditor: (bundle: RecordingBundle) => void;
}) {
  const [step, setStep] = useState<Step>("setup");
  const [platform, setPlatform] = useState<Platform>("web");
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [support, setSupport] = useState<Support | null>(null);
  const [nativeSupport, setNativeSupport] = useState<NativeCaptureSupport | null>(null);
  const useNative = platform === "windows" && !!nativeSupport?.supported;
  const [error, setError] = useState<{ message: string; settings?: PrivacyKind } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // source
  const [source, setSource] = useState<Source | null>(null);
  const [wantSystemAudio, setWantSystemAudio] = useState(true);
  const [hideCursor, setHideCursor] = useState(false);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [displayId, setDisplayId] = useState<string | null>(null);
  const [region, setRegion] = useState<Rect | null>(null);
  const [regionMode, setRegionMode] = useState(false);
  const [resolution, setResolution] = useState<Resolution>("native");
  const [fps, setFps] = useState<30 | 60>(30);
  const [quality, setQuality] = useState<Quality>("standard");

  // devices
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>("off");
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [camId, setCamId] = useState<string>("off");
  const [camStream, setCamStream] = useState<MediaStream | null>(null);
  const micLevel = useAudioLevel(micStream);
  const systemAudioStream = useMemo(() => {
    const tracks = source?.stream.getAudioTracks() ?? [];
    return tracks.length ? new MediaStream(tracks) : null;
  }, [source]);
  const systemLevel = useAudioLevel(wantSystemAudio ? systemAudioStream : null);

  // metadata
  const [inputOn, setInputOn] = useState(true);
  const [input, setInput] = useState<InputSettings>(DEFAULT_INPUT_SETTINGS);
  const [perms, setPerms] = useState<NativeInputPermissions | null>(null);

  // recording
  const [countdown, setCountdown] = useState<0 | 3 | 5 | 10>(3);
  const [count, setCount] = useState(0);
  const [hideWindow, setHideWindow] = useState(false);
  const [keepOut, setKeepOut] = useState(true);
  const [showMini, setShowMini] = useState(true);
  const [autoOpen, setAutoOpenState] = useState(readAutoOpen);
  const setAutoOpen = useCallback((on: boolean) => {
    setAutoOpenState(on);
    try {
      localStorage.setItem(AUTO_OPEN_KEY, on ? "1" : "0");
    } catch {}
  }, []);
  const [saveDir, setSaveDir] = useState<string | null>(null);
  const [freeBytes, setFreeBytes] = useState<number | null>(null);
  const [shortcuts, setShortcuts] = useState<ShortcutStatus[]>([]);
  const [status, setStatus] = useState<"recording" | "paused" | "stopping">("recording");
  const [elapsed, setElapsed] = useState(0);
  const [sizes, setSizes] = useState({ total: 0, screen: 0 });
  const [warnings, setWarnings] = useState<string[]>([]);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const sessionRef = useRef<RecordingSession | null>(null);
  const countdownCancel = useRef(false);

  // review
  const [finished, setFinished] = useState<FinishedRecording | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [incomplete, setIncomplete] = useState<FoundRecording[]>([]);

  // --- environment ----------------------------------------------------------
  useEffect(() => {
    queueMicrotask(() =>
      setSupport({
        display: typeof navigator.mediaDevices?.getDisplayMedia === "function",
        media: typeof navigator.mediaDevices?.getUserMedia === "function",
        recorder: typeof MediaRecorder !== "undefined",
      })
    );
    void getDesktopCapabilities().then((c) => {
      setPlatform(c.platform);
      setAppVersion(c.version);
      if (c.platform === "windows")
        void captureSupport()
          .then(setNativeSupport)
          .catch(() => setNativeSupport(null));
    });
    void inputPermissions()
      .then(setPerms)
      .catch(() => setPerms(null));
    void recordingDefaultDir()
      .then((dir) => {
        setSaveDir(dir);
        return recordingScanIncomplete(dir).then(setIncomplete);
      })
      .catch((e) => console.error("[recorder] storage setup failed", e));
    // Hotkeys only while the recorder is open.
    void recorderShortcuts(true)
      .then(setShortcuts)
      .catch(() => setShortcuts([]));
    return () => {
      void recorderShortcuts(false).catch(() => {});
    };
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      setDevices(await navigator.mediaDevices.enumerateDevices());
    } catch {
      setDevices([]);
    }
  }, []);
  useEffect(() => {
    if (!navigator.mediaDevices) return;
    queueMicrotask(() => void refreshDevices());
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
  }, [refreshDevices]);

  useEffect(() => {
    if (!saveDir) return;
    let cancelled = false;
    const check = () =>
      recordingStorage(saveDir)
        .then((s) => !cancelled && setFreeBytes(s.freeBytes))
        .catch(() => !cancelled && setFreeBytes(null));
    void check();
    const t = setInterval(check, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [saveDir]);

  // Streams die with the recorder.
  const streamsRef = useRef<(MediaStream | null)[]>([]);
  useEffect(() => {
    streamsRef.current = [source?.stream ?? null, micStream, camStream];
  }, [source, micStream, camStream]);
  useEffect(
    () => () => {
      streamsRef.current.forEach(stopStream);
      void sessionRef.current?.stop().catch(() => {});
    },
    []
  );
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  /** Device options. Until access is granted the WebView hides names and
   * ids, so there's one "default" entry that triggers the permission
   * prompt; the real list appears after. */
  const deviceOptions = (kind: MediaDeviceKind, noun: string) => {
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [{ value: "off", label: "Off" }];
    devices
      .filter((d) => d.kind === kind)
      .forEach((d, i) => {
        const value = d.deviceId || "default";
        if (seen.has(value)) return;
        seen.add(value);
        out.push({ value, label: d.label || (d.deviceId ? `${noun} ${i + 1}` : `${noun} (allow access)`) });
      });
    if (out.length === 1) out.push({ value: "default", label: `Default ${noun.toLowerCase()}` });
    return out;
  };

  // --- source -----------------------------------------------------------------
  const applyVideoConstraints = useCallback(async (s: Source, res: Resolution, rate: number) => {
    const track = s.stream.getVideoTracks()[0];
    if (!track || s.nativeSource) return;
    const target = res === "native" ? s.native.height : Number(res);
    const height = Math.min(s.native.height, target);
    const width = Math.round((s.native.width * height) / s.native.height / 2) * 2;
    const frameRate = s.maxFrameRate ? Math.min(rate, s.maxFrameRate) : rate;
    try {
      await track.applyConstraints({ width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: frameRate, max: frameRate } });
    } catch (e) {
      console.warn("[recorder] constraints not applied", e);
      setNotice("This capture source doesn't support changing resolution or frame rate; it records at its own settings.");
    }
  }, []);

  const chooseSource = useCallback(async () => {
    setError(null);
    setNotice(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: fps }, displaySurface: "monitor", cursor: hideCursor ? "never" : "always" } as MediaTrackConstraints,
        audio: wantSystemAudio,
        // Chromium hints; other engines ignore them.
        systemAudio: wantSystemAudio ? "include" : "exclude",
        selfBrowserSurface: "exclude",
        surfaceSwitching: "exclude",
        monitorTypeSurfaces: "include",
      } as DisplayMediaStreamOptions);
    } catch (e) {
      setError(mediaError(e, "screen", platform));
      return;
    }
    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings() as MediaTrackSettings & { displaySurface?: string };
    const caps = typeof track.getCapabilities === "function" ? track.getCapabilities() : ({} as MediaTrackCapabilities);
    const native = {
      width: caps.width?.max && caps.width.max >= (settings.width ?? 0) ? caps.width.max : (settings.width ?? 0),
      height: caps.height?.max && caps.height.max >= (settings.height ?? 0) ? caps.height.max : (settings.height ?? 0),
    };
    // Capabilities can report the encoder limit rather than the surface;
    // prefer the actual frame size when they disagree on aspect ratio.
    if (settings.width && settings.height && Math.abs(native.width / native.height - settings.width / settings.height) > 0.01) {
      native.width = settings.width;
      native.height = settings.height;
    }
    const surface = (["monitor", "window", "browser"].includes(settings.displaySurface ?? "") ? settings.displaySurface : "unknown") as Source["surface"];
    const next: Source = {
      stream,
      surface,
      native,
      maxFrameRate: caps.frameRate?.max ?? null,
      hasSystemAudio: stream.getAudioTracks().length > 0,
      // Only trusted when we asked for "never" and the engine confirms it -
      // and not on Windows: measured on WebView2, it reports cursor "never"
      // even when "always" was requested, while the pointer IS in the
      // frames. Trusting it would make the editor draw a second pointer.
      cursorCaptured: !(hideCursor && platform !== "windows" && (settings as MediaTrackSettings & { cursor?: string }).cursor === "never"),
    };
    stopStream(source?.stream);
    setSource(next);
    setRegion(null);
    setRegionMode(false);
    track.addEventListener("ended", () => {
      setSource((cur) => (cur?.stream === stream ? null : cur));
    });
    if (hideCursor && next.cursorCaptured) {
      setNotice("This system can't leave the mouse pointer out of the recording, so it stays in the video. Click highlights and zooms still work in the editor.");
    } else if (wantSystemAudio && !next.hasSystemAudio) {
      setNotice(
        platform === "macos"
          ? "System audio can't be captured on macOS with this recorder; record your microphone instead."
          : "System audio wasn't shared. To include it, choose an entire screen and tick “Share system audio”."
      );
    }
    await applyVideoConstraints(next, resolution, fps);
    // Which display is it? Needed to place mouse events on the video.
    try {
      const list = await recorderDisplays();
      setDisplays(list);
      if (surface === "monitor" || surface === "unknown") {
        const m = matchDisplay(list, native, platform === "macos" ? "points" : "physical-pixels");
        setDisplayId(m.display?.id ?? null);
      } else {
        setDisplayId(null);
      }
    } catch {
      setDisplays([]);
      setDisplayId(null);
    }
  }, [fps, wantSystemAudio, hideCursor, platform, source, applyVideoConstraints, resolution]);

  /** A display or window from the in-app picker (native capture). */
  const pickNative = useCallback(
    async (picked: NativeCaptureSource) => {
      setError(null);
      setNotice(null);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(2, Math.round((720 * picked.bounds.width) / Math.max(1, picked.bounds.height)));
      canvas.height = 720;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      const stream = canvas.captureStream();
      stopStream(source?.stream);
      setSource({
        stream,
        surface: picked.kind,
        native: { width: picked.bounds.width, height: picked.bounds.height },
        maxFrameRate: null,
        hasSystemAudio: true,
        cursorCaptured: true,
        nativeSource: picked,
        preview: canvas,
      });
      setRegion(null);
      setRegionMode(false);
      try {
        const list = await recorderDisplays();
        setDisplays(list);
        setDisplayId(picked.kind === "monitor" && list.some((d) => d.id === picked.displayId) ? picked.displayId : null);
      } catch {
        setDisplays([]);
        setDisplayId(null);
      }
    },
    [source]
  );

  // Native preview: a still of the source every few hundred ms (once a
  // second while recording), drawn into the preview canvas.
  const nativeId = source?.nativeSource?.id;
  const previewCanvas = source?.preview;
  useEffect(() => {
    if (!nativeId || !previewCanvas || step === "review") return;
    let stopped = false;
    let failures = 0;
    void (async () => {
      while (!stopped) {
        try {
          const img = await captureThumbnail(nativeId, 1280, 720);
          if (stopped) return;
          failures = 0;
          drawPreview(previewCanvas, img);
        } catch (e) {
          // Window closed (or minimized) before recording: back to the picker.
          if (++failures >= 3 && step === "setup") {
            setSource((cur) => (cur?.nativeSource?.id === nativeId ? null : cur));
            setNotice(errorText(e, "That source isn't available any more.") + " Choose what to record again.");
            return;
          }
        }
        await new Promise((r) => setTimeout(r, step === "setup" ? 250 : 1000));
      }
    })();
    return () => {
      stopped = true;
    };
  }, [nativeId, previewCanvas, step]);

  // Mini player while recording (native capture only: it relies on the
  // window being excluded from capture). Fed with the time and state.
  const miniOpen = useNative && showMini && step === "recording";
  useEffect(() => {
    if (!miniOpen) return;
    void recorderMini(true).catch((e) => setNotice(errorText(e, "The mini player couldn't open.")));
    const t = setInterval(() => {
      const s = sessionRef.current;
      if (!s) return;
      const st = s.state === "paused" ? "paused" : s.state === "stopping" ? "stopping" : "recording";
      void sendMiniState({ elapsedMs: s.elapsedMs(), status: st }).catch(() => {});
    }, 250);
    return () => {
      clearInterval(t);
      void recorderMini(false).catch(() => {});
    };
  }, [miniOpen]);

  // Keep WipeClip itself out of native captures (it stays on screen).
  useEffect(() => {
    if (!useNative) return;
    void captureExcludeWindow(keepOut).catch(() => {});
  }, [useNative, keepOut]);
  useEffect(
    () => () => {
      void captureExcludeWindow(false).catch(() => {});
    },
    []
  );

  const candidates = useMemo(() => {
    if (!source || source.surface === "window" || source.surface === "browser") return [];
    return matchDisplay(displays, source.native, platform === "macos" ? "points" : "physical-pixels").candidates;
  }, [source, displays, platform]);
  const display = displays.find((d) => d.id === displayId) ?? null;

  // --- microphone / webcam --------------------------------------------------------
  const selectMic = useCallback(
    async (id: string) => {
      setMicId(id);
      stopStream(micStream);
      setMicStream(null);
      if (id === "off") return;
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: id === "default" ? undefined : { exact: id }, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        setMicStream(s);
        void refreshDevices(); // labels appear once permission is granted
      } catch (e) {
        setMicId("off");
        setError(mediaError(e, "microphone", platform));
      }
    },
    [micStream, platform, refreshDevices]
  );

  const selectCam = useCallback(
    async (id: string) => {
      setCamId(id);
      stopStream(camStream);
      setCamStream(null);
      if (id === "off") return;
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: id === "default" ? undefined : { exact: id }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        });
        setCamStream(s);
        void refreshDevices();
      } catch (e) {
        setCamId("off");
        setError(mediaError(e, "camera", platform));
      }
    },
    [camStream, platform, refreshDevices]
  );

  // A selected device unplugged before recording.
  useEffect(() => {
    if (step !== "setup") return;
    const watched = [
      { track: micStream?.getTracks()[0], off: () => void selectMic("off"), name: "microphone" },
      { track: camStream?.getTracks()[0], off: () => void selectCam("off"), name: "camera" },
    ].filter((w) => w.track);
    const handlers = watched.map((w) => {
      const onEnded = () => {
        w.off();
        setNotice(`The ${w.name} was disconnected.`);
      };
      w.track!.addEventListener("ended", onEnded);
      return () => w.track!.removeEventListener("ended", onEnded);
    });
    return () => handlers.forEach((h) => h());
  }, [micStream, camStream, step, selectMic, selectCam]);

  // --- settings derived ------------------------------------------------------------
  const videoTrackSettings = source?.nativeSource ? undefined : source?.stream.getVideoTracks()[0]?.getSettings();
  const nativeOut = source?.nativeSource ? nativeOutputSize(source.native.width, source.native.height, resolution === "native" ? null : Number(resolution)) : null;
  const outW = nativeOut?.width ?? videoTrackSettings?.width ?? source?.native.width ?? 1920;
  const outH = nativeOut?.height ?? videoTrackSettings?.height ?? source?.native.height ?? 1080;
  const outFps = Math.round(videoTrackSettings?.frameRate ?? fps);
  // Native: the pointer can really be left out; system audio is always available.
  const cursorInVideo = source?.nativeSource ? !(hideCursor && !!nativeSupport?.cursorControl) : (source?.cursorCaptured ?? true);
  const systemAudioOn = source?.nativeSource ? wantSystemAudio : !!source?.hasSystemAudio;
  const videoBps = Math.round(Math.min(40e6, Math.max(1.5e6, QUALITY_BPP[quality] * outW * outH * outFps)));
  const mbPerMin = ((videoBps + (micStream ? 128e3 : 0) + (systemAudioOn ? 128e3 : 0) + (camStream ? 2.5e6 : 0)) * 60) / 8 / 1024 / 1024;
  const inputAvailable = perms !== null && perms.mouse !== "unsupported";

  // --- recording -----------------------------------------------------------------------
  const restoreWindow = useCallback(() => {
    if (hideWindow) void recorderWindow(false).catch(() => {});
  }, [hideWindow]);

  const showReview = useCallback(async (result: FinishedRecording | null, opts: { autoOpen?: boolean } = {}) => {
    sessionRef.current = null;
    if (!result) {
      setStep("setup");
      return;
    }
    // Straight to the editor; the review screen is the fallback when that
    // isn't possible (too large or unreadable). An open project stays in
    // the editor's Recent projects.
    const screenTrack = result.manifest.tracks.find((t) => t.kind === "screen");
    if (opts.autoOpen && screenTrack && screenTrack.bytes > 0 && screenTrack.bytes <= EDITOR_MAX_VIDEO_BYTES) {
      {
        setStep("review");
        setBusy("Opening in the editor…");
        try {
          onOpenInEditor(await loadRecordingBundle(result.path, result.manifest));
          return;
        } catch (e) {
          setError({ message: e instanceof RecordingTooLargeError ? e.message : errorText(e, "Couldn't open the recording.") });
        } finally {
          setBusy(null);
        }
      }
    }
    setFinished(result);
    setStep("review");
    setPreviewUrl(null);
    const screen = result.manifest.tracks.find((t) => t.kind === "screen");
    if (screen && screen.bytes > 0 && screen.bytes <= EDITOR_MAX_VIDEO_BYTES) {
      try {
        const file = await readTrackFile(result.path, result.manifest, "screen");
        if (file) setPreviewUrl(URL.createObjectURL(file));
      } catch (e) {
        console.error("[recorder] preview failed", e);
      }
    }
  }, [onOpenInEditor]);

  const begin = useCallback(async () => {
    if (!source || !saveDir || step !== "setup") return;
    setError(null);
    setNotice(null);
    setWarnings([]);
    try {
      const { freeBytes: free } = await recordingStorage(saveDir);
      if (free !== null && free < MIN_START_BYTES) {
        setError({ message: `Only ${formatBytes(free)} free where recordings are saved. Free up space or choose another location.` });
        return;
      }
    } catch (e) {
      setError({ message: errorText(e, "The save location isn't available.") });
      return;
    }
    if (countdown > 0) {
      countdownCancel.current = false;
      setStep("countdown");
      for (let n = countdown; n > 0; n--) {
        setCount(n);
        await new Promise((r) => setTimeout(r, 1000));
        if (countdownCancel.current) {
          setStep("setup");
          return;
        }
      }
    }
    if (hideWindow) await recorderWindow(true).catch(() => {});

    const native = source.nativeSource;
    const video = source.stream.getVideoTracks();
    const tracks: SessionTrackInput[] = native ? [] : [{ kind: "screen", stream: new MediaStream(video) }];
    if (!native && source.hasSystemAudio && wantSystemAudio) tracks.push({ kind: "system-audio", stream: new MediaStream(source.stream.getAudioTracks()) });
    if (micStream) tracks.push({ kind: "microphone", stream: micStream, deviceLabel: micStream.getAudioTracks()[0]?.label });
    if (camStream) tracks.push({ kind: "webcam", stream: new MediaStream(camStream.getVideoTracks()), deviceLabel: camStream.getVideoTracks()[0]?.label });

    const s = native ? { width: outW, height: outH, frameRate: fps } : video[0].getSettings();
    const capture: CaptureInfo = {
      surface: source.surface,
      display,
      desktopUnit: platform === "macos" ? "points" : "physical-pixels",
      region,
      video: { width: s.width ?? outW, height: s.height ?? outH, frameRate: Math.round(s.frameRate ?? fps) },
      requested: { width: resolution === "native" ? null : outW, height: resolution === "native" ? null : Number(resolution), frameRate: fps },
      coordinateSpace: display ? "capture" : "desktop",
      cursorCaptured: cursorInVideo,
      backend: native ? "native" : "webview",
    };
    const useInput = inputOn && inputAvailable;
    const session = new RecordingSession(
      {
        saveDir,
        folderName: folderName(),
        tracks,
        capture,
        input: useInput ? { ...input, sampleHz: input.sampleHz || 60 } : null,
        inputPermissions: {
          mouse: perms?.mouse ?? "unknown",
          keyboard: perms?.keyboard ?? "unknown",
          activeWindow: perms?.activeWindow ?? "unknown",
        },
        videoBitsPerSecond: videoBps,
        audioBitsPerSecond: 128_000,
        app: { version: appVersion, platform },
        surface: display?.bounds ?? null,
        native: native
          ? { source: native.id, fps, maxHeight: resolution === "native" ? null : Number(resolution), cursor: cursorInVideo, systemAudio: wantSystemAudio }
          : null,
      },
      {
        onStatus: (st) => {
          if (st === "recording" || st === "paused" || st === "stopping") setStatus(st);
        },
        onWarning: (w) => setWarnings((list) => (list.includes(w) ? list : [...list, w])),
        onAutoStop: (result, reason) => {
          restoreWindow();
          setNotice(reason);
          void showReview(result, { autoOpen });
        },
      }
    );
    sessionRef.current = session;
    try {
      await session.start();
      setOutputPath(session.path);
      setStatus("recording");
      setStep("recording");
    } catch (e) {
      sessionRef.current = null;
      restoreWindow();
      setError({ message: errorText(e, "The recording couldn't start.") });
      setStep("setup");
    }
  }, [
    source,
    saveDir,
    step,
    countdown,
    hideWindow,
    wantSystemAudio,
    micStream,
    camStream,
    display,
    platform,
    region,
    outW,
    outH,
    fps,
    resolution,
    inputOn,
    inputAvailable,
    input,
    perms,
    videoBps,
    appVersion,
    cursorInVideo,
    restoreWindow,
    showReview,
    autoOpen,
  ]);

  useEffect(() => {
    if (step !== "recording") return;
    const t = setInterval(() => {
      const s = sessionRef.current;
      if (!s) return;
      setElapsed(s.elapsedMs());
      setSizes({ total: s.bytesWritten(), screen: s.screenBytes() });
    }, 250);
    return () => clearInterval(t);
  }, [step]);

  const stop = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    setStatus("stopping");
    try {
      const result = await s.stop();
      restoreWindow();
      await showReview(result, { autoOpen });
    } catch (e) {
      restoreWindow();
      setError({ message: `The recording couldn't be finalized: ${errorText(e, "unknown error")}. What was recorded is still in its folder.` });
      sessionRef.current = null;
      setStep("setup");
    }
  }, [restoreWindow, showReview, autoOpen]);

  const togglePause = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    if (s.state === "recording") s.pause();
    else if (s.state === "paused") s.resume();
  }, []);

  const addMarker = useCallback(() => {
    const m = sessionRef.current?.addMarker();
    if (m) setNotice(`${m.label} added at ${formatDuration(m.tMs)}.`);
  }, []);

  const screenshot = useCallback(async () => {
    try {
      const shot = await sessionRef.current?.screenshot();
      if (shot) setNotice(`Screenshot saved (${shot.path}).`);
    } catch (e) {
      setNotice(`Screenshot failed: ${errorText(e, "unknown error")}`);
    }
  }, []);

  const cancelRecording = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || !(await confirmAction("Discard this recording? It will be deleted.", { okLabel: "Discard" }))) return;
    try {
      await s.cancel();
    } catch (e) {
      setError({ message: errorText(e, "The recording couldn't be deleted.") });
    }
    sessionRef.current = null;
    restoreWindow();
    setStep("setup");
  }, [restoreWindow]);

  // Global hotkeys: always act on the latest state.
  const actions = useRef<Record<ShortcutAction, () => void>>({ toggle: () => {}, pause: () => {}, marker: () => {}, screenshot: () => {} });
  useEffect(() => {
    actions.current = {
      toggle: () => {
        if (step === "setup") void begin();
        else if (step === "countdown") countdownCancel.current = true;
        else if (step === "recording") void stop();
      },
      pause: () => step === "recording" && togglePause(),
      marker: () => step === "recording" && addMarker(),
      screenshot: () => step === "recording" && void screenshot(),
    };
  }, [step, begin, stop, togglePause, addMarker, screenshot]);
  useEffect(() => {
    let off: (() => void) | undefined;
    let cancelled = false;
    void onRecorderShortcut((a) => actions.current[a]?.()).then((fn) => {
      if (cancelled) fn();
      else off = fn;
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

  // Mini player buttons: only ever act on a running recording.
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);
  useEffect(() => {
    let off: (() => void) | undefined;
    let cancelled = false;
    void onMiniAction((a) => {
      if (stepRef.current !== "recording") return;
      if (a === "stop") actions.current.toggle();
      else if (a === "pause") actions.current.pause();
      else if (a === "marker") actions.current.marker();
    }).then((fn) => {
      if (cancelled) fn();
      else off = fn;
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

  // Escape cancels the countdown.
  useEffect(() => {
    if (step !== "countdown") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") countdownCancel.current = true;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  // --- review actions -------------------------------------------------------------------
  const backToSetup = useCallback(() => {
    setFinished(null);
    setPreviewUrl(null);
    setStep("setup");
  }, []);

  const openInEditor = useCallback(async () => {
    if (!finished) return;
    setBusy("Opening in the editor…");
    try {
      const bundle = await loadRecordingBundle(finished.path, finished.manifest);
      onOpenInEditor(bundle);
      backToSetup();
    } catch (e) {
      setError({ message: e instanceof RecordingTooLargeError ? e.message : errorText(e, "Couldn't open the recording.") });
    } finally {
      setBusy(null);
    }
  }, [finished, onOpenInEditor, backToSetup]);

  const retake = useCallback(async () => {
    if (!finished || !(await confirmAction("Delete this recording and record again?", { okLabel: "Delete" }))) return;
    try {
      await recordingDiscard(finished.path);
    } catch (e) {
      setError({ message: errorText(e, "The recording couldn't be deleted.") });
      return;
    }
    backToSetup();
  }, [finished, backToSetup]);

  const save = useCallback(() => {
    if (!finished) return;
    setNotice(`Saved to ${finished.path}`);
    backToSetup();
  }, [finished, backToSetup]);

  const openExisting = useCallback(async () => {
    setError(null);
    try {
      const found = await recordingOpen();
      if (!found) return;
      const manifest = parseManifest(found.manifest);
      const result = manifest.status === "recording" ? await recoverRecording(found) : { path: found.path, manifest };
      await showReview(result);
    } catch (e) {
      setError({ message: e instanceof RecordingFormatError ? e.message : errorText(e, "Couldn't open that recording.") });
    }
  }, [showReview]);

  const recover = useCallback(
    async (found: FoundRecording) => {
      setError(null);
      try {
        const result = await recoverRecording(found);
        setIncomplete((list) => list.filter((f) => f.path !== found.path));
        await showReview(result);
      } catch (e) {
        setError({ message: errorText(e, "This recording couldn't be recovered.") });
      }
    },
    [showReview]
  );

  const discardIncomplete = useCallback(async (found: FoundRecording) => {
    if (!(await confirmAction("Delete this interrupted recording?", { okLabel: "Delete" }))) return;
    try {
      await recordingDiscard(found.path);
      setIncomplete((list) => list.filter((f) => f.path !== found.path));
    } catch (e) {
      setError({ message: errorText(e, "Couldn't delete it.") });
    }
  }, []);

  const requestInputAccess = useCallback(async () => {
    try {
      setPerms(await inputRequestAccess());
    } catch {
      // keep the previous state
    }
  }, []);

  // --- render ----------------------------------------------------------------------------
  const recordingActive = step === "countdown" || step === "recording";
  const unsupported = support && (!support.display || !support.recorder);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background" role="dialog" aria-modal="true" aria-label="Screen recorder">
      <header className="flex items-center gap-3 border-b border-border bg-surface/80 px-4 py-2 backdrop-blur">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-500" aria-hidden />
        <h2 className="font-display text-base font-bold text-foreground">Screen recorder</h2>
        <span className="hidden text-xs text-muted sm:inline">Recorded and saved on this computer - nothing is uploaded.</span>
        <button
          type="button"
          onClick={onClose}
          disabled={recordingActive}
          title={recordingActive ? "Stop the recording first" : "Back to the editor"}
          className="ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold text-muted hover:text-foreground disabled:opacity-40"
        >
          <CloseIcon /> Editor
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
          {error && (
            <Note tone="error">
              {error.message}
              {error.settings && platform !== "web" && (
                <button type="button" className="ml-2 font-semibold underline" onClick={() => void openPrivacySettings(error.settings!).catch(() => {})}>
                  Open settings
                </button>
              )}
            </Note>
          )}
          {notice && <Note tone="info">{notice}</Note>}

          {step === "setup" && (
            <>
              {unsupported && (
                <Note tone="error">
                  {!support!.display
                    ? platform === "macos"
                      ? "Screen capture isn't available in this macOS version's web engine (it needs macOS 13 or newer). Recording is unavailable; the editor works as usual."
                      : "Screen capture isn't available in this system's web engine. Update Microsoft Edge WebView2 and restart WipeClip."
                    : "Video recording (MediaRecorder) isn't available in this system's web engine."}
                </Note>
              )}

              {incomplete.length > 0 && (
                <Note tone="warn">
                  <p className="font-semibold">
                    {incomplete.length === 1 ? "A recording was interrupted" : `${incomplete.length} recordings were interrupted`} when WipeClip closed.
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {incomplete.map((f) => (
                      <li key={f.path} className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 truncate">{f.path}</span>
                        <button type="button" className="font-semibold underline" onClick={() => void recover(f)}>
                          Recover
                        </button>
                        <button type="button" className="underline" onClick={() => void discardIncomplete(f)}>
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                </Note>
              )}

              <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
                <div className="space-y-4">
                  <Section title="1. What to record" hint="A whole display, a single app window, or an area you select on the preview.">
                    {source ? (
                      <>
                        <RegionSelector stream={source.stream} region={region} onChange={setRegion} enabled={regionMode} />
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                          <span className="max-w-full truncate rounded-full border border-border px-2 py-0.5">
                            {source.nativeSource
                              ? source.nativeSource.name
                              : source.surface === "monitor"
                                ? "Entire screen"
                                : source.surface === "window"
                                  ? "Window"
                                  : source.surface === "browser"
                                    ? "Tab"
                                    : "Screen"}{" "}
                            · {source.native.width}×{source.native.height}
                          </span>
                          <button
                            type="button"
                            className="btn-secondary rounded-full px-3 py-1 font-semibold"
                            onClick={() => {
                              if (source.nativeSource) {
                                stopStream(source.stream);
                                setSource(null);
                                setRegion(null);
                                setRegionMode(false);
                              } else void chooseSource();
                            }}
                          >
                            Change
                          </button>
                          <button
                            type="button"
                            className={`rounded-full px-3 py-1 font-semibold ${regionMode ? "btn-primary" : "btn-secondary"}`}
                            onClick={() => setRegionMode((v) => !v)}
                          >
                            {regionMode ? "Done selecting" : "Select area"}
                          </button>
                          {region && (
                            <button type="button" className="underline" onClick={() => setRegion(null)}>
                              Record everything
                            </button>
                          )}
                        </div>
                        {region && (
                          <p className="text-xs text-muted">
                            Area: {Math.round(region.width * source.native.width)}×{Math.round(region.height * source.native.height)}. The full frame is kept and the
                            area becomes the clip&apos;s crop in the editor, so you can still adjust it.
                          </p>
                        )}
                        {(source.surface === "monitor" || source.surface === "unknown") && candidates.length > 1 && (
                          <Select
                            label="Which display is this?"
                            value={displayId ?? ""}
                            onChange={(v) => setDisplayId(v || null)}
                            options={[{ value: "", label: "Not sure" }, ...candidates.map((d) => ({ value: d.id, label: `${d.name}${d.primary ? " (main)" : ""}` }))]}
                          />
                        )}
                        {inputOn && source && !display && (
                          <p className="text-xs text-muted">
                            {source.surface === "window"
                              ? "For a single window, mouse positions are saved in screen coordinates (with the active window's position, if enabled below)."
                              : "The display couldn't be identified, so mouse positions are saved in screen coordinates."}
                          </p>
                        )}
                      </>
                    ) : useNative ? (
                      <SourcePicker onPick={(s) => void pickNative(s)} />
                    ) : (
                      <button
                        type="button"
                        disabled={!support?.display}
                        onClick={() => void chooseSource()}
                        className="flex w-full flex-col items-center justify-center rounded-[1.25rem] border-2 border-dashed border-border px-6 py-12 text-center hover:border-accent-2/50 hover:bg-surface-2/40 disabled:opacity-50"
                      >
                        <span className="text-base font-semibold text-foreground">Choose a screen or window</span>
                        <span className="mt-1 text-xs text-muted">
                          {platform === "windows" ? "To include sound from your computer, pick an entire screen and tick “Share system audio”." : "Your system will ask which screen or window to share."}
                        </span>
                      </button>
                    )}
                    <Toggle
                      checked={hideCursor && (platform !== "windows" || (useNative && !!nativeSupport?.cursorControl))}
                      onChange={setHideCursor}
                      disabled={platform === "windows" && !(useNative && nativeSupport?.cursorControl)}
                      label="Leave the mouse pointer out of the video"
                      hint={
                        useNative && nativeSupport?.cursorControl
                          ? hideCursor
                            ? "Left out - the editor can draw a smooth, resizable pointer from the recorded movement."
                            : "The pointer is recorded in the video."
                          : platform === "windows"
                          ? "Not supported on this version of Windows: the system pointer is always in the video. Click highlights and zooms still work."
                          : source
                          ? source.cursorCaptured
                            ? hideCursor
                              ? "Not supported by this system - the pointer is in the video."
                              : "The pointer is recorded in the video."
                            : "Hidden - the editor can draw a smooth, resizable pointer from the recorded movement."
                          : "Lets the editor draw a smooth pointer instead, where the system supports it. Applies when you choose the source."
                      }
                    />
                    <Toggle
                      checked={wantSystemAudio}
                      onChange={setWantSystemAudio}
                      label="Include system audio"
                      hint={
                        platform === "macos"
                          ? "Not available on macOS with this recorder."
                          : useNative
                          ? "Everything you hear from this computer, saved as its own track."
                          : source
                            ? source.hasSystemAudio
                              ? "Included - recorded as its own track."
                              : "Not shared with the current source. Choose the source again to include it."
                            : "Applies when you choose the source."
                      }
                      disabled={platform === "macos"}
                    />
                    {wantSystemAudio && systemAudioStream && <LevelMeter level={systemLevel} label="System audio level" />}
                  </Section>

                  <Section title="2. Video">
                    <Select
                      label="Resolution"
                      value={resolution}
                      onChange={(v) => {
                        setResolution(v);
                        if (source) void applyVideoConstraints(source, v, fps);
                      }}
                      options={[
                        { value: "native", label: source ? `Native (${source.native.width}×${source.native.height})` : "Native" },
                        { value: "1080", label: "1080p", disabled: !!source && source.native.height < 1080 },
                        { value: "720", label: "720p", disabled: !!source && source.native.height < 720 },
                      ]}
                    />
                    <Select
                      label="Frame rate"
                      value={fps}
                      onChange={(v) => {
                        setFps(v);
                        if (source) void applyVideoConstraints(source, resolution, v);
                      }}
                      options={[
                        { value: 30, label: "30 fps" },
                        { value: 60, label: "60 fps", disabled: !!source?.maxFrameRate && source.maxFrameRate < 60 },
                      ]}
                    />
                    <Select
                      label="Quality"
                      value={quality}
                      onChange={setQuality}
                      options={[
                        { value: "low", label: "Smaller file" },
                        { value: "standard", label: "Standard" },
                        { value: "high", label: "High" },
                      ]}
                    />
                    <p className="text-xs text-muted">
                      {source ? `${outW}×${outH} at ${outFps} fps · ` : ""}about {Math.max(1, Math.round(mbPerMin))} MB per minute. The editor opens recordings up to 300 MB
                      (about {Math.max(1, Math.floor(300 / Math.max(1, mbPerMin)))} min at these settings) and exports up to 10 minutes.
                    </p>
                  </Section>
                </div>

                <div className="space-y-4">
                  <Section title="3. Microphone and camera" hint="Each is saved as its own track, in sync with the screen.">
                    <Select
                      label="Microphone"
                      value={micId}
                      onChange={(v) => void selectMic(v)}
                      disabled={!support?.media}
                      options={deviceOptions("audioinput", "Microphone")}
                    />
                    {micStream && <LevelMeter level={micLevel} label="Microphone level" />}
                    {micStream && micLevel < 0.01 && <p className="text-xs text-muted">No sound yet - speak to check the level.</p>}
                    <Select
                      label="Webcam"
                      value={camId}
                      onChange={(v) => void selectCam(v)}
                      disabled={!support?.media}
                      options={deviceOptions("videoinput", "Camera")}
                    />
                    {camStream && <LivePreview stream={camStream} mirror className="w-40 rounded-lg border border-border bg-black" />}
                    {camStream && <p className="text-xs text-muted">Placed as a picture-in-picture layer in the corner; move or resize it in the editor.</p>}
                  </Section>

                  <Section
                    title="4. Mouse and keyboard"
                    hint="Saved alongside the video (not drawn into it), for cursor effects and auto-zoom in the editor later."
                  >
                    {!inputAvailable ? (
                      <Note tone="info">Mouse and keyboard metadata isn&apos;t available on this system.</Note>
                    ) : (
                      <>
                        <Toggle checked={inputOn} onChange={setInputOn} label="Record mouse and keyboard metadata" />
                        <div className={`space-y-2 pl-7 ${inputOn ? "" : "pointer-events-none opacity-50"}`}>
                          <Toggle checked={input.mouse} onChange={(v) => setInput({ ...input, mouse: v })} label="Pointer movement" />
                          <Toggle checked={input.clicks} onChange={(v) => setInput({ ...input, clicks: v })} label="Clicks" />
                          <Toggle checked={input.scroll} onChange={(v) => setInput({ ...input, scroll: v })} label="Scrolling" />
                          <Toggle
                            checked={input.keyboard === "shortcuts"}
                            onChange={(v) => setInput({ ...input, keyboard: v ? "shortcuts" : "off" })}
                            label="Keyboard shortcuts"
                            hint="Only key combinations like Ctrl+C or Cmd+Shift+4, and function keys. Typed text, passwords and the clipboard are never recorded."
                            disabled={perms?.keyboard === "unsupported"}
                          />
                          <Toggle
                            checked={input.typing !== false}
                            onChange={(v) => setInput({ ...input, typing: v })}
                            label="Typing (for auto zoom)"
                            hint="Only that you're typing and where the text cursor is, so the editor can zoom in on it. Which keys you press is never recorded."
                            disabled={perms?.keyboard === "unsupported"}
                          />
                          {(input.keyboard === "shortcuts" || input.typing !== false) && perms?.keyboard === "denied" && (
                            <Note tone="warn">
                              macOS needs Input Monitoring permission for keyboard shortcuts and typing.{" "}
                              <button type="button" className="font-semibold underline" onClick={() => void requestInputAccess()}>
                                Request access
                              </button>{" "}
                              ·{" "}
                              <button type="button" className="underline" onClick={() => void openPrivacySettings("input").catch(() => {})}>
                                Open settings
                              </button>
                              . After allowing it, quit and reopen WipeClip. Without it, everything else still records.
                            </Note>
                          )}
                          <Toggle
                            checked={input.activeWindow}
                            onChange={(v) => setInput({ ...input, activeWindow: v, windowTitles: v && input.windowTitles })}
                            label="Active app changes"
                            hint="Which app is in front and where its window is."
                          />
                          {input.activeWindow && (
                            <Toggle
                              checked={input.windowTitles}
                              onChange={(v) => setInput({ ...input, windowTitles: v })}
                              label="Include window titles"
                              hint="Titles can contain document names or email subjects."
                            />
                          )}
                          <Select
                            label="Pointer samples"
                            value={input.sampleHz}
                            onChange={(v) => setInput({ ...input, sampleHz: v })}
                            options={[
                              { value: 30, label: "30 per second" },
                              { value: 60, label: "60 per second" },
                              { value: 120, label: "120 per second" },
                            ]}
                          />
                        </div>
                      </>
                    )}
                  </Section>

                  <Section title="5. Recording">
                    <Select
                      label="Countdown"
                      value={countdown}
                      onChange={setCountdown}
                      options={[
                        { value: 0, label: "None" },
                        { value: 3, label: "3 seconds" },
                        { value: 5, label: "5 seconds" },
                        { value: 10, label: "10 seconds" },
                      ]}
                    />
                    <Toggle checked={hideWindow} onChange={setHideWindow} label="Minimize WipeClip while recording" hint="Use the hotkeys below to control it." />
                    {useNative && (
                      <Toggle
                        checked={showMini}
                        onChange={setShowMini}
                        label="Show a mini player while recording"
                        hint="A small window on top with what's being recorded, the time, Pause and Stop. It never shows up in the video."
                      />
                    )}
                    {useNative && (
                      <Toggle
                        checked={keepOut}
                        onChange={setKeepOut}
                        label="Hide WipeClip from the recording"
                        hint="WipeClip stays on your screen but never shows up in the video."
                      />
                    )}
                    <Toggle checked={autoOpen} onChange={setAutoOpen} label="Open in the editor when recording stops" hint="Off: review it here first (preview, retake, save)." />
                    <div className="text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-foreground">Save to</span>
                        <button
                          type="button"
                          className="text-xs font-semibold text-accent-2 underline"
                          onClick={() => void recordingChooseDir().then((d) => d && setSaveDir(d)).catch((e) => setError({ message: errorText(e, "Couldn't choose that folder.") }))}
                        >
                          Change
                        </button>
                      </div>
                      <p className="mt-0.5 break-all text-xs text-muted">{saveDir ?? "…"}</p>
                      {freeBytes !== null && (
                        <p className={`mt-0.5 text-xs ${freeBytes < LOW_DISK_BYTES ? "font-semibold text-rose-600 dark:text-rose-400" : "text-muted"}`}>
                          {formatBytes(freeBytes)} free{freeBytes < LOW_DISK_BYTES ? " - running low" : ` · about ${Math.floor(freeBytes / 1024 / 1024 / Math.max(1, mbPerMin))} min of recording`}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-muted">Each recording gets its own new folder; existing recordings are never overwritten.</p>
                    </div>
                    {shortcuts.length > 0 && (
                      <ul className="space-y-0.5 text-xs text-muted">
                        {shortcuts.map((s) => (
                          <li key={s.action} className="flex justify-between gap-2">
                            <span>{{ toggle: "Start / stop", pause: "Pause / resume", marker: "Add marker", screenshot: "Screenshot" }[s.action]}</span>
                            <span className={s.error ? "text-amber-600 dark:text-amber-300" : "font-mono"} title={s.error ?? undefined}>
                              {s.error ? "unavailable (in use)" : s.accelerator.replace("CommandOrControl", platform === "macos" ? "Cmd" : "Ctrl").replace("Alt", platform === "macos" ? "Option" : "Alt")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Section>
                </div>
              </div>

              <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 py-3 backdrop-blur">
                <button
                  type="button"
                  disabled={!source || !saveDir || !!unsupported}
                  onClick={() => void begin()}
                  className="btn-primary inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold disabled:opacity-50"
                >
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-500" aria-hidden /> Start recording
                </button>
                <button type="button" onClick={() => void openExisting()} className="btn-secondary rounded-full px-4 py-2.5 text-sm font-semibold">
                  Open a recording…
                </button>
                {!source && <span className="text-xs text-muted">Choose what to record first.</span>}
              </div>
            </>
          )}

          {step === "countdown" && (
            <div className="flex flex-col items-center justify-center gap-4 py-24 text-center" role="status" aria-live="assertive">
              <p className="font-display text-8xl font-bold tabular-nums text-foreground">{count}</p>
              <p className="text-sm text-muted">Recording starts in {count}… Press Esc to cancel.</p>
              <button type="button" className="btn-secondary rounded-full px-4 py-2 text-sm font-semibold" onClick={() => (countdownCancel.current = true)}>
                Cancel
              </button>
            </div>
          )}

          {step === "recording" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-surface-2/50 p-4">
                <span
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${status === "paused" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-rose-500/15 text-rose-600 dark:text-rose-400"}`}
                  role="status"
                >
                  <span className={`h-2 w-2 rounded-full ${status === "paused" ? "bg-amber-500" : "animate-pulse bg-rose-500"}`} aria-hidden />
                  {status === "paused" ? "Paused" : status === "stopping" ? "Saving…" : "Recording"}
                </span>
                <span className="font-display text-3xl font-bold tabular-nums text-foreground">{formatDuration(elapsed)}</span>
                <span className="text-xs text-muted">{formatBytes(sizes.total)} written</span>
                <div className="ml-auto flex flex-wrap gap-2">
                  <button type="button" onClick={togglePause} disabled={status === "stopping"} className="btn-secondary rounded-full px-4 py-2 text-sm font-semibold">
                    {status === "paused" ? "Resume" : "Pause"}
                  </button>
                  <button type="button" onClick={addMarker} disabled={status === "stopping"} className="btn-secondary rounded-full px-4 py-2 text-sm font-semibold">
                    Marker
                  </button>
                  <button type="button" onClick={() => void screenshot()} disabled={status === "stopping"} className="btn-secondary rounded-full px-4 py-2 text-sm font-semibold">
                    Screenshot
                  </button>
                  <button type="button" onClick={() => void stop()} disabled={status === "stopping"} className="btn-primary rounded-full px-5 py-2 text-sm font-semibold">
                    Stop
                  </button>
                  <button type="button" onClick={() => void cancelRecording()} disabled={status === "stopping"} className="rounded-full px-3 py-2 text-sm font-semibold text-rose-600 hover:underline dark:text-rose-400">
                    Cancel
                  </button>
                </div>
              </div>
              <p className="break-all text-xs text-muted">Saving to {outputPath}</p>
              {source && <LivePreview stream={source.stream} className="mx-auto max-h-[45vh] w-full rounded-xl border border-border bg-black object-contain" />}
              {elapsed > EXPORT_MAX_MS && <Note tone="warn">Past 10 minutes: the recording keeps saving, but the editor exports videos up to 10 minutes.</Note>}
              {sizes.screen > EDITOR_MAX_VIDEO_BYTES && <Note tone="warn">Over 300 MB: the recording keeps saving, but it&apos;s too large to open in the editor.</Note>}
              {warnings.map((w) => (
                <Note key={w} tone="warn">
                  {w}
                </Note>
              ))}
            </div>
          )}

          {step === "review" && !finished && <p className="py-16 text-center text-sm text-muted">{busy ?? "Opening in the editor…"}</p>}
          {step === "review" && finished && (
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
                <div>
                  {previewUrl ? (
                    <video src={previewUrl} controls className="w-full rounded-xl border border-border bg-black" />
                  ) : (
                    <div className="flex aspect-video items-center justify-center rounded-xl border border-border bg-surface-2 p-6 text-center text-sm text-muted">
                      {(finished.manifest.tracks.find((t) => t.kind === "screen")?.bytes ?? 0) > EDITOR_MAX_VIDEO_BYTES
                        ? "Too large to preview here. Use Show in folder to play it."
                        : "Loading preview…"}
                    </div>
                  )}
                </div>
                <Section title="Recording saved">
                  <p className="break-all text-xs text-muted">{finished.path}</p>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted">Length</dt>
                    <dd className="text-foreground">{formatDuration(finished.manifest.durationMs)}</dd>
                    {finished.manifest.tracks.map((t) => (
                      <div key={t.kind} className="contents">
                        <dt className="text-muted">{{ screen: "Screen", "system-audio": "System audio", microphone: "Microphone", webcam: "Webcam" }[t.kind]}</dt>
                        <dd className="text-foreground">
                          {formatBytes(t.bytes)}
                          {t.endedEarly ? " (ended early)" : ""}
                        </dd>
                      </div>
                    ))}
                    <dt className="text-muted">Mouse/keyboard events</dt>
                    <dd className="text-foreground">{finished.manifest.input.path ? finished.manifest.input.eventCount.toLocaleString() : "off"}</dd>
                    {finished.manifest.markers.length > 0 && (
                      <>
                        <dt className="text-muted">Markers</dt>
                        <dd className="text-foreground">{finished.manifest.markers.map((m) => formatDuration(m.tMs)).join(", ")}</dd>
                      </>
                    )}
                    {finished.manifest.screenshots.length > 0 && (
                      <>
                        <dt className="text-muted">Screenshots</dt>
                        <dd className="text-foreground">{finished.manifest.screenshots.length}</dd>
                      </>
                    )}
                  </dl>
                  {finished.manifest.warnings.map((w) => (
                    <Note key={w} tone="warn">
                      {w}
                    </Note>
                  ))}
                </Section>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={!!busy} onClick={() => void openInEditor()} className="btn-primary rounded-full px-5 py-2.5 text-sm font-semibold">
                  {busy ?? "Open in editor"}
                </button>
                <button type="button" onClick={save} className="btn-secondary rounded-full px-4 py-2.5 text-sm font-semibold">
                  Save
                </button>
                <button type="button" onClick={() => void retake()} className="btn-secondary rounded-full px-4 py-2.5 text-sm font-semibold">
                  Retake
                </button>
                <button
                  type="button"
                  onClick={() => void recordingReveal(finished.path).catch((e) => setError({ message: errorText(e, "Couldn't open the folder.") }))}
                  className="rounded-full px-4 py-2.5 text-sm font-semibold text-muted hover:text-foreground"
                >
                  Show in folder
                </button>
              </div>
              <ToolFeedback tool="screen_recorder" className="" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
