"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AuthStatus from "@/components/AuthStatus";
import Logo from "@/components/Logo";
import SignInModal from "@/components/SignInModal";
import ThemeToggle from "@/components/ThemeToggle";
import { trackEvent, useToolView } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";
import { apiFetch, confirmAction, IS_DESKTOP, openNotices, saveExportFile, showDesktopError, watchOpenedProjectFiles } from "@/lib/platform";
import { createClock, useClockTime, type Clock } from "@/lib/editor/clock";
import { useProjectHistory } from "@/lib/editor/history";
import {
  generateThumbnails,
  generateWaveform,
  MAX_WAVE_FILE_BYTES,
  loadAudioMeta,
  loadVideoMeta,
  normalizeImage,
  type ThumbnailStrip,
  type Waveform,
} from "@/lib/editor/media";
import {
  clearLastExport,
  deleteProject,
  isProjectProblem,
  listProjects,
  loadLastExport,
  loadProject,
  nameFromFile,
  newProjectInfo,
  renameProject,
  saveProject,
  saveSource,
  tidyProjects,
  type ProjectInfo,
  type ProjectSummary,
} from "@/lib/editor/projectStore";
import { createProjectFile, PROJECT_FILE_EXT, ProjectFileError, projectFileName, readProjectFile } from "@/lib/editor/projectFile";
import { useOverlayRasters } from "@/lib/editor/rasters";
import { sourceFile, sourceInput, sourceName, sourceSize } from "@/lib/editor/sourceFile";
import { chooseVideoOnDisk, diskMediaUrl, openDiskMedia } from "@/lib/platform/media";
import { getStickerDef, stickerThumbSrc } from "@/lib/editor/stickers";
import { DEFAULT_TEXT } from "@/lib/editor/textRaster";
import {
  EFFECT_LABELS,
  canvasSize as canvasSizeOf,
  clipVisualSpan,
  deleteClip,
  formatTime,
  layout,
  locate,
  moveClip,
  newId,
  restackOverlay,
  splitAt,
  insertFreezeAt,
  splitAudioAt,
  updateAudio,
  updateClip,
  updateEffect,
  updateOverlay,
  type LaidOutClip,
} from "@/lib/editor/timeline";
import {
  DEFAULT_CANVAS,
  DEFAULT_POINTER,
  newClip,
  type CameraZoom,
  type AudioClip,
  type Clip,
  type EffectClip,
  type EffectType,
  type Look,
  type DiskMedia,
  type MediaSource,
  type Overlay,
  type Project,
  type Selection,
  type TextStyle,
  type Transcript,
} from "@/lib/editor/types";
import { ApiError, cleanAudio, ContentBlockedError, probeVideo } from "@/lib/toolsApi";
import type { RecordingBundle } from "@/lib/recorder/bundle";
import { recordingToSources } from "@/lib/recorder/editorImport";
import { planRecordingProject, type ImportedTrack } from "@/lib/recorder/importPlan";
import { sourceTimeOf, timelineTimeOf, zoomSpans } from "@/lib/editor/camera";
import { MIN_ZOOM_LENGTH, dragZoom, mergeSuggestions, patchZoom, removeZoom, splitZoom as splitZoomAt } from "@/lib/editor/zoomEdits";
import { analyzeFocus, type FocusSettings } from "@/lib/editor/focus";
import { buildPointerTrack, pointerAt, recordingEvents } from "@/lib/editor/pointer";
import { FocusPanel, ZoomPanel, type AnalysisState } from "./FocusPanel";
import MaskEditLayer from "./MaskEditLayer";
import { SHAPE_LABELS } from "@/lib/editor/shapes";
import { MaskPanel, TutorialPanel } from "./TutorialPanel";
import { useTutorialTools } from "./useTutorialTools";
import { captionCues, toPlainTranscript, toSrt, toVtt } from "@/lib/editor/transcript";
import { buildSpeechMix, speechModel, speechModelCached, type SpeechModel } from "@/lib/editor/captions";
import { ANALYSIS_RATE } from "@/lib/editor/audioAnalysis";
import { saveTextFile } from "@/lib/platform";
import {
  buildSpeechAudio,
  captionOverlays,
  captionText,
  CAPTION_STYLES,
  groupWords,
  lineCharsFor,
  speechModelProbe,
  transcribe,
  type CaptionsProgress,
} from "@/lib/editor/captions";
import { TIER_LIMITS, toTier, type Tier } from "@/lib/entitlements";
import AiCleanupDialog from "./AiCleanupDialog";
import ExportDialog from "./ExportDialog";
import { ActionButton, ClipPanel, PanelShell, TransitionPanel } from "./Inspector";
import OverlayLayer from "./OverlayLayer";
import RecentProjects from "./RecentProjects";
import TranscriptPanel from "./TranscriptPanel";
import { cutWords, transcriptCurrent } from "@/lib/editor/wordEdit";
import {
  AudioAddPanel,
  AudioPanel,
  CanvasPanel,
  ClipExtras,
  EFFECT_ICONS,
  EffectPanel,
  EffectsAddPanel,
  ElementsPanel,
  CaptionsPanel,
  type CaptionOptions,
  LayersPanel,
  LookPanel,
  OverlayPanel,
  TextAddPanel,
  type Gesture,
} from "./Panels";
import PreviewPlayer from "./PreviewPlayer";
import { MAX_VOICEOVER_SECONDS, startVoiceover, type VoiceoverSession } from "@/lib/editor/voiceover";
import {
  animateClipPatch,
  animateOverlayPatch,
  clipKeyTime,
  clipKeyTimeToLocal,
  clipTransformAt,
  overlayValues,
} from "@/lib/editor/keyframes";
import { PremiumLocked, type KeyframeControls } from "./Panels";
import { activeRamp } from "@/lib/editor/speed";
import { DEFAULT_DUCK_AMOUNT, speechRegions } from "@/lib/editor/ducking";
import { BEAT_RATE, detectBeats } from "@/lib/editor/beats";
import { renderSfx } from "@/lib/editor/sfx";
import { parseCube } from "@/lib/editor/lut";
import { asFontFile, customFontKey, registerFont } from "@/lib/editor/customFonts";
import { EDITOR_FONT_CLASSES } from "./editorFonts";
import {
  clipAttributes,
  layerAttributes,
  pasteClipAttributes,
  pasteLayerAttributes,
  type ClipAttributes,
  type LayerAttributes,
} from "@/lib/editor/attributes";
import { AI_CLEANUP_ENABLED } from "@/lib/features";
import Timeline, { type ItemMode, type TimelineTrack, type TrackToggle } from "./Timeline";
import {
  AdjustIcon,
  CanvasIcon,
  EffectIcon,
  ElementsIcon,
  ExportIcon,
  FilterIcon,
  FullscreenIcon,
  LayersIcon,
  MusicIcon,
  MuteIcon,
  PauseIcon,
  PlayIcon,
  RedoIcon,
  SparkleIcon,
  SplitIcon,
  FreezeIcon,
  TextIcon,
  CaptionsIcon,
  TransitionIcon,
  TrashIcon,
  TrimIcon,
  UndoIcon,
  UploadIcon,
  VolumeIcon,
  ZoomInIcon,
} from "./icons";

const TOOL = "video_editor";
const MAX_BYTES = 300 * 1024 * 1024;
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const EMPTY: Project = { clips: [], overlays: [], audio: [], effects: [], canvas: DEFAULT_CANVAS };
const RATES = [0.5, 1, 1.5, 2];

type Tool = "text" | "captions" | "transcript" | "elements" | "audio" | "effects" | "filters" | "adjust" | "canvas" | "layers" | "focus" | "tutorial";
type Dialogs = { kind: "cleanup"; clipId: string; frameTime: number } | { kind: "export" } | null;
type ClipboardItem = { kind: "overlay"; item: Overlay } | { kind: "audio"; item: AudioClip } | { kind: "effect"; item: EffectClip };

/** A finished screen recording to open (desktop app, see
 * desktop/app/page.tsx). `key` changes for every new request. */
export interface IncomingRecording {
  key: number;
  bundle: RecordingBundle;
}

/** Desktop-only props:
 *  - `onRecord` adds "Record screen" buttons that open the recorder,
 *  - `onImageTools` adds "Image tools" buttons (background removal,
 *    sharpening, frame grabs),
 *  - `incomingRecording` opens a recording as a new project and reports
 *    the outcome through `onRecordingImported`,
 *  - `suspended` turns the editor's keyboard shortcuts off while the
 *    recorder covers it.
 */
const selIs = (sel: Selection, kind: string, id: string) => sel !== null && sel.kind === kind && "id" in sel && sel.id === id;

/** Whole-track hide/lock switches: on when every layer has it. */
const layerToggles = (layers: Overlay[]): TrackToggle[] => [
  { kind: "hide", on: layers.length > 0 && layers.every((o) => o.hidden) },
  { kind: "lock", on: layers.length > 0 && layers.every((o) => o.locked) },
];

export default function VideoEditor({
  onRecord,
  onImageTools,
  incomingRecording,
  onRecordingImported,
  suspended = false,
}: {
  onRecord?: () => void;
  onImageTools?: () => void;
  incomingRecording?: IncomingRecording | null;
  onRecordingImported?: (key: number, error: string | null) => void;
  suspended?: boolean;
}) {
  useToolView(TOOL);
  const clock = useMemo(() => createClock(), []);
  const { project, canUndo, canRedo, apply, beginGesture, endGesture, undo, redo, reset } = useProjectHistory(EMPTY);

  const [phase, setPhase] = useState<"loading" | "import" | "probing" | "edit">("loading");
  const [importError, setImportError] = useState<{ message: string; blocked?: boolean } | null>(null);
  const [recents, setRecents] = useState<ProjectSummary[]>([]);
  /** The open project's id and name (null on the start screen). */
  const [info, setInfo] = useState<ProjectInfo | null>(null);
  const [sources, setSources] = useState<Record<string, MediaSource>>({});
  const [originalId, setOriginalId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [tool, setTool] = useState<Tool | null>(null);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, ThumbnailStrip>>({});
  const [waves, setWaves] = useState<Record<string, Waveform>>({});
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [captionOpts, setCaptionOpts] = useState<CaptionOptions>({ language: "auto", maxWords: 3, style: "bold", y: 0.82 });
  const [captioning, setCaptioning] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [signedInTier, setSignedInTier] = useState<Tier>("free");
  const [showSignIn, setShowSignIn] = useState(false);
  const [pendingExport, setPendingExport] = useState<Blob | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const projectFileInput = useRef<HTMLInputElement>(null);
  /** What the start screen's spinner says while a file opens. */
  const [opening, setOpening] = useState<string | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const thumbJobs = useRef(new Map<string, AbortController>()); // thumbnail + "wave:" jobs
  const waveQueue = useRef<Promise<void>>(Promise.resolve());
  const clipboard = useRef<ClipboardItem | null>(null);

  const original = originalId ? sources[originalId] : undefined;
  const lay = useMemo(() => layout(project, original?.fps ?? 30), [project, original?.fps]);
  const layRef = useRef(lay);
  useEffect(() => {
    layRef.current = lay;
  }, [lay]);
  const canvasSize = useMemo(
    () => (original ? canvasSizeOf(project.canvas.aspect, original.width, original.height) : { width: 16, height: 9 }),
    [project.canvas.aspect, original]
  );

  const say = useCallback((message: string) => setToast(message), []);
  /** Stores a source for reopening the project later; says so when that
   * fails, instead of letting the user believe the project is safe. */
  const keepForRecovery = useCallback(
    (src: MediaSource) =>
      void saveSource(src).then((ok) => {
        if (!ok) say(`"${sourceName(src)}" couldn't be saved on this device (storage may be full), so this project can't be reopened after closing. Export before you close WipeClip.`);
      }),
    [say]
  );
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const rasters = useOverlayRasters(project.overlays, sources, say);
  const gesture: Gesture = useMemo(() => ({ onGestureStart: beginGesture, onGestureEnd: endGesture }), [beginGesture, endGesture]);

  // --- auth (download gating, resolution tiers) - same as UploadDemo ----
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setIsSignedIn(Boolean(data.user)));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setIsSignedIn(Boolean(session?.user)));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Plan tier drives the premium badges and the export dialog's limits;
  // /api/export enforces the same rules server side.
  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    const load = () =>
      apiFetch("/api/credits")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled && d) setSignedInTier(toTier(d.plan));
        })
        .catch(() => {});
    void load();
    window.addEventListener("credits:refresh", load);
    return () => {
      cancelled = true;
      window.removeEventListener("credits:refresh", load);
    };
  }, [isSignedIn]);
  const tier: Tier = isSignedIn ? signedInTier : "free";
  const premiumLocked = !TIER_LIMITS[tier].premiumEffects;

  // --- saved projects -------------------------------------------------------
  const refreshRecents = useCallback(() => listProjects().then(setRecents), []);
  useEffect(() => {
    let cancelled = false;
    // Housekeeping first, while nothing is open (see tidyProjects).
    Promise.all([tidyProjects().then(listProjects), loadLastExport()]).then(([saved, lastExport]) => {
      if (cancelled) return;
      setRecents(saved);
      setPendingExport(lastExport);
      setPhase("import");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Revoke object URLs and stop thumbnail jobs on unmount.
  const sourcesRef = useRef(sources);
  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);
  useEffect(() => {
    const jobs = thumbJobs.current;
    return () => {
      jobs.forEach((c) => c.abort());
      Object.values(sourcesRef.current).forEach((s) => URL.revokeObjectURL(s.url));
    };
  }, []);

  // Autosave the (small) project record; source files are saved once when
  // added. `pendingSave` holds what the next autosave would write, so
  // switching or closing a project can write it at once (`saveNow`)
  // instead of dropping the last 800 ms of edits.
  const listThumb = thumbs[project.clips[0]?.sourceId ?? ""]?.urls[0] ?? null;
  const pendingSave = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    if (phase !== "edit" || project.clips.length === 0 || !info) return;
    const save = () => saveProject(info, project, Object.values(sources), listThumb);
    pendingSave.current = save;
    const t = setTimeout(() => {
      pendingSave.current = null;
      void save();
    }, 800);
    return () => clearTimeout(t);
  }, [project, sources, phase, info, listThumb]);
  const saveNow = useCallback(async () => {
    const save = pendingSave.current;
    pendingSave.current = null;
    if (save) await save();
  }, []);

  // Text fonts: the self-hosted ones' variables on <html> (where the text
  // rasterizer resolves them), and every uploaded font registered.
  useEffect(() => {
    document.documentElement.classList.add(...EDITOR_FONT_CLASSES);
    return () => document.documentElement.classList.remove(...EDITOR_FONT_CLASSES);
  }, []);
  useEffect(() => {
    for (const src of Object.values(sources)) {
      if (src.kind === "font") void registerFont(src.id, () => sourceFile(src)).catch(() => {});
    }
  }, [sources]);

  // Thumbnails for every video source, generated once each in the background.
  useEffect(() => {
    for (const src of Object.values(sources)) {
      if (src.kind === "audio" || src.kind === "image" || src.kind === "lut" || src.kind === "font" || thumbJobs.current.has(src.id)) continue;
      const controller = new AbortController();
      thumbJobs.current.set(src.id, controller);
      void generateThumbnails(src.url, src.duration, (strip) => setThumbs((t) => ({ ...t, [src.id]: strip })), controller.signal);
    }
  }, [sources]);

  // Audio waveforms, one at a time - decoding holds the whole file in memory.
  useEffect(() => {
    for (const src of Object.values(sources)) {
      const key = `wave:${src.id}`;
      if (src.kind === "image" || !src.hasAudio || thumbJobs.current.has(key)) continue;
      const controller = new AbortController();
      thumbJobs.current.set(key, controller);
      waveQueue.current = waveQueue.current.then(async () => {
        if (controller.signal.aborted) return;
        // A disk source over the limit isn't read at all just to be skipped.
        if (sourceSize(src) > MAX_WAVE_FILE_BYTES) return;
        const file = await sourceFile(src).catch(() => null);
        if (!file || controller.signal.aborted) return;
        const wave = await generateWaveform(file, controller.signal);
        if (wave && !controller.signal.aborted) setWaves((w) => ({ ...w, [src.id]: wave }));
      });
    }
  }, [sources]);

  // --- project lifecycle ---------------------------------------------------
  const startProject = useCallback(
    (srcs: MediaSource[], next: Project, nextInfo: ProjectInfo) => {
      thumbJobs.current.forEach((c) => c.abort());
      thumbJobs.current.clear();
      Object.values(sourcesRef.current).forEach((s) => URL.revokeObjectURL(s.url));
      setThumbs({});
      setWaves({});
      setSources(Object.fromEntries(srcs.map((s) => [s.id, s])));
      setOriginalId(srcs.find((s) => s.kind === "original")?.id ?? srcs[0].id);
      reset(next);
      clock.set(0);
      setPlaying(false);
      setSelection(null);
      setTool(null);
      setInfo(nextInfo);
      setPhase("edit");
    },
    [reset, clock]
  );

  /** Opens a .wipeclip project file as a new project in the list. Its
   * videos are slices of the picked file, then stored like any project's. */
  const openProjectFile = useCallback(
    async (file: File) => {
      setImportError(null);
      await saveNow();
      setOpening("Opening project file…");
      setPhase("probing");
      try {
        const opened = await readProjectFile(file);
        await clearLastExport();
        setPendingExport(null);
        startProject(opened.sources, opened.project, newProjectInfo(opened.name));
        opened.sources.forEach(keepForRecovery);
      } catch (e) {
        console.error("[editor] project file open failed", e);
        setImportError({ message: e instanceof ProjectFileError ? e.message : "Couldn't open this project file." });
        setInfo(null);
        setPhase("import");
        void refreshRecents();
      } finally {
        setOpening(null);
      }
    },
    [startProject, keepForRecovery, saveNow, refreshRecents]
  );

  // Project files double-clicked in the OS (desktop), once startup
  // housekeeping is done; one at a time, each becomes a new project.
  const openProjectFileRef = useRef(openProjectFile);
  useEffect(() => {
    openProjectFileRef.current = openProjectFile;
  }, [openProjectFile]);
  const ready = phase !== "loading";
  useEffect(() => {
    if (!ready) return;
    return watchOpenedProjectFiles(
      (file) => openProjectFileRef.current(file),
      (message) => setImportError({ message })
    );
  }, [ready]);

  /** Opens a video as a new project: a File (website, or dropped on the
   * desktop app), or a video picked in the desktop app's open dialog, which
   * stays where it is on disk - streamed for playback, read by path by the
   * local engine, kept by path in the project - so it has no size limit. */
  const importFile = useCallback(
    async (input: File | DiskMedia | null | undefined) => {
      if (!input) return;
      const file = input instanceof File ? input : null;
      if (file?.name.toLowerCase().endsWith(`.${PROJECT_FILE_EXT}`)) return openProjectFile(file);
      trackEvent("file_selected", { tool: TOOL });
      setImportError(null);
      if (file && !file.type.startsWith("video/")) {
        setImportError({ message: "Please choose a video file (MP4, MOV or WebM)." });
        return;
      }
      if (file && file.size > MAX_BYTES) {
        setImportError({
          message: IS_DESKTOP
            ? "That file is over 300MB. Click the box below to pick it instead: videos picked there are edited where they are, at any size."
            : "That file is over the 300MB limit. Try a shorter or smaller video.",
        });
        return;
      }
      // Opening a video starts a new project; an open one stays in Recent projects.
      await saveNow();
      setPhase("probing");
      const url = file ? URL.createObjectURL(file) : await diskMediaUrl((input as DiskMedia).path);
      try {
        // Browser decode check (codec support, display size, exact
        // duration) and the server's own validation + content screening,
        // in parallel. The server check is the one that counts.
        const [meta, probe] = await Promise.all([loadVideoMeta(url), probeVideo(input)]);
        URL.revokeObjectURL(probe.previewUrl);
        const src: MediaSource = {
          id: newId("src"),
          kind: "original",
          file,
          ...(file ? {} : { disk: input as DiskMedia }),
          url,
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
          fps: probe.info.fps > 0 && probe.info.fps <= 240 ? probe.info.fps : 30,
          hasAudio: probe.info.hasAudio ?? true,
        };
        await clearLastExport();
        setPendingExport(null);
        startProject([src], { ...EMPTY, clips: [newClip(newId("clip"), src.id, 0, meta.duration)] }, newProjectInfo(nameFromFile(input.name)));
        keepForRecovery(src);
      } catch (e) {
        if (file) URL.revokeObjectURL(url);
        console.error("[editor] import failed", e);
        let message = "Couldn't open this video. It may be damaged or in an unsupported format.";
        let blocked = false;
        if (e instanceof ContentBlockedError) {
          message = e.message;
          blocked = true;
        } else if (e instanceof Error && e.message === "media_error") {
          message = "Your browser can't play this video's format. Try an MP4 (H.264) file.";
        } else if (e instanceof ApiError) {
          message = e.message;
        } else if (e instanceof TypeError) {
          message = "Couldn't reach WipeClip to check this video. Check your connection and try again.";
        }
        setImportError({ message, blocked });
        setInfo(null);
        setPhase("import");
        void refreshRecents();
      }
    },
    [startProject, keepForRecovery, saveNow, refreshRecents, openProjectFile]
  );

  /** Opens a screen recording as a new project, entirely locally: the
   * recording is the user's own capture, already on their disk, so unlike
   * importFile it isn't uploaded for the server check. Its tracks stay
   * separate (screen clip, system audio and microphone tracks, webcam
   * layer), lined up by importPlan.ts; the interaction events ride along
   * on the screen source for later cursor and zoom effects. */
  const importRecording = useCallback(
    async (bundle: RecordingBundle): Promise<string | null> => {
      setImportError(null);
      await saveNow();
      setPhase("probing");
      let made: MediaSource[] = [];
      try {
        const { manifest } = bundle;
        const prepared = await recordingToSources(bundle, "original");
        made = prepared.made;
        const imported: ImportedTrack[] = prepared.imported;
        const plan = planRecordingProject(manifest, imported, () => newId("rec"));
        // Click highlights on by default when the clicks can be placed on
        // the video; the drawn cursor only if the video has no cursor of its own.
        const mappable = bundle.events.length > 0 && manifest.capture.coordinateSpace === "capture";
        if (mappable) plan.project.pointer = { ...DEFAULT_POINTER, cursor: manifest.capture.cursorCaptured === false };
        await clearLastExport();
        setPendingExport(null);
        startProject(made, plan.project, newProjectInfo(`Recording ${new Date(manifest.createdAt || Date.now()).toLocaleString()}`));
        made.forEach(keepForRecovery);
        // Next step of the workflow: analyze interactions (or skip it).
        if (mappable) setTool("focus");
        trackEvent("file_selected", { tool: TOOL });
        return null;
      } catch (e) {
        made.forEach((s) => URL.revokeObjectURL(s.url));
        console.error("[editor] recording import failed", e);
        const message =
          e instanceof Error && e.message === "media_error"
            ? "This recording's video can't be played on this system."
            : e instanceof Error && e.message
              ? e.message
              : "Couldn't open this recording.";
        setImportError({ message });
        setInfo(null);
        setPhase("import");
        void refreshRecents();
        return message;
      }
    },
    [startProject, keepForRecovery, saveNow, refreshRecents]
  );

  // Recordings handed over by the desktop recorder, once recovery has been checked.
  const handledRecording = useRef<number | null>(null);
  useEffect(() => {
    if (!incomingRecording || phase === "loading" || phase === "probing" || handledRecording.current === incomingRecording.key) return;
    handledRecording.current = incomingRecording.key;
    const { key, bundle } = incomingRecording;
    queueMicrotask(() => void importRecording(bundle).then((error) => onRecordingImported?.(key, error)));
  }, [incomingRecording, phase, importRecording, onRecordingImported]);

  /** Makes a reopened project's disk sources playable again. One that was
   * moved or deleted is found again by the user (relinked: same source, new
   * path). false if one wasn't found. */
  const linkDiskSources = useCallback(async (srcs: MediaSource[]): Promise<boolean> => {
    const onDisk = srcs.filter((s) => s.disk);
    if (onDisk.length === 0) return true;
    const status = await openDiskMedia(onDisk.map((s) => s.disk!.path));
    for (const s of onDisk) {
      if (!status.get(s.disk!.path)?.ok) {
        const ask = `"${s.disk!.name}" isn't where it was (${s.disk!.path}). It may have been moved, renamed or deleted. Find it to keep editing this project.`;
        if (!(await confirmAction(ask, { title: "Video not found", okLabel: "Find video" }))) return false;
        const found = await chooseVideoOnDisk(s.disk!.name);
        if (!found) return false;
        s.disk = found;
      }
      s.url = await diskMediaUrl(s.disk!.path);
    }
    return true;
  }, []);

  const openSaved = useCallback(
    async (id: string) => {
      setImportError(null);
      const saved = await loadProject(id);
      if (isProjectProblem(saved)) {
        setImportError({ message: saved.problem });
        return;
      }
      let linked = false;
      try {
        linked = await linkDiskSources(saved.sources);
      } catch (e) {
        console.error("[editor] relinking failed", e);
      }
      if (!linked) {
        saved.sources.forEach((s) => s.file && URL.revokeObjectURL(s.url));
        setImportError({ message: `"${saved.info.name}" can't open until its videos are found. Open it again to look for them.` });
        return;
      }
      startProject(saved.sources, saved.project, saved.info);
    },
    [startProject, linkDiskSources]
  );

  const removeSaved = useCallback(
    async (p: ProjectSummary) => {
      if (!(await confirmAction(`Delete "${p.name}"? Its edits can't be recovered afterwards. Your original video files are not affected.`, { okLabel: "Delete project" }))) return;
      await deleteProject(p.id);
      await refreshRecents();
    },
    [refreshRecents]
  );

  const renameSaved = useCallback(
    async (id: string, name: string) => {
      await renameProject(id, name);
      await refreshRecents();
    },
    [refreshRecents]
  );

  const addSource = useCallback(
    (src: MediaSource) => {
      setSources((s) => ({ ...s, [src.id]: src }));
      keepForRecovery(src);
    },
    [keepForRecovery]
  );

  // --- playback ------------------------------------------------------------
  const seek = useCallback((t: number) => clock.set(Math.min(Math.max(0, t), lay.total)), [clock, lay.total]);
  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      if (!p && clock.get() >= lay.total - 0.05) clock.set(0);
      return !p;
    });
  }, [clock, lay.total]);
  const onEnded = useCallback(() => setPlaying(false), []);

  // --- selection helpers ---------------------------------------------------
  const clipIndexAtPlayhead = useCallback(() => {
    const loc = locate(lay, clock.get());
    return loc ? loc.primary.index : -1;
  }, [lay, clock]);

  const selectedClip = selection?.kind === "clip" ? lay.clips.find((c) => c.clip.id === selection.id) : undefined;
  const selectedOverlay = selection?.kind === "overlay" ? project.overlays.find((o) => o.id === selection.id) : undefined;
  const selectedAudio = selection?.kind === "audio" ? project.audio.find((a) => a.id === selection.id) : undefined;
  const selectedEffect = selection?.kind === "effect" ? project.effects.find((e) => e.id === selection.id) : undefined;
  // Copied attributes (attributes.ts) - kept outside the project and its undo.
  const [clipAttrs, setClipAttrs] = useState<ClipAttributes | null>(null);
  const [layerAttrs, setLayerAttrs] = useState<LayerAttributes | null>(null);

  // Edits of animated items land in a keyframe at the playhead (keyframes.ts).
  const changeOverlay = useCallback(
    (id: string, patch: Partial<Overlay>) =>
      apply((p) => {
        const o = p.overlays.find((x) => x.id === id);
        return updateOverlay(p, id, o ? animateOverlayPatch(o, patch, clock.get()) : patch);
      }),
    [apply, clock]
  );
  const overlayKeys = (o: Overlay): KeyframeControls => ({
    clock,
    keyframes: o.keyframes,
    keyTime: (t) => t - o.start,
    seekKey: (k) => seek(o.start + k),
    valuesAt: (k) => overlayValues(o, o.start + k),
    range: [0, o.end - o.start],
    onChange: (keyframes) => apply((p) => updateOverlay(p, o.id, { keyframes })),
  });
  const clipKeys = (c: LaidOutClip): KeyframeControls => ({
    clock,
    keyframes: c.clip.keyframes,
    keyTime: (t) => clipKeyTime(c, Math.min(Math.max(t, c.start), c.start + c.duration - 1e-3)),
    seekKey: (k) => seek(c.start + clipKeyTimeToLocal(c.clip, k)),
    valuesAt: (k) => ({ ...clipTransformAt(c.clip, k), opacity: 1 }),
    range: c.clip.freeze !== null ? [0, c.duration] : [c.clip.start, c.clip.end],
    onChange: (keyframes) => apply((p) => updateClip(p, c.clip.id, { keyframes })),
  });
  const zooms = useMemo(() => project.zooms ?? [], [project.zooms]);
  const selectedZoom = selection?.kind === "zoom" ? zooms.find((z) => z.id === selection.id) : undefined;
  const selectedMask = selection?.kind === "mask" ? (project.masks ?? []).find((m) => m.id === selection.id) : undefined;
  // The screen recording whose mouse events can be placed on the video.
  const recSource = useMemo(() => Object.values(sources).find((s) => recordingEvents(s) !== null), [sources]);
  const anyRecording = useMemo(() => Object.values(sources).some((s) => s.recording?.trackKind === "screen"), [sources]);
  const rawPointer = useMemo(() => (recSource ? buildPointerTrack(recordingEvents(recSource)!, 0) : null), [recSource]);
  const selectedTransition =
    selection?.kind === "transition" ? lay.clips.findIndex((c) => c.clip.id === selection.clipId) : -1;

  const select = useCallback((s: Selection) => {
    setTool(null);
    setSelection(s);
  }, []);

  /** Start time for something new added "at the playhead". */
  const placeAt = useCallback(
    (length: number) => {
      const start = Math.min(clock.get(), Math.max(0, lay.total - 0.5));
      return { start, end: Math.min(lay.total, start + length) };
    },
    [clock, lay.total]
  );

  const baseOverlay = useCallback(
    (length: number) => ({
      id: newId("ovl"),
      ...placeAt(length),
      x: 0.5,
      y: 0.5,
      width: 0.25,
      rotation: 0,
      opacity: 1,
      // No entrance by default: an animated entrance would make the layer
      // invisible at the very frame the user just placed it on.
      animIn: "none" as const,
      animOut: "none" as const,
      hidden: false,
      locked: false,
    }),
    [placeAt]
  );

  const addOverlay = useCallback(
    (o: Overlay) => {
      apply((p) => ({ ...p, overlays: [...p.overlays, o] }));
      setTool(null);
      setSelection({ kind: "overlay", id: o.id });
    },
    [apply]
  );

  // --- editing operations --------------------------------------------------
  const split = useCallback(() => {
    if (selection?.kind === "audio") {
      const next = splitAudioAt(project, selection.id, clock.get());
      if (!next) say("Move the playhead inside the audio clip to split it.");
      else apply(() => next);
      return;
    }
    const next = splitAt(project, lay, clock.get());
    if (!next) {
      say("Move the playhead inside a clip (not onto a transition or an edge) to split.");
      return;
    }
    apply(() => next);
  }, [selection, project, lay, clock, apply, say]);

  const freezeFrame = useCallback(() => {
    setPlaying(false);
    const next = insertFreezeAt(project, lay, clock.get());
    if (!next) {
      say("Move the playhead off the transition to freeze a frame.");
      return;
    }
    apply(() => next.project);
    setSelection({ kind: "clip", id: next.clipId });
    say("Freeze frame added. Drag its edge to hold it longer.");
  }, [project, lay, clock, apply, say]);

  const deleteSelection = useCallback(() => {
    if (selection?.kind === "mask") {
      apply((p) => ({ ...p, masks: (p.masks ?? []).filter((m) => m.id !== selection.id) }));
    } else if (selection?.kind === "chapter") {
      apply((p) => ({ ...p, chapters: (p.chapters ?? []).filter((c) => c.id !== selection.id) }));
    } else if (selection?.kind === "zoom") {
      apply((p) => ({ ...p, zooms: removeZoom(p.zooms ?? [], selection.id) }));
    } else if (selection?.kind === "overlay") {
      apply((p) => ({ ...p, overlays: p.overlays.filter((o) => o.id !== selection.id) }));
    } else if (selection?.kind === "audio") {
      apply((p) => ({ ...p, audio: p.audio.filter((a) => a.id !== selection.id) }));
    } else if (selection?.kind === "effect") {
      apply((p) => ({ ...p, effects: p.effects.filter((e) => e.id !== selection.id) }));
    } else if (selection?.kind === "transition") {
      apply((p) => updateClip(p, selection.clipId, { transition: null }));
    } else {
      const id = selection?.kind === "clip" ? selection.id : lay.clips[clipIndexAtPlayhead()]?.clip.id;
      if (!id) return;
      const next = deleteClip(project, id);
      if (!next) {
        say("A project needs at least one clip.");
        return;
      }
      apply(() => next);
      const total = layout(next, lay.fps).total;
      if (clock.get() > total) clock.set(total);
    }
    setSelection(null);
  }, [selection, project, lay, apply, say, clipIndexAtPlayhead, clock]);

  /** Copy of the selected layer/audio/effect, optionally re-timed to start at `at`. */
  const cloneOf = useCallback(
    (c: ClipboardItem, at?: number): ClipboardItem => {
      const shift = (start: number) => (at === undefined ? start : Math.min(at, Math.max(0, lay.total - 0.2)));
      if (c.kind === "overlay") {
        const len = c.item.end - c.item.start;
        const start = shift(c.item.start);
        return { kind: "overlay", item: { ...c.item, id: newId("ovl"), start, end: start + len, locked: false } };
      }
      if (c.kind === "audio") return { kind: "audio", item: { ...c.item, id: newId("aud"), start: shift(c.item.start) } };
      const len = c.item.end - c.item.start;
      const start = shift(c.item.start);
      return { kind: "effect", item: { ...c.item, id: newId("fx"), start, end: start + len } };
    },
    [lay.total]
  );

  const insertClone = useCallback(
    (c: ClipboardItem) => {
      if (c.kind === "overlay") {
        // Nudge a duplicate in place so it's visibly a second copy.
        const item = { ...c.item, x: c.item.x + 0.03, y: c.item.y + 0.03 };
        apply((p) => ({ ...p, overlays: [...p.overlays, item] }));
        setSelection({ kind: "overlay", id: item.id });
      } else if (c.kind === "audio") {
        apply((p) => ({ ...p, audio: [...p.audio, c.item] }));
        setSelection({ kind: "audio", id: c.item.id });
      } else {
        apply((p) => ({ ...p, effects: [...p.effects, c.item] }));
        setSelection({ kind: "effect", id: c.item.id });
      }
      setTool(null);
    },
    [apply]
  );

  const currentItem = useCallback((): ClipboardItem | null => {
    if (selectedOverlay) return { kind: "overlay", item: selectedOverlay };
    if (selectedAudio) return { kind: "audio", item: selectedAudio };
    if (selectedEffect) return { kind: "effect", item: selectedEffect };
    return null;
  }, [selectedOverlay, selectedAudio, selectedEffect]);

  const duplicate = useCallback(() => {
    const c = currentItem();
    if (c) insertClone(cloneOf(c));
  }, [currentItem, insertClone, cloneOf]);

  const copy = useCallback(() => {
    const c = currentItem();
    if (!c) return false;
    clipboard.current = c;
    say("Copied. Press Ctrl+V to paste at the playhead.");
    return true;
  }, [currentItem, say]);

  const paste = useCallback(() => {
    if (!clipboard.current) return false;
    insertClone(cloneOf(clipboard.current, clock.get()));
    return true;
  }, [insertClone, cloneOf, clock]);

  const moveSelected = useCallback(
    (dir: -1 | 1) => {
      if (!selectedClip) return;
      apply((p) => moveClip(p, selectedClip.index, selectedClip.index + dir));
    },
    [selectedClip, apply]
  );

  const addSticker = useCallback(
    (stickerId: string) => addOverlay({ ...baseOverlay(3), kind: "sticker", stickerId }),
    [addOverlay, baseOverlay]
  );

  const addText = useCallback(
    (style: Partial<TextStyle>, y: number) => {
      const o: Overlay = { ...baseOverlay(3), y, kind: "text", text: { ...DEFAULT_TEXT, ...style } };
      addOverlay(o);
      // Put the cursor straight into the content box.
      setTimeout(() => textAreaRef.current?.select(), 50);
    },
    [addOverlay, baseOverlay]
  );

  const importImage = useCallback(
    async (file: File): Promise<MediaSource | null> => {
      if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
        say("Please choose a PNG, JPG or WebP image.");
        return null;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        say("That image is over 15MB.");
        return null;
      }
      setBusy("Adding image…");
      try {
        const norm = await normalizeImage(file);
        const src: MediaSource = {
          id: newId("img"),
          kind: "image",
          file: norm.file,
          url: URL.createObjectURL(norm.file),
          duration: 0,
          width: norm.width,
          height: norm.height,
          fps: 0,
          hasAudio: false,
        };
        addSource(src);
        return src;
      } catch {
        say("That image couldn't be read. Try a different file.");
        return null;
      } finally {
        setBusy(null);
      }
    },
    [addSource, say]
  );

  const uploadImage = useCallback(
    async (file: File) => {
      const src = await importImage(file);
      if (!src) return;
      const aspect = canvasSize.width / canvasSize.height;
      // Default to 40% of the canvas on the image's long side.
      const width = src.width / src.height > aspect ? 0.4 : (0.4 * (src.width / src.height)) / aspect;
      addOverlay({ ...baseOverlay(4), width, kind: "image", sourceId: src.id });
    },
    [importImage, addOverlay, baseOverlay, canvasSize]
  );

  /** Imports a video as a picture-in-picture layer at the playhead: same
   * browser decode check and server screening as the main import. */
  const uploadVideoLayer = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("video/")) {
        say("Please choose a video file (MP4, MOV or WebM).");
        return;
      }
      if (file.size > MAX_BYTES) {
        say("That video is over the 300MB limit.");
        return;
      }
      setBusy("Adding video layer…");
      const url = URL.createObjectURL(file);
      try {
        const [meta, probe] = await Promise.all([loadVideoMeta(url), probeVideo(file)]);
        URL.revokeObjectURL(probe.previewUrl);
        const src: MediaSource = {
          id: newId("lyr"),
          kind: "layer",
          file,
          url,
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
          fps: probe.info.fps > 0 && probe.info.fps <= 240 ? probe.info.fps : 30,
          hasAudio: probe.info.hasAudio ?? true,
        };
        addSource(src);
        const aspect = canvasSize.width / canvasSize.height;
        // 40% of the canvas on the video's long side, like an image layer.
        const width = src.width / src.height > aspect ? 0.4 : (0.4 * (src.width / src.height)) / aspect;
        addOverlay({ ...baseOverlay(meta.duration), width, kind: "video", sourceId: src.id, offset: 0, volume: 1 });
      } catch (e) {
        URL.revokeObjectURL(url);
        if (e instanceof ContentBlockedError || e instanceof ApiError) say(e.message);
        else if (e instanceof Error && e.message === "media_error") say("Your browser can't play this video's format. Try an MP4 (H.264) file.");
        else say("Couldn't add this video. Check your connection and try again.");
      } finally {
        setBusy(null);
      }
    },
    [addSource, addOverlay, baseOverlay, canvasSize, say]
  );

  // --- auto captions and the transcript ---------------------------------------
  /** The timeline's speech as a word-timed transcript (null: no sound). */
  const transcribeTimeline = useCallback(async (): Promise<Transcript | null> => {
    const progress = ({ stage, value }: CaptionsProgress) =>
      setBusy(
        stage === "download"
          ? `Downloading speech model (first time only)… ${Math.round(value * 100)}%`
          : stage === "prepare"
            ? "Preparing speech model…"
            : `Transcribing speech on your device… ${Math.round(value * 100)}%`
      );
    setBusy("Preparing audio…");
    const samples = await buildSpeechAudio(lay, project, sources, speechModelProbe(progress));
    if (!samples) return null;
    setBusy("Loading speech model…");
    const res = await transcribe(samples, captionOpts.language, progress);
    return { language: res.language, words: res.words, total: lay.total };
  }, [lay, project, sources, captionOpts.language]);

  const runCaptions = useCallback(async () => {
    setPlaying(false);
    setCaptioning(true);
    try {
      const transcript = await transcribeTimeline();
      if (!transcript) {
        say("There's no sound in your clips to caption.");
        return;
      }
      const chunks = groupWords(transcript.words, captionOpts.maxWords, lineCharsFor(canvasSize), lay.total);
      if (chunks.length === 0) {
        say("No speech was found in your clips.");
        return;
      }
      const caps = captionOverlays(chunks, captionOpts.style, captionOpts.y);
      // One undo step; regenerating replaces earlier captions. The words
      // are kept too, for editing by text (Transcript).
      apply((p) => ({ ...p, overlays: [...p.overlays.filter((o) => !o.caption), ...caps], transcript }));
      say(`Added ${caps.length} captions. Click one to edit its text.`);
    } catch (e) {
      console.error("[captions]", e);
      say("Captioning failed. Check your connection and try again.");
    } finally {
      setBusy(null);
      setCaptioning(false);
    }
  }, [transcribeTimeline, captionOpts, canvasSize, lay.total, apply, say]);

  const runTranscript = useCallback(async () => {
    setPlaying(false);
    setCaptioning(true);
    try {
      const transcript = await transcribeTimeline();
      if (!transcript) {
        say("There's no sound in your clips to transcribe.");
        return;
      }
      apply((p) => ({ ...p, transcript }));
      say(transcript.words.length ? `Transcribed ${transcript.words.length} words.` : "No speech was found in your clips.");
    } catch (e) {
      console.error("[transcript]", e);
      say("Transcribing failed. Check your connection and try again.");
    } finally {
      setBusy(null);
      setCaptioning(false);
    }
  }, [transcribeTimeline, apply, say]);

  /** Cuts the transcript words `indices` out of the video (one undo step);
   * captions, if any, are rebuilt from the words that are left. */
  const cutByWords = useCallback(
    (indices: number[]) => {
      const res = cutWords(project, lay.fps, indices);
      if (!res.ok) {
        say(res.error);
        return;
      }
      let next = res.project;
      if (next.transcript && project.overlays.some((o) => o.caption)) {
        const total = layout(next, lay.fps).total;
        const chunks = groupWords(next.transcript.words, captionOpts.maxWords, lineCharsFor(canvasSize), total);
        next = { ...next, overlays: [...next.overlays.filter((o) => !o.caption), ...captionOverlays(chunks, captionOpts.style, captionOpts.y)] };
      }
      apply(() => next);
      setSelection(null);
      say(`Cut ${res.removed.toFixed(1)} s. Undo brings it back.`);
    },
    [project, lay.fps, captionOpts, canvasSize, apply, say]
  );

  const restyleCaptions = useCallback(
    (opts: CaptionOptions) =>
      apply((p) => ({
        ...p,
        overlays: p.overlays.map((o) =>
          o.caption && o.kind === "text"
            ? { ...o, y: opts.y, animIn: CAPTION_STYLES[opts.style].animIn, text: captionText(o.text.content, opts.style) }
            : o
        ),
      })),
    [apply]
  );

  const uploadBackground = useCallback(
    async (file: File) => {
      const src = await importImage(file);
      if (src) apply((p) => ({ ...p, canvas: { ...p.canvas, background: { type: "image", sourceId: src.id } } }));
    },
    [importImage, apply]
  );

  /** Adds an audio file as a track at `at` (default: the playhead). */
  const uploadAudio = useCallback(
    async (file: File, at?: number) => {
      if (!file.type.startsWith("audio/")) {
        say("Please choose an audio file (MP3, WAV, M4A, AAC or OGG).");
        return;
      }
      if (file.size > MAX_AUDIO_BYTES) {
        say("That audio file is over the 50MB limit.");
        return;
      }
      setBusy("Adding audio…");
      const url = URL.createObjectURL(file);
      try {
        const duration = await loadAudioMeta(url);
        const src: MediaSource = { id: newId("snd"), kind: "audio", file, url, duration, width: 0, height: 0, fps: 0, hasAudio: true };
        addSource(src);
        const start = Math.min(at ?? clock.get(), Math.max(0, lay.total - 0.5));
        const clip: AudioClip = {
          id: newId("aud"),
          sourceId: src.id,
          label: file.name.replace(/\.[^.]+$/, ""),
          start,
          offset: 0,
          duration: Math.min(duration, Math.max(0.5, lay.total - start)),
          volume: 1,
          fadeIn: 0,
          fadeOut: 0,
          muted: false,
        };
        apply((p) => ({ ...p, audio: [...p.audio, clip] }));
        setTool(null);
        setSelection({ kind: "audio", id: clip.id });
      } catch {
        URL.revokeObjectURL(url);
        say("That audio file couldn't be read by your browser. Try an MP3 or WAV.");
      } finally {
        setBusy(null);
      }
    },
    [addSource, apply, clock, lay.total, say]
  );

  // --- voiceover: records the mic while the timeline plays from the
  // playhead; the take lands as an audio track where recording started.
  const voice = useRef<{ session: VoiceoverSession; start: number } | null>(null);
  const [recordingFrom, setRecordingFrom] = useState<number | null>(null);
  const beginVoiceover = useCallback(async () => {
    if (voice.current) return;
    let session: VoiceoverSession;
    try {
      session = await startVoiceover();
    } catch (e) {
      const name = (e as DOMException)?.name;
      say(
        name === "NotAllowedError"
          ? "Microphone access was blocked. Allow it in your browser's site settings and try again."
          : name === "NotFoundError"
            ? "No microphone was found."
            : "The microphone couldn't be started."
      );
      return;
    }
    if (clock.get() >= lay.total - 0.25) clock.set(0);
    const start = clock.get();
    voice.current = { session, start };
    setRecordingFrom(start);
    setPlaying(true);
  }, [clock, lay.total, say]);
  const endVoiceover = useCallback(
    async (keep = true) => {
      const v = voice.current;
      if (!v) return;
      voice.current = null;
      setRecordingFrom(null);
      setPlaying(false);
      if (!keep) {
        v.session.cancel();
        return;
      }
      try {
        const file = await v.session.stop();
        if (file) await uploadAudio(file, v.start);
        else say("Nothing was recorded.");
      } catch {
        say("The recording couldn't be saved.");
      }
    },
    [say, uploadAudio]
  );
  // Pausing (or reaching the end) ends the take; so does the length cap.
  useEffect(() => {
    if (!playing && recordingFrom !== null) void endVoiceover();
  }, [playing, recordingFrom, endVoiceover]);
  useEffect(() => {
    if (recordingFrom === null) return;
    const id = window.setTimeout(() => void endVoiceover(), MAX_VOICEOVER_SECONDS * 1000);
    return () => window.clearTimeout(id);
  }, [recordingFrom, endVoiceover]);
  useEffect(() => () => voice.current?.session.cancel(), []);

  // Auto-ducking: the speech regions of everything but this track.
  const duckUnderSpeech = useCallback(
    async (audioId: string) => {
      setPlaying(false);
      setBusy("Finding speech…");
      try {
        const others = { ...project, audio: project.audio.filter((x) => x.id !== audioId) };
        const mix = await buildSpeechMix(lay, others, sources);
        const regions = mix.samples ? speechRegions(mix.samples, ANALYSIS_RATE) : [];
        if (!regions.length) {
          say("No speech found to lower this track under.");
          return;
        }
        apply((p) => updateAudio(p, audioId, { duck: { amount: p.audio.find((x) => x.id === audioId)?.duck?.amount ?? DEFAULT_DUCK_AMOUNT, regions } }));
      } catch {
        say("The speech couldn't be analysed.");
      } finally {
        setBusy(null);
      }
    },
    [apply, lay, project, say, sources]
  );

  const findBeats = useCallback(
    async (audioId: string) => {
      const a = project.audio.find((x) => x.id === audioId);
      const src = a ? sources[a.sourceId] : undefined;
      if (!a || !src) return;
      setBusy("Finding the beat…");
      try {
        const bytes = await (await sourceFile(src)).arrayBuffer();
        const buf = await new OfflineAudioContext(1, 1, BEAT_RATE).decodeAudioData(bytes);
        const { bpm, times } = detectBeats(buf.getChannelData(0));
        if (!times.length) {
          say("No steady beat was found in this track.");
          return;
        }
        apply((p) => updateAudio(p, audioId, { beats: { bpm, times } }));
        say(`${times.length} beats found (${Math.round(bpm)} BPM). Clips and layers now snap to them.`);
      } catch {
        say("This audio couldn't be analysed.");
      } finally {
        setBusy(null);
      }
    },
    [apply, project.audio, say, sources]
  );

  // An uploaded font becomes a "font" source; the text layer uses it.
  const uploadFont = useCallback(
    async (overlayId: string, upload: File) => {
      const file = asFontFile(upload);
      if (!file) {
        say("Please choose a font file (TTF, OTF, WOFF or WOFF2).");
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        say("That font file is over the 20MB limit.");
        return;
      }
      const src: MediaSource = { id: newId("font"), kind: "font", file, url: URL.createObjectURL(file), duration: 0, width: 0, height: 0, fps: 0, hasAudio: false };
      try {
        await registerFont(src.id, () => Promise.resolve(file));
      } catch {
        say("That font couldn't be read by your browser.");
        return;
      }
      addSource(src);
      apply((p) => ({
        ...p,
        overlays: p.overlays.map((o) => (o.id === overlayId && o.kind === "text" ? { ...o, text: { ...o.text, font: customFontKey(src.id) } } : o)),
      }));
    },
    [addSource, apply, say]
  );

  // A .cube LUT becomes a "lut" source the clip's look points at.
  const importLut = useCallback(
    async (clipId: string, file: File) => {
      try {
        parseCube(await file.text());
      } catch (e) {
        say(e instanceof Error ? e.message : "That LUT couldn't be read.");
        return;
      }
      // Typed as text, which project files accept for LUTs.
      const text = new File([file], file.name, { type: "text/plain" });
      const src: MediaSource = { id: newId("lut"), kind: "lut", file: text, url: URL.createObjectURL(text), duration: 0, width: 0, height: 0, fps: 0, hasAudio: false };
      addSource(src);
      apply((p) => ({
        ...p,
        clips: p.clips.map((c) => (c.id === clipId ? { ...c, look: { ...c.look, lut: { sourceId: src.id, name: file.name, intensity: 100 } } } : c)),
      }));
    },
    [addSource, apply, say]
  );

  const extractAudio = useCallback(
    (clipId: string) => {
      const laid = lay.clips.find((c) => c.clip.id === clipId);
      if (!laid) return;
      if (laid.clip.freeze !== null || laid.clip.reverse) {
        say("Freeze frames and reversed clips have no audio to extract.");
        return;
      }
      if (laid.clip.speed !== 1 || activeRamp(laid.clip)) {
        say("Set the clip's speed to 1× before extracting its audio.");
        return;
      }
      const clip: AudioClip = {
        id: newId("aud"),
        sourceId: laid.clip.sourceId,
        label: `Audio from clip ${laid.index + 1}`,
        start: laid.start,
        offset: laid.clip.start,
        duration: laid.duration,
        volume: laid.clip.volume || 1,
        fadeIn: 0,
        fadeOut: 0,
        muted: false,
      };
      // One step: the clip goes silent and its sound becomes a separate,
      // independently editable track - same sound, nothing doubled.
      apply((p) => ({ ...updateClip(p, clipId, { volume: 0 }), audio: [...p.audio, clip] }));
      setSelection({ kind: "audio", id: clip.id });
      say("Audio extracted to its own track.");
    },
    [lay, apply, say]
  );

  /** Desktop: the clip's sound, cleaned up on the local engine (noise
   * reduced, loudness evened out), on its own audio track in place of the
   * clip's own - like Extract audio, so preview and export play the same
   * file. Undo brings the original back. */
  const cleanUpAudio = useCallback(
    async (clipId: string) => {
      const laid = lay.clips.find((c) => c.clip.id === clipId);
      const src = laid && sources[laid.clip.sourceId];
      if (!laid || !src) return;
      if (laid.clip.freeze !== null || laid.clip.reverse) {
        say("Freeze frames and reversed clips have no audio to clean up.");
        return;
      }
      if (laid.clip.speed !== 1 || activeRamp(laid.clip)) {
        say("Set the clip's speed to 1× before cleaning up its audio.");
        return;
      }
      setPlaying(false);
      setBusy("Cleaning up audio…");
      try {
        const blob = await cleanAudio(sourceInput(src), laid.clip.start, laid.clip.end, { denoise: 0.6, level: true });
        const file = new File([blob], `clean-${sourceName(src).replace(/.[^.]+$/, "")}.m4a`, { type: "audio/mp4" });
        const cleaned: MediaSource = {
          id: newId("snd"),
          kind: "audio",
          file,
          url: URL.createObjectURL(file),
          duration: laid.clip.end - laid.clip.start,
          width: 0,
          height: 0,
          fps: 0,
          hasAudio: true,
        };
        addSource(cleaned);
        const track: AudioClip = {
          id: newId("aud"),
          sourceId: cleaned.id,
          label: `Cleaned audio from clip ${laid.index + 1}`,
          start: laid.start,
          offset: 0,
          duration: laid.duration,
          volume: laid.clip.volume || 1,
          fadeIn: 0,
          fadeOut: 0,
          muted: false,
        };
        apply((p) => ({ ...updateClip(p, clipId, { volume: 0 }), audio: [...p.audio, track] }));
        setSelection({ kind: "audio", id: track.id });
        say("Cleaned-up audio is on its own track. Undo brings the original back.");
      } catch (e) {
        console.error("[editor] audio cleanup failed", e);
        say(e instanceof Error && e.message ? e.message : "This clip's audio couldn't be cleaned up.");
      } finally {
        setBusy(null);
      }
    },
    [lay, sources, apply, say, addSource]
  );

  const addEffect = useCallback(
    (type: EffectType) => {
      const e: EffectClip = { id: newId("fx"), type, ...placeAt(2), intensity: 50 };
      apply((p) => ({ ...p, effects: [...p.effects, e] }));
      setTool(null);
      setSelection({ kind: "effect", id: e.id });
    },
    [apply, placeAt]
  );

  /** Row-header switches: flip hide/lock/mute for every item on a track
   * (all on -> all off, otherwise all on). */
  const onTrackToggle = useCallback(
    (track: string, kind: TrackToggle["kind"]) => {
      apply((p) => {
        if (track === "audio") {
          const on = p.audio.length > 0 && p.audio.every((a) => a.muted);
          return { ...p, audio: p.audio.map((a) => ({ ...a, muted: !on })) };
        }
        const mine = (o: Overlay) => (track === "text" ? o.kind === "text" : o.kind !== "text");
        const field = kind === "lock" ? "locked" : "hidden";
        const on = p.overlays.filter(mine).every((o) => o[field]);
        return { ...p, overlays: p.overlays.map((o) => (mine(o) ? { ...o, [field]: !on } : o)) };
      });
    },
    [apply]
  );

  const onItemChange = useCallback(
    (track: string, id: string, mode: ItemMode, start: number, end: number) => {
      if (track === "audio") {
        apply(
          (p) => {
            const a = p.audio.find((x) => x.id === id);
            if (!a) return p;
            const srcDur = sourcesRef.current[a.sourceId]?.duration ?? a.offset + a.duration;
            if (mode === "move") return updateAudio(p, id, { start });
            if (mode === "start") {
              // Trimming the front moves both where it starts and where it
              // reads from, so the remaining sound stays in place.
              const delta = Math.max(-a.offset, start - a.start);
              return updateAudio(p, id, { start: a.start + delta, offset: a.offset + delta, duration: a.duration - delta });
            }
            return updateAudio(p, id, { duration: Math.min(end - a.start, srcDur - a.offset) });
          },
          false
        );
      } else if (track === "effects") {
        apply((p) => updateEffect(p, id, { start, end }), false);
      } else if (track === "privacy") {
        apply((p) => ({ ...p, masks: (p.masks ?? []).map((m) => (m.id === id ? { ...m, start, end } : m)) }), false);
      } else if (track === "chapters") {
        if (mode === "move" || mode === "start") apply((p) => ({ ...p, chapters: (p.chapters ?? []).map((c) => (c.id === id ? { ...c, t: Math.max(0, start), auto: false } : c)) }), false);
      } else if (track === "review") {
        apply((p) => ({ ...p, suggestions: (p.suggestions ?? []).map((s) => (s.id === id ? { ...s, start, end } : s)) }), false);
      } else if (track === "zoom") {
        // Items are "<zoom id>#<clip index>": dragged in timeline time on
        // that clip, stored in source time (see camera.ts).
        const [zid, ci] = id.split("#");
        const laid = layRef.current.clips[Number(ci)];
        apply((p) => {
          const z = p.zooms?.find((x) => x.id === zid);
          const next = z && laid ? dragZoom(z, laid, mode, start, end, sourcesRef.current[z.sourceId]?.duration ?? Infinity) : null;
          return next ? { ...p, zooms: patchZoom(p.zooms!, zid, next) } : p;
        }, false);
      } else {
        apply((p) => {
          const o = p.overlays.find((x) => x.id === id);
          if (o?.kind !== "video") return updateOverlay(p, id, { start, end });
          // Video layers trim like audio: the front edge moves where the
          // video is read from, the back edge stops at the video's end.
          const srcDur = sourcesRef.current[o.sourceId]?.duration ?? o.offset + (o.end - o.start);
          if (mode === "move") return updateOverlay(p, id, { start, end });
          if (mode === "start") {
            const delta = Math.max(-o.offset, start - o.start);
            return updateOverlay(p, id, { start: o.start + delta, offset: o.offset + delta } as Partial<Overlay>);
          }
          return updateOverlay(p, id, { end: Math.min(end, o.start + srcDur - o.offset) });
        }, false);
      }
    },
    [apply]
  );

  // --- tutorial tools (Phase 3) ------------------------------------------------
  const tutorial = useTutorialTools({
    project,
    lay,
    sources,
    recSource,
    clock,
    apply,
    say,
    setSelection,
    setPlaying,
    addSource,
    addOverlay,
    baseOverlay: baseOverlay as never,
    importImage,
    fileName: (original && sourceName(original)) || "wipeclip",
    onClose: () => setTool(null),
  });
  const [modelCached, setModelCached] = useState<boolean | null>(null);
  const [captionModel, setCaptionModel] = useState<SpeechModel | null>(null);
  useEffect(() => {
    if (tool !== "captions") return;
    let cancelled = false;
    void speechModel().then((m) => !cancelled && setCaptionModel(m));
    void speechModelCached().then((v) => !cancelled && setModelCached(v));
    return () => {
      cancelled = true;
    };
  }, [tool]);
  const exportCaptions = useCallback(
    async (format: "srt" | "vtt" | "txt") => {
      const cues = captionCues(project.overlays);
      if (!cues.length) {
        say("No visible captions to export.");
        return;
      }
      const name = `${((original && sourceName(original)) || "captions").replace(/\.[^.]+$/, "")}.${format}`;
      const text = format === "srt" ? toSrt(cues) : format === "vtt" ? toVtt(cues) : toPlainTranscript(cues);
      try {
        const r = await saveTextFile(name, text);
        if (r.status === "saved") say(`Saved ${r.path}`);
      } catch (e) {
        say(e instanceof Error ? e.message : "Couldn't save the file.");
      }
    },
    [project.overlays, original, say]
  );

  // --- focus zooms ---------------------------------------------------------
  const [analysis, setAnalysis] = useState<AnalysisState | null>(null);
  const analysisCtrl = useRef<AbortController | null>(null);
  useEffect(() => () => analysisCtrl.current?.abort(), []);

  const runAnalysis = useCallback(
    async (settings: FocusSettings) => {
      const events = recordingEvents(recSource);
      if (!recSource || !events) return;
      analysisCtrl.current?.abort();
      const ctrl = new AbortController();
      analysisCtrl.current = ctrl;
      setAnalysis({ stage: "reading", value: 0 });
      try {
        const res = await analyzeFocus(
          { events, duration: recSource.duration, aspect: recSource.width / Math.max(1, recSource.height), sourceId: recSource.id },
          settings,
          () => newId("zm"),
          { signal: ctrl.signal, onProgress: (pr) => pr.stage !== "done" && setAnalysis({ stage: pr.stage, value: pr.value }) }
        );
        // One undo step. Edited and manual zooms are kept.
        apply((p) => ({
          ...p,
          zooms: mergeSuggestions(p.zooms ?? [], recSource.id, res.zooms),
          pointer: p.pointer ?? { ...DEFAULT_POINTER, cursor: recSource.recording?.manifest.capture.cursorCaptured === false },
        }));
        const { clicks } = res.stats;
        const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
        say(
          res.zooms.length
            ? `Suggested ${plural(res.zooms.length, "zoom")} from ${plural(clicks, "click")}. Play to preview; click one on the Zoom track to adjust it.`
            : `No clear focus points in ${plural(clicks, "click")}. Try the Dynamic preset, or add zooms by hand.`
        );
      } catch (e) {
        if ((e as Error)?.name === "AbortError") say("Analysis cancelled.");
        else {
          console.error("[focus] analysis failed", e);
          say("Analysis failed. You can still add zooms by hand.");
        }
      } finally {
        if (analysisCtrl.current === ctrl) {
          analysisCtrl.current = null;
          setAnalysis(null);
        }
      }
    },
    [recSource, apply, say]
  );

  const selectZoom = useCallback(
    (id: string) => {
      setSelection({ kind: "zoom", id });
      const z = (project.zooms ?? []).find((x) => x.id === id);
      const span = z ? zoomSpans(lay.clips, z)[0] : undefined;
      if (span && (clock.get() < span.start || clock.get() >= span.end)) clock.set(span.start);
    },
    [project.zooms, lay, clock]
  );

  const updateZoom = useCallback(
    (id: string, patch: Partial<CameraZoom>) =>
      apply((p) => ({ ...p, zooms: patchZoom(p.zooms ?? [], id, patch) })),
    [apply]
  );

  const addZoomAtPlayhead = useCallback(() => {
    const t = clock.get();
    const loc = locate(lay, t);
    if (!loc) return;
    const laid = lay.clips[loc.primary.index];
    if (laid.clip.freeze !== null) {
      say("Zooms can't be added to a freeze frame.");
      return;
    }
    const s = sourceTimeOf(laid, t);
    const pos = rawPointer && recSource?.id === laid.clip.sourceId ? pointerAt(rawPointer, s) : null;
    const usable = !!pos && pos.x >= 0 && pos.x <= 1 && pos.y >= 0 && pos.y <= 1;
    const z: CameraZoom = {
      id: newId("zm"),
      sourceId: laid.clip.sourceId,
      start: Math.max(laid.clip.start, s - 0.6),
      end: Math.min(laid.clip.end, s + 2.4),
      zoom: 1.8,
      x: usable ? pos!.x : 0.5,
      y: usable ? pos!.y : 0.5,
      easeIn: 0.6,
      easeOut: 0.7,
      ease: "smooth",
      enabled: true,
      auto: false,
      reason: usable ? "Pointer" : undefined,
    };
    if (z.end - z.start < 0.8) {
      say("Not enough room in this clip for a zoom.");
      return;
    }
    apply((p) => ({ ...p, zooms: [...(p.zooms ?? []), z] }));
    setSelection({ kind: "zoom", id: z.id });
  }, [clock, lay, rawPointer, recSource, apply, say]);

  const splitZoom = useCallback(() => {
    const z = selection?.kind === "zoom" ? (project.zooms ?? []).find((x) => x.id === selection.id) : undefined;
    const loc = z ? locate(lay, clock.get()) : null;
    const laid = loc ? lay.clips[loc.primary.index] : undefined;
    if (!z || !laid || laid.clip.sourceId !== z.sourceId) return;
    const s = sourceTimeOf(laid, clock.get());
    const secondId = newId("zm");
    if (!splitZoomAt(project.zooms ?? [], z.id, s, secondId)) {
      say(`Move the playhead inside the zoom (at least ${MIN_ZOOM_LENGTH} s from either end) to split it.`);
      return;
    }
    apply((p) => ({ ...p, zooms: splitZoomAt(p.zooms ?? [], z.id, s, secondId) ?? p.zooms }));
    setSelection({ kind: "zoom", id: secondId });
  }, [selection, project.zooms, lay, clock, apply, say]);

  const openTransition = useCallback(() => {
    if (lay.clips.length < 2) {
      say("Split the video first. Transitions go between two clips.");
      return;
    }
    const t = clock.get();
    let best = 0;
    for (let i = 0; i < lay.clips.length - 1; i++) {
      if (Math.abs(clipVisualSpan(lay, i).to - t) < Math.abs(clipVisualSpan(lay, best).to - t)) best = i;
    }
    select({ kind: "transition", clipId: lay.clips[best].clip.id });
  }, [lay, clock, say, select]);

  const openTrim = useCallback(() => {
    const idx = selectedClip ? selectedClip.index : clipIndexAtPlayhead();
    if (idx < 0) return;
    select({ kind: "clip", id: lay.clips[idx].clip.id });
    say("Drag the clip's edges on the timeline, or use Trim start/end here.");
  }, [selectedClip, clipIndexAtPlayhead, lay, say, select]);

  /** Filters/Adjust edit the selected clip, or the clip under the playhead. */
  const openLook = useCallback(
    (which: "filters" | "adjust") => {
      const idx = selectedClip ? selectedClip.index : clipIndexAtPlayhead();
      if (idx < 0) return;
      setSelection({ kind: "clip", id: lay.clips[idx].clip.id });
      setTool(which);
    },
    [selectedClip, clipIndexAtPlayhead, lay]
  );

  const openCleanup = useCallback(() => {
    const idx = selectedClip ? selectedClip.index : clipIndexAtPlayhead();
    const laid = lay.clips[idx];
    if (!laid) return;
    if (laid.clip.freeze !== null) {
      say("AI Cleanup works on video clips. Clean the clip this frame came from, then freeze again.");
      return;
    }
    setPlaying(false);
    const loc = locate(lay, clock.get());
    const inside = loc && loc.primary.index === idx && !loc.incoming;
    const frameTime = inside ? loc.primary.sourceTime : laid.clip.start + (laid.clip.end - laid.clip.start) / 2;
    select({ kind: "clip", id: laid.clip.id });
    setDialog({ kind: "cleanup", clipId: laid.clip.id, frameTime });
  }, [selectedClip, clipIndexAtPlayhead, lay, clock, select, say]);

  const onCleaned = useCallback(
    (clipId: string, src: MediaSource) => {
      addSource(src);
      apply((p) => updateClip(p, clipId, { sourceId: src.id, start: 0, end: src.duration }));
      setDialog(null);
      say("Clip cleaned. Undo brings the original back.");
    },
    [apply, say, addSource]
  );

  /** Saves the open project as a .wipeclip file the user can move to
   * another computer (projectFile.ts). */
  const saveProjectFile = useCallback(async () => {
    if (!info) return;
    setPlaying(false);
    setBusy("Saving project file…");
    try {
      const blob = await createProjectFile(info, project, Object.values(sources));
      const res = await saveExportFile(blob, projectFileName(info.name), "project");
      if (res.status === "saved") say(IS_DESKTOP ? `Saved ${res.path}` : "Project file downloaded.");
    } catch (e) {
      console.error("[editor] project file save failed", e);
      say(e instanceof Error && e.message ? `Couldn't save the project file: ${e.message}` : "Couldn't save the project file.");
    } finally {
      setBusy(null);
    }
  }, [info, project, sources, say]);

  /** Back to the start screen. The project is saved first and stays in
   * Recent projects, so nothing needs confirming. */
  const closeProject = useCallback(async () => {
    setPlaying(false);
    await saveNow();
    thumbJobs.current.forEach((c) => c.abort());
    thumbJobs.current.clear();
    Object.values(sourcesRef.current).forEach((s) => URL.revokeObjectURL(s.url));
    setThumbs({});
    setWaves({});
    setSources({});
    setOriginalId(null);
    reset(EMPTY);
    setInfo(null);
    setPhase("import");
    void refreshRecents();
  }, [reset, saveNow, refreshRecents]);

  // --- keyboard shortcuts ------------------------------------------------
  useEffect(() => {
    if (phase !== "edit") return;
    const onKey = (e: KeyboardEvent) => {
      if (dialog || showSignIn || suspended) return;
      const target = e.target as HTMLElement | null;
      // Text entry keeps its keys; sliders/checkboxes don't need S, Delete or Space.
      const typing =
        target &&
        (target.isContentEditable ||
          /^(TEXTAREA|SELECT)$/.test(target.tagName) ||
          (target.tagName === "INPUT" && !/^(range|checkbox|radio|color)$/.test((target as HTMLInputElement).type)));
      if (typing) return;
      const onSlider = target?.tagName === "INPUT" && (target as HTMLInputElement).type === "range";
      if (onSlider && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && key === "y") {
        e.preventDefault();
        redo();
      } else if (mod && key === "c") {
        // Only take over copy when a layer is selected and no text is
        // highlighted - normal page copy keeps working otherwise.
        if (!window.getSelection()?.toString() && copy()) e.preventDefault();
      } else if (mod && key === "v") {
        if (paste()) e.preventDefault();
      } else if (mod && key === "d") {
        if (currentItem()) {
          e.preventDefault();
          duplicate();
        }
      } else if (mod) {
        return;
      } else if (e.key === " " && target?.tagName !== "BUTTON") {
        e.preventDefault();
        togglePlay();
      } else if (key === "s") {
        e.preventDefault();
        split();
      } else if (key === "t") {
        e.preventDefault();
        addText({}, 0.5);
      } else if (key === "f" && !mod) {
        e.preventDefault();
        freezeFrame();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelection();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        e.preventDefault();
        if (e.altKey) moveSelected(dir);
        else seek(clock.get() + dir * (e.shiftKey ? 1 : 1 / lay.fps));
      } else if (e.key === "Escape") {
        setSelection(null);
        setTool(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, dialog, showSignIn, suspended, undo, redo, copy, paste, duplicate, currentItem, togglePlay, split, freezeFrame, addText, deleteSelection, moveSelected, seek, clock, lay.fps]);

  const toggleFullscreen = () => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else el.requestFullscreen?.().catch(() => say("Fullscreen isn't available in this browser."));
  };

  // --- render ----------------------------------------------------------------
  const header = (
    <header className="flex items-center gap-2 border-b border-border bg-surface/80 px-3 py-2 backdrop-blur sm:gap-3 sm:px-4">
      <Link href="/" className="inline-flex shrink-0 items-center" aria-label="WipeClip home">
        <Logo size={28} textSize="text-base" />
      </Link>
      <span className="hidden rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[11px] font-bold text-accent sm:inline dark:text-accent-light">
        Editor
      </span>
      {phase === "edit" && original && info && (
        <div className="hidden min-w-0 flex-1 md:block">
          <input
            value={info.name}
            onChange={(e) => setInfo({ ...info, name: e.target.value })}
            onBlur={() => !info.name.trim() && setInfo({ ...info, name: nameFromFile(sourceName(original)) })}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            aria-label="Project name"
            maxLength={120}
            className="w-full max-w-sm truncate rounded-md border border-transparent bg-transparent px-1 -mx-1 text-xs font-semibold text-foreground hover:border-border focus:border-accent-2 focus:outline-none"
          />
          <p className="truncate text-[11px] text-muted">
            {original.width}×{original.height} · {Math.round(original.fps * 100) / 100} fps · {original.hasAudio ? "with audio" : "no audio"}
          </p>
        </div>
      )}
      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        {phase === "edit" && (
          <>
            <ToolButton label="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
              <UndoIcon />
            </ToolButton>
            <ToolButton label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo}>
              <RedoIcon />
            </ToolButton>
            <button
              type="button"
              onClick={saveProjectFile}
              title="Save this project, with its videos, as one .wipeclip file"
              className="hidden rounded-full px-3 py-2 text-xs font-semibold text-muted hover:text-foreground sm:inline"
            >
              Save file
            </button>
            <button
              type="button"
              onClick={closeProject}
              title="Back to your projects. This one is saved."
              className="hidden rounded-full px-3 py-2 text-xs font-semibold text-muted hover:text-foreground sm:inline"
            >
              Projects
            </button>
          </>
        )}
        {onRecord && (
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              onRecord();
            }}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold text-muted hover:text-foreground"
          >
            <span className="h-2 w-2 rounded-full bg-rose-500" aria-hidden /> Record
          </button>
        )}
        {onImageTools && (
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              onImageTools();
            }}
            className="hidden rounded-full px-3 py-2 text-xs font-semibold text-muted hover:text-foreground sm:inline"
          >
            Image tools
          </button>
        )}
        <ThemeToggle />
        <div className="hidden sm:block">
          <AuthStatus />
        </div>
        {phase === "edit" && (
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              setDialog({ kind: "export" });
            }}
            className="btn-primary inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold"
          >
            <ExportIcon width={16} height={16} /> Export
          </button>
        )}
      </div>
    </header>
  );

  // --- timeline tracks (hooks: must stay above the early return) -------------
  // Each track is memoized on what it shows, so the timeline's memoized rows
  // skip re-rendering tracks an edit didn't touch.
  const textTrack = useMemo<TimelineTrack>(() => {
    const layers = project.overlays.filter((o) => o.kind === "text");
    return {
      key: "text",
      label: "Text",
      tone: "border-sky-500/40 bg-sky-500/20",
      toggles: layerToggles(layers),
      items: layers.map((o) => ({
        id: o.id,
        start: o.start,
        end: o.end,
        label: o.kind === "text" ? o.text.content.split("\n")[0] || "Text" : "",
        glyph: "T",
        hidden: o.hidden,
        locked: o.locked,
        selected: selIs(selection, "overlay", o.id),
        sel: { kind: "overlay", id: o.id },
      })),
    };
  }, [project.overlays, selection]);
  const elementsTrack = useMemo<TimelineTrack>(() => {
    const layers = project.overlays.filter((o) => o.kind !== "text");
    return {
      key: "elements",
      label: "Elements",
      tone: "border-accent/40 bg-accent/20",
      toggles: layerToggles(layers),
      items: layers.map((o) => {
        const def = o.kind === "sticker" ? getStickerDef(o.stickerId) : undefined;
        return {
          id: o.id,
          start: o.start,
          end: o.end,
          label: o.kind === "sticker" ? (def?.label ?? "Sticker") : o.kind === "video" ? "Video" : o.kind === "shape" ? SHAPE_LABELS[o.shape.type] : "Image",
          thumb:
            o.kind === "image"
              ? sources[o.sourceId]?.url
              : o.kind === "video"
                ? (thumbs[o.sourceId]?.urls[0] ?? null)
                : def
                  ? stickerThumbSrc(def)
                  : null,
          glyph: o.kind === "video" ? "▶" : def?.kind === "emoji" ? def.char : "★",
          wave: o.kind === "video" ? { sourceId: o.sourceId, offset: o.offset, duration: o.end - o.start, gain: o.volume } : undefined,
          hidden: o.hidden,
          locked: o.locked,
          selected: selIs(selection, "overlay", o.id),
          sel: { kind: "overlay" as const, id: o.id },
        };
      }),
    };
  }, [project.overlays, selection, sources, thumbs]);
  const audioTrack = useMemo<TimelineTrack>(
    () => ({
      key: "audio",
      label: "Audio",
      tone: "border-emerald-500/40 bg-emerald-500/20",
      toggles: [{ kind: "mute", on: project.audio.length > 0 && project.audio.every((a) => a.muted) }],
      // Music beats: markers the clips and layers snap to.
      ticks: project.audio.flatMap((a) =>
        (a.beats?.times ?? [])
          .filter((b) => b >= a.offset && b < a.offset + a.duration)
          .map((b) => ({ t: a.start + b - a.offset, className: "bg-emerald-300/70", title: "Beat", snap: true }))
      ),
      items: project.audio.map((a) => ({
        id: a.id,
        start: a.start,
        end: a.start + a.duration,
        label: `${a.muted ? "🔇 " : ""}${a.label}`,
        glyph: "♪",
        wave: { sourceId: a.sourceId, offset: a.offset, duration: a.duration, gain: a.muted ? 0 : a.volume },
        selected: selIs(selection, "audio", a.id),
        sel: { kind: "audio" as const, id: a.id },
      })),
    }),
    [project.audio, selection]
  );
  const layClips = lay.clips;
  const zoomTrack = useMemo<TimelineTrack | null>(() => {
    if (!anyRecording && !zooms.length) return null;
    // Recorded clicks as ticks behind the zooms.
    const ticks: NonNullable<TimelineTrack["ticks"]> = [];
    if (rawPointer && recSource) {
      for (const c of layClips) {
        if (c.clip.sourceId !== recSource.id) continue;
        for (const k of rawPointer.clicks) {
          const t = timelineTimeOf(c, k.t);
          if (t !== null && ticks.length < 3000) ticks.push({ t, className: k.button === "left" ? "bg-cyan-400/80" : "bg-amber-400/80", title: `${k.button} click` });
        }
      }
    }
    return {
      key: "zoom",
      label: "Zoom",
      tone: "border-violet-500/40 bg-violet-500/20",
      items: zooms.flatMap((z) =>
        zoomSpans(layClips, z).map((sp) => ({
          id: `${z.id}#${sp.clipIndex}`,
          start: sp.start,
          end: sp.end,
          label: `${z.zoom.toFixed(1)}× ${z.reason ?? "Zoom"}`,
          glyph: "⌕",
          hidden: !z.enabled,
          selected: selIs(selection, "zoom", z.id),
          sel: { kind: "zoom" as const, id: z.id },
        }))
      ),
      ticks,
    };
  }, [anyRecording, zooms, rawPointer, recSource, layClips, selection]);
  const effectsTrack = useMemo<TimelineTrack>(
    () => ({
      key: "effects",
      label: "Effects",
      tone: "border-amber-500/40 bg-amber-500/20",
      items: project.effects.map((e) => ({
        id: e.id,
        start: e.start,
        end: e.end,
        label: EFFECT_LABELS[e.type],
        glyph: EFFECT_ICONS[e.type],
        selected: selIs(selection, "effect", e.id),
        sel: { kind: "effect" as const, id: e.id },
      })),
    }),
    [project.effects, selection]
  );
  const tracks = [textTrack, elementsTrack, audioTrack, ...(zoomTrack ? [zoomTrack] : []), effectsTrack];

  if (phase !== "edit" || !original) {
    const showRecents = phase === "import" && recents.length > 0;
    return (
      <div className="flex min-h-dvh flex-col bg-background">
        {header}
        <main className="flex flex-1 items-center justify-center p-4 sm:p-6">
          <div className={`glass-card w-full rounded-[2rem] p-6 sm:p-8 ${showRecents ? "max-w-5xl" : "max-w-2xl"}`}>
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Online <span className="text-gradient">Video Editor</span>
            </h1>
            <p className="mt-2 text-sm text-muted">
              Trim, cut and rearrange clips, add text, music, filters, effects, transitions and stickers, and clean up overlays with AI. Your
              original file is never changed.
            </p>

            <div className={`mt-6 grid gap-6 ${showRecents ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,23rem)]" : ""}`}>
              <div className="min-w-0">
                {phase === "probing" ? (
                  <div className="flex flex-col items-center gap-4 rounded-[1.75rem] border border-border bg-surface-2/70 p-12 text-center" role="status">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-2/20 border-t-accent-2" />
                    <p className="text-sm font-medium text-foreground">{opening ?? "Checking your video…"}</p>
                  </div>
                ) : phase === "loading" ? (
                  <div className="h-48 animate-pulse rounded-[1.75rem] bg-surface-2/70" />
                ) : (
                  <>
                    <input
                      ref={fileInput}
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={(e) => {
                        void importFile(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                    <input
                      ref={projectFileInput}
                      type="file"
                      accept={`.${PROJECT_FILE_EXT}`}
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void openProjectFile(f);
                        e.target.value = "";
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        trackEvent("upload_clicked", { tool: TOOL });
                        // Desktop: the OS dialog, so the video is edited where it is.
                        if (IS_DESKTOP) void chooseVideoOnDisk().then(importFile, (e) => setImportError({ message: String(e) }));
                        else fileInput.current?.click();
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsDragOver(true);
                      }}
                      onDragLeave={() => setIsDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDragOver(false);
                        void importFile(e.dataTransfer.files[0]);
                      }}
                      className={`flex w-full flex-col items-center justify-center rounded-[1.75rem] border-2 border-dashed px-6 py-10 text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
                        isDragOver ? "scale-[1.01] border-accent-2 bg-accent-2/10" : "border-border hover:border-accent-2/50 hover:bg-surface-2/40"
                      }`}
                    >
                      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-accent-2/30 bg-gradient-to-tr from-accent/20 to-accent-2/20 text-accent-2">
                        <UploadIcon width={24} height={24} />
                      </span>
                      <span className="text-base font-semibold text-foreground">Drop a video here, or click to browse</span>
                      <span className="mt-1 text-xs text-muted sm:text-sm">
                        {IS_DESKTOP ? "MP4, MOV, WebM · any size, edited where it is · exports up to 10 minutes" : "MP4, MOV, WebM · up to 300MB · up to 10 minutes"}
                      </span>
                    </button>
                    <p className="mt-2 text-center text-xs text-muted">
                      <button type="button" onClick={() => projectFileInput.current?.click()} className="underline hover:text-foreground">
                        Open a project file (.{PROJECT_FILE_EXT})
                      </button>
                    </p>
                    {(onRecord || onImageTools) && (
                      <div className={`mt-3 grid gap-3 ${onRecord && onImageTools ? "sm:grid-cols-2" : ""}`}>
                        {onRecord && (
                          <button
                            type="button"
                            onClick={onRecord}
                            className="btn-secondary flex items-center gap-3 rounded-2xl px-4 py-3 text-left"
                          >
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/15" aria-hidden>
                              <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold text-foreground">Record your screen</span>
                              <span className="block truncate text-xs text-muted">Capture, then edit right here</span>
                            </span>
                          </button>
                        )}
                        {onImageTools && (
                          <button
                            type="button"
                            onClick={onImageTools}
                            className="btn-secondary flex items-center gap-3 rounded-2xl px-4 py-3 text-left"
                          >
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-2/15 text-accent-2" aria-hidden>
                              <SparkleIcon width={16} height={16} />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold text-foreground">Image tools</span>
                              <span className="block truncate text-xs text-muted">Remove a background, sharpen, grab a frame</span>
                            </span>
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
              {showRecents && (
                <RecentProjects className="min-w-0" projects={recents} onOpen={openSaved} onRename={renameSaved} onDelete={removeSaved} />
              )}
            </div>

            {importError && (
              <p className={`mt-4 text-center text-sm font-medium ${importError.blocked ? "text-rose-600" : "text-rose-600 dark:text-rose-400"}`} role="alert">
                {importError.message}
                {importError.blocked && (
                  <>
                    {" "}
                    See our{" "}
                    <Link href="/terms" className="underline">
                      Terms
                    </Link>
                    .
                  </>
                )}
              </p>
            )}
            <p className="mt-6 border-t border-border pt-4 text-center text-xs text-muted">
              {IS_DESKTOP ? "Editing happens on this computer." : "Editing happens in your browser."} Your video is only uploaded to check it and when you export{AI_CLEANUP_ENABLED ? " or run AI Cleanup" : ""}, and isn&apos;t stored.
              {IS_DESKTOP && (
                <>
                  {" · "}
                  <button
                    type="button"
                    className="underline hover:text-foreground"
                    onClick={() => openNotices().catch((e) => showDesktopError("Couldn't open the licences", String(e)))}
                  >
                    Open-source licences
                  </button>
                </>
              )}
            </p>
          </div>
        </main>
      </div>
    );
  }

  // --- panel (right side / bottom sheet on mobile) -------------------------------
  const lookClip = selectedClip?.clip;
  let panel: React.ReactNode;
  if ((tool === "filters" || tool === "adjust") && lookClip) {
    panel = (
      <LookPanel
        mode={tool}
        look={lookClip.look}
        clipLabel={`Clip ${(selectedClip?.index ?? 0) + 1}`}
        thumb={thumbs[lookClip.sourceId]?.urls[Math.floor((thumbs[lookClip.sourceId]?.urls.length ?? 1) / 2)]}
        onChange={(look: Look) => apply((p) => updateClip(p, lookClip.id, { look }))}
        onApplyAll={() => {
          apply((p) => ({ ...p, clips: p.clips.map((c) => ({ ...c, look: lookClip.look })) }));
          say("Applied to all clips.");
        }}
        onClose={() => setTool(null)}
        gesture={gesture}
        premiumLocked={premiumLocked}
        onImportLut={(file) => void importLut(lookClip.id, file)}
      />
    );
  } else if (tool === "text") {
    panel = <TextAddPanel onAdd={addText} onClose={() => setTool(null)} />;
  } else if (tool === "elements") {
    panel = (
      <ElementsPanel
        onAddSticker={addSticker}
        onUploadImage={(f) => void uploadImage(f)}
        onUploadVideo={(f) => void uploadVideoLayer(f)}
        onClose={() => setTool(null)}
      />
    );
  } else if (tool === "audio") {
    panel = (
      <AudioAddPanel
        audio={project.audio}
        onUpload={(f) => void uploadAudio(f)}
        onAddSfx={(def) =>
          void renderSfx(def)
            .then((f) => uploadAudio(f))
            .catch(() => say("That sound couldn't be made in this browser."))
        }
        onSelect={(id) => select({ kind: "audio", id })}
        onClose={() => {
          void endVoiceover(false);
          setTool(null);
        }}
        voiceover={{
          recordingFrom,
          clock,
          level: () => voice.current?.session.level() ?? 0,
          onStart: () => void beginVoiceover(),
          onStop: () => void endVoiceover(),
          onCancel: () => void endVoiceover(false),
        }}
      />
    );
  } else if (tool === "effects") {
    panel = <EffectsAddPanel onAdd={addEffect} onClose={() => setTool(null)} premiumLocked={premiumLocked} />;
  } else if (tool === "canvas") {
    panel = (
      <CanvasPanel
        canvas={project.canvas}
        onChange={(canvas) => apply((p) => ({ ...p, canvas }))}
        onUploadBackground={(f) => void uploadBackground(f)}
        onClose={() => setTool(null)}
        gesture={gesture}
      />
    );
  } else if (tool === "transcript") {
    panel = (
      <TranscriptPanel
        transcript={project.transcript}
        current={transcriptCurrent(project.transcript, lay)}
        busy={captioning}
        clock={clock}
        hasCaptions={project.overlays.some((o) => o.caption)}
        onSeek={(t) => {
          setPlaying(false);
          seek(t);
        }}
        onTranscribe={() => void runTranscript()}
        onDelete={cutByWords}
        onClose={() => setTool(null)}
      />
    );
  } else if (tool === "captions") {
    panel = (
      <CaptionsPanel
        options={captionOpts}
        onOptions={setCaptionOpts}
        count={project.overlays.filter((o) => o.caption).length}
        busy={captioning}
        onGenerate={() => void runCaptions()}
        onRestyle={restyleCaptions}
        onRemoveAll={() => apply((p) => ({ ...p, overlays: p.overlays.filter((o) => !o.caption) }))}
        onClose={() => setTool(null)}
        modelCached={modelCached}
        model={captionModel}
        hidden={project.overlays.some((o) => o.caption) && project.overlays.filter((o) => o.caption).every((o) => o.hidden)}
        onToggleHidden={() =>
          apply((p) => {
            const caps = p.overlays.filter((o) => o.caption);
            const hide = !caps.every((o) => o.hidden);
            return { ...p, overlays: p.overlays.map((o) => (o.caption ? { ...o, hidden: hide } : o)) };
          })
        }
        onResize={(size) => apply((p) => ({ ...p, overlays: p.overlays.map((o) => (o.caption && o.kind === "text" ? { ...o, text: { ...o.text, size } } : o)) }))}
        onAlign={(align) => apply((p) => ({ ...p, overlays: p.overlays.map((o) => (o.caption && o.kind === "text" ? { ...o, text: { ...o.text, align } } : o)) }))}
        onExport={(f) => void exportCaptions(f)}
      />
    );
  } else if (tool === "focus") {
    panel = (
      <FocusPanel
        available={!!recSource}
        unavailableReason={
          anyRecording
            ? "This recording has no mouse events that can be placed on the video (a single window was recorded, the display couldn't be identified, or mouse recording was off). You can still add zooms by hand."
            : "Automatic zoom uses the mouse activity saved with screen recordings made in WipeClip's recorder. For this video you can add zooms by hand."
        }
        clickCount={rawPointer?.clicks.length ?? 0}
        cursorAllowed={recSource?.recording?.manifest.capture.cursorCaptured === false}
        zooms={zooms}
        pointer={project.pointer ?? null}
        analysis={analysis}
        onAnalyze={(s) => void runAnalysis(s)}
        onCancel={() => analysisCtrl.current?.abort()}
        onRemoveSuggestions={() => apply((p) => ({ ...p, zooms: (p.zooms ?? []).filter((z) => !z.auto) }))}
        onAddAtPlayhead={addZoomAtPlayhead}
        onSelect={selectZoom}
        onPointerChange={(pointer) => apply((p) => ({ ...p, pointer }))}
        onClose={() => setTool(null)}
        gesture={gesture}
      />
    );
  } else if (tool === "layers") {
    panel = (
      <LayersPanel
        overlays={project.overlays}
        selectedId={selectedOverlay?.id ?? null}
        sources={sources}
        onSelect={(id) => {
          setSelection({ kind: "overlay", id });
          const o = project.overlays.find((x) => x.id === id);
          if (o && (clock.get() < o.start || clock.get() >= o.end)) seek(o.start);
        }}
        onChange={changeOverlay}
        onRestack={(id, dir) => apply((p) => restackOverlay(p, id, dir))}
        onDelete={(id) => apply((p) => ({ ...p, overlays: p.overlays.filter((o) => o.id !== id) }))}
        onClose={() => setTool(null)}
      />
    );
  } else if (tool === "tutorial" || selection?.kind === "chapter") {
    panel = <TutorialPanel {...tutorial.panelProps} />;
  } else if (selectedMask) {
    panel = (
      <MaskPanel
        mask={selectedMask}
        total={lay.total}
        canFollow={!!recSource}
        canAnchor={!!selectedMask.sourceId || lay.clips.length > 0}
        onChange={(patch) =>
          apply((p) => ({
            ...p,
            masks: (p.masks ?? []).map((m) => {
              if (m.id !== selectedMask.id) return m;
              const next = { ...m, ...patch };
              // Switching to video space anchors it to the clip under the playhead.
              if (patch.space === "video" && !next.sourceId) {
                const loc = locate(lay, clock.get());
                next.sourceId = loc ? lay.clips[loc.primary.index].clip.sourceId : undefined;
              }
              return next;
            }),
          }))
        }
        onDelete={deleteSelection}
        onClose={() => setSelection(null)}
        gesture={gesture}
      />
    );
  } else if (selectedZoom) {
    panel = (
      <ZoomPanel
        zoom={selectedZoom}
        timelineStart={zoomSpans(lay.clips, selectedZoom)[0]?.start ?? null}
        onChange={(patch) => updateZoom(selectedZoom.id, patch)}
        canCenterOnPointer={!!rawPointer && selectedZoom.sourceId === recSource?.id}
        onCenterOnPointer={() => {
          const loc = locate(lay, clock.get());
          const laid = loc ? lay.clips[loc.primary.index] : undefined;
          const pos =
            laid && rawPointer && laid.clip.sourceId === selectedZoom.sourceId ? pointerAt(rawPointer, sourceTimeOf(laid, clock.get())) : null;
          if (pos) updateZoom(selectedZoom.id, { x: Math.min(1, Math.max(0, pos.x)), y: Math.min(1, Math.max(0, pos.y)) });
          else say("No recorded pointer position at the playhead.");
        }}
        onSplit={splitZoom}
        onDelete={deleteSelection}
        onClose={() => setSelection(null)}
        gesture={gesture}
      />
    );
  } else if (selectedClip && sources[selectedClip.clip.sourceId]) {
    const src = sources[selectedClip.clip.sourceId];
    const laidClip = selectedClip;
    const change = (patch: Partial<Clip>) =>
      apply((p) => {
        const keyTime = clipKeys(laidClip).keyTime(clock.get());
        return updateClip(p, laidClip.clip.id, animateClipPatch(laidClip.clip, patch, keyTime));
      });
    panel = (
      <ClipPanelLive
        clock={clock}
        lay={lay}
        laidIndex={selectedClip.index}
        source={src}
        onChange={change}
        onSplit={split}
        onDelete={deleteSelection}
        onMove={moveSelected}
        onAiCleanup={openCleanup}
        onClose={() => setSelection(null)}
        extra={
          <ClipExtras
            clip={selectedClip.clip}
            source={src}
            onChange={change}
            onExtractAudio={() => extractAudio(selectedClip.clip.id)}
            onCleanAudio={IS_DESKTOP ? () => void cleanUpAudio(selectedClip.clip.id) : undefined}
            onOpenLook={() => openLook("filters")}
            gesture={gesture}
            keys={clipKeys(selectedClip)}
            attrs={{
              onCopy: () => {
                setClipAttrs(clipAttributes(selectedClip.clip));
                say("Attributes copied. Select another clip and paste them.");
              },
              onPaste: clipAttrs ? () => apply((p) => ({ ...p, clips: p.clips.map((c) => (c.id === selectedClip.clip.id ? pasteClipAttributes(c, clipAttrs) : c)) })) : undefined,
              onPasteAll: clipAttrs
                ? () => {
                    apply((p) => ({ ...p, clips: p.clips.map((c) => pasteClipAttributes(c, clipAttrs)) }));
                    say("Pasted to every clip.");
                  }
                : undefined,
            }}
          />
        }
      />
    );
  } else if (selectedTransition >= 0 && selectedTransition < lay.clips.length - 1) {
    const laid = lay.clips[selectedTransition];
    panel = (
      <TransitionPanel
        laid={laid}
        next={lay.clips[selectedTransition + 1]}
        onChange={(transition) => apply((p) => updateClip(p, laid.clip.id, { transition }))}
        onClose={() => setSelection(null)}
        premiumLocked={premiumLocked}
      />
    );
  } else if (selectedOverlay) {
    panel = (
      <OverlayPanel
        overlay={selectedOverlay}
        total={lay.total}
        sourceDuration={selectedOverlay.kind === "video" ? sources[selectedOverlay.sourceId]?.duration : undefined}
        onChange={(patch) => changeOverlay(selectedOverlay.id, patch)}
        keys={overlayKeys(selectedOverlay)}
        fonts={{
          custom: Object.values(sources)
            .filter((s) => s.kind === "font")
            .map((s) => ({ key: customFontKey(s.id), label: (s.file?.name ?? "Font").replace(/\.[^.]+$/, "") })),
          onUpload: (f) => void uploadFont(selectedOverlay.id, f),
        }}
        style={{
          onCopy: () => {
            setLayerAttrs(layerAttributes(selectedOverlay));
            say("Style copied. Select another layer and paste it.");
          },
          onPaste: layerAttrs
            ? () => apply((p) => ({ ...p, overlays: p.overlays.map((o) => (o.id === selectedOverlay.id ? pasteLayerAttributes(o, layerAttrs) : o)) }))
            : undefined,
        }}
        onDuplicate={duplicate}
        onDelete={deleteSelection}
        onRestack={(dir) => apply((p) => restackOverlay(p, selectedOverlay.id, dir))}
        onClose={() => setSelection(null)}
        gesture={gesture}
        textAreaRef={textAreaRef}
      />
    );
  } else if (selectedAudio) {
    panel = (
      <AudioPanel
        clip={selectedAudio}
        sourceDuration={sources[selectedAudio.sourceId]?.duration ?? selectedAudio.offset + selectedAudio.duration}
        total={lay.total}
        onChange={(patch) => apply((p) => updateAudio(p, selectedAudio.id, patch))}
        onDuck={() => void duckUnderSpeech(selectedAudio.id)}
        onBeats={() => void findBeats(selectedAudio.id)}
        onSplit={split}
        onDuplicate={duplicate}
        onDelete={deleteSelection}
        onClose={() => setSelection(null)}
        gesture={gesture}
      />
    );
  } else if (selectedEffect) {
    panel = (
      <EffectPanel
        effect={selectedEffect}
        total={lay.total}
        onChange={(patch) => apply((p) => updateEffect(p, selectedEffect.id, patch))}
        onDuplicate={duplicate}
        onDelete={deleteSelection}
        onClose={() => setSelection(null)}
        gesture={gesture}
        premiumLocked={premiumLocked}
      />
    );
  } else {
    panel = (
      <PanelShell title="Project">
        <dl className="grid grid-cols-2 gap-3 text-xs">
          <Stat label="Length" value={formatTime(lay.total, true)} />
          <Stat label="Clips" value={String(project.clips.length)} />
          <Stat label="Canvas" value={project.canvas.aspect === "original" ? `${original.width}×${original.height}` : project.canvas.aspect} />
          <Stat label="Layers" value={String(project.overlays.length + project.audio.length + project.effects.length)} />
        </dl>
        <div className="mt-5 space-y-2 text-xs text-muted">
          <p className="font-semibold text-foreground">Getting started</p>
          <p>Click a clip on the timeline to trim, move, speed up, grade, or AI-clean it.</p>
          <p>Press S (or Split) to cut at the playhead. Split twice and delete the middle to remove a section.</p>
          <p>Add text, music, stickers, images and effects from the toolbar. They appear on their own timeline tracks.</p>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <ActionButton onClick={() => setTool("text")}>
            <TextIcon width={14} height={14} /> Add text
          </ActionButton>
          <ActionButton onClick={() => setTool("audio")}>
            <MusicIcon width={14} height={14} /> Add music
          </ActionButton>
          {AI_CLEANUP_ENABLED && (
            <ActionButton onClick={openCleanup} tone="accent">
              <SparkleIcon width={14} height={14} /> AI Cleanup
            </ActionButton>
          )}
        </div>
        <p className="mt-6 text-[11px] leading-relaxed text-muted">
          Shortcuts: Space play/pause · S split · F freeze frame · T text · Delete remove · Ctrl+C / Ctrl+V copy/paste · Ctrl+D duplicate · ←/→ frame step (Shift:
          1s) · Alt+←/→ move clip · Ctrl+Z / Ctrl+Shift+Z undo/redo
        </p>
      </PanelShell>
    );
  }

  // --- timeline tracks ------------------------------------------------------------
  const masks = project.masks ?? [];
  const chapterList = [...(project.chapters ?? [])].sort((a, b) => a.t - b.t);
  const reviewItems = (project.suggestions ?? []).filter((s) => s.status === "pending");
  const tutorialTracks: TimelineTrack[] = [
    ...(reviewItems.length
      ? [
          {
            key: "review",
            label: "Review",
            tone: "border-rose-500/40 bg-rose-500/15",
            items: reviewItems.map((s) => ({
              id: s.id,
              start: s.start,
              end: Math.max(s.end, s.start + 0.2),
              label: s.kind === "retake" ? `Retake${s.detail ? `: ${s.detail}` : ""}` : s.title,
              glyph: s.action === "cut" ? "✂" : s.kind === "retake" ? "↻" : "!",
              selected: false,
              sel: null,
            })),
          },
        ]
      : []),
    ...(chapterList.length
      ? [
          {
            key: "chapters",
            label: "Chapters",
            tone: "border-sky-500/40 bg-sky-500/10",
            items: chapterList.map((c, i) => ({
              id: c.id,
              start: c.t,
              end: chapterList[i + 1]?.t ?? lay.total,
              label: c.title,
              glyph: "§",
              selected: selIs(selection, "chapter", c.id),
              sel: { kind: "chapter" as const, id: c.id },
            })),
          },
        ]
      : []),
    ...(masks.length
      ? [
          {
            key: "privacy",
            label: "Privacy",
            tone: "border-amber-500/40 bg-amber-500/20",
            items: masks.map((m) => ({
              id: m.id,
              start: m.start,
              end: m.end,
              label: m.label || { blur: "Blur", pixelate: "Pixelate", solid: "Mask" }[m.mode],
              glyph: "▦",
              hidden: !m.enabled,
              selected: selIs(selection, "mask", m.id),
              sel: { kind: "mask" as const, id: m.id },
            })),
          },
        ]
      : []),
  ];

  const cleanupClip = dialog?.kind === "cleanup" ? project.clips.find((c) => c.id === dialog.clipId) : undefined;
  const toolBtn = (t: Tool, label: string, icon: React.ReactNode, title: string) => (
    <ToolButton label={title} onClick={() => (t === "filters" || t === "adjust" ? openLook(t) : setTool((cur) => (cur === t ? null : t)))} text={label} active={tool === t}>
      {icon}
    </ToolButton>
  );

  return (
    <div className="flex min-h-dvh flex-col bg-background lg:h-dvh">
      {header}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="h-[42dvh] min-h-[200px] p-3 lg:h-auto lg:min-h-0 lg:flex-1">
            <PreviewPlayer
              project={project}
              lay={lay}
              sources={sources}
              canvas={project.canvas}
              canvasSize={canvasSize}
              effects={project.effects}
              audio={project.audio}
              clock={clock}
              playing={playing}
              onEnded={onEnded}
              rate={rate}
              volume={volume}
              muted={muted}
              stageRef={stageRef}
            >
              <OverlayLayer
                clock={clock}
                canvasSize={canvasSize}
                overlays={project.overlays}
                rasters={rasters}
                playback={{ playing, rate, volume, muted }}
                selectedId={selectedOverlay?.id ?? null}
                onSelect={(id) => {
                  if (id) select({ kind: "overlay", id });
                  else if (selection?.kind === "overlay") setSelection(null);
                }}
                onChange={changeOverlay}
                onGestureStart={beginGesture}
                onGestureEnd={endGesture}
                onEditText={(id) => {
                  select({ kind: "overlay", id });
                  setTimeout(() => textAreaRef.current?.focus(), 30);
                }}
              />
              {selectedMask && (
                <MaskEditLayer
                  clock={clock}
                  mask={selectedMask}
                  lay={lay}
                  project={project}
                  sources={sources}
                  canvasSize={canvasSize}
                  onChange={(patch) => apply((p) => ({ ...p, masks: (p.masks ?? []).map((m) => (m.id === selectedMask.id ? { ...m, ...patch } : m)) }))}
                  onGestureStart={beginGesture}
                  onGestureEnd={endGesture}
                />
              )}
            </PreviewPlayer>
          </div>

          <PlayerControls
            clock={clock}
            total={lay.total}
            playing={playing}
            onToggle={togglePlay}
            onSeek={seek}
            rate={rate}
            onRate={setRate}
            volume={volume}
            onVolume={setVolume}
            muted={muted}
            onMute={() => setMuted((m) => !m)}
            onFullscreen={toggleFullscreen}
          />

          <div
            className="flex items-center gap-1 overflow-x-auto border-y border-border bg-surface/60 px-2 py-1.5 sm:gap-1.5 sm:px-3"
            role="toolbar"
            aria-label="Editing tools"
          >
            <ToolButton label="Split at playhead (S)" onClick={split} text="Split">
              <SplitIcon />
            </ToolButton>
            <ToolButton label="Freeze the frame at the playhead (F)" onClick={freezeFrame} text="Freeze">
              <FreezeIcon />
            </ToolButton>
            <ToolButton label="Trim the clip at the playhead" onClick={openTrim} text="Trim">
              <TrimIcon />
            </ToolButton>
            <ToolButton label="Delete selection (Delete)" onClick={deleteSelection} text="Delete">
              <TrashIcon />
            </ToolButton>
            <span className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden />
            {toolBtn("text", "Text", <TextIcon />, "Add text (T)")}
            {toolBtn("captions", "Captions", <CaptionsIcon />, "Auto captions from speech")}
            {toolBtn("transcript", "Transcript", <TextIcon />, "Edit by text: delete words to cut them out")}
            {toolBtn("audio", "Audio", <MusicIcon />, "Music and audio")}
            {toolBtn("elements", "Elements", <ElementsIcon />, "Stickers and images")}
            {toolBtn("effects", "Effects", <EffectIcon />, "Timed effects")}
            {toolBtn("filters", "Filters", <FilterIcon />, "Filters for the selected clip")}
            {toolBtn("adjust", "Adjust", <AdjustIcon />, "Adjust color and light")}
            <ToolButton label="Transition between clips" onClick={openTransition} text="Transition">
              <TransitionIcon />
            </ToolButton>
            {(IS_DESKTOP || zooms.length > 0) && toolBtn("focus", "Focus", <ZoomInIcon />, "Automatic zoom, click highlights and cursor")}
            {toolBtn("tutorial", "Tutorial", <SparkleIcon />, "Review pauses, chapters, shortcuts, privacy masks, annotations, retakes")}
            {toolBtn("canvas", "Canvas", <CanvasIcon />, "Canvas size and background")}
            {toolBtn("layers", "Layers", <LayersIcon />, "Layer order, hide and lock")}
            {AI_CLEANUP_ENABLED && (
              <>
                <span className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden />
                <ToolButton label="AI Cleanup on the selected clip" onClick={openCleanup} text="AI Cleanup" accent>
                  <SparkleIcon />
                </ToolButton>
              </>
            )}
          </div>

          <div className="max-h-[40dvh] overflow-y-auto p-2 sm:p-3 lg:max-h-[38dvh]">
            <Timeline
              lay={lay}
              sources={sources}
              thumbnails={thumbs}
              waveforms={waves}
              tracks={[...tutorialTracks, ...tracks]}
              selection={selection}
              clock={clock}
              playing={playing}
              onSelect={select}
              onSeek={seek}
              onClipChange={(id, patch) => apply((p) => updateClip(p, id, patch))}
              onItemChange={onItemChange}
              onMoveClip={(from, to) => apply((p) => moveClip(p, from, to))}
              onTrackToggle={onTrackToggle}
              onGestureStart={beginGesture}
              onGestureEnd={endGesture}
            />
          </div>
        </main>

        <aside className="border-t border-border bg-surface/50 lg:w-80 lg:shrink-0 lg:overflow-hidden lg:border-l lg:border-t-0 xl:w-96" aria-label="Properties">
          <PremiumLocked.Provider value={premiumLocked}>{panel}</PremiumLocked.Provider>
        </aside>
      </div>

      {(toast || busy) && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 z-[80] flex max-w-[90vw] -translate-x-1/2 items-center gap-2 rounded-full bg-foreground px-4 py-2 text-center text-xs font-medium text-background shadow-xl"
        >
          {busy && <span className="h-3 w-3 animate-spin rounded-full border-2 border-background/30 border-t-background" />}
          {busy ?? toast}
        </div>
      )}

      {dialog?.kind === "cleanup" && cleanupClip && sources[cleanupClip.sourceId] && (
        <AiCleanupDialog
          clip={cleanupClip}
          source={sources[cleanupClip.sourceId]}
          frameTime={dialog.frameTime}
          isSignedIn={isSignedIn}
          onClose={() => setDialog(null)}
          onCleaned={(src) => onCleaned(cleanupClip.id, src)}
          onSignIn={() => setShowSignIn(true)}
        />
      )}
      {tutorial.dialog}
      {dialog?.kind === "export" && originalId && (
        <ExportDialog
          project={project}
          sources={sources}
          originalId={originalId}
          total={lay.total}
          isSignedIn={isSignedIn}
          tier={tier}
          initialResult={pendingExport}
          onClose={() => setDialog(null)}
          onSignIn={() => setShowSignIn(true)}
        />
      )}
      <SignInModal open={showSignIn} onClose={() => setShowSignIn(false)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className="font-mono font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  disabled,
  children,
  text,
  accent,
  active,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  text?: string;
  accent?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={text ? undefined : label}
      aria-pressed={active}
      className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:cursor-not-allowed disabled:opacity-35 ${
        active
          ? "bg-accent text-white"
          : accent
            ? "text-accent hover:bg-accent/10 dark:text-accent-light"
            : "text-foreground hover:bg-surface-3"
      }`}
    >
      {children}
      {text && <span className="hidden sm:inline">{text}</span>}
      {text && <span className="sr-only sm:hidden">{text}</span>}
    </button>
  );
}

function PlayerControls({
  clock,
  total,
  playing,
  onToggle,
  onSeek,
  rate,
  onRate,
  volume,
  onVolume,
  muted,
  onMute,
  onFullscreen,
}: {
  clock: Clock;
  total: number;
  playing: boolean;
  onToggle: () => void;
  onSeek: (t: number) => void;
  rate: number;
  onRate: (r: number) => void;
  volume: number;
  onVolume: (v: number) => void;
  muted: boolean;
  onMute: () => void;
  onFullscreen: () => void;
}) {
  const t = useClockTime(clock);
  return (
    <div className="flex items-center gap-2 px-3 pb-2 sm:gap-3">
      <button
        type="button"
        onClick={onToggle}
        aria-label={playing ? "Pause (Space)" : "Play (Space)"}
        title={playing ? "Pause (Space)" : "Play (Space)"}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-[0_0_15px_rgba(124,92,255,0.4)] transition hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 focus-visible:ring-offset-2"
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <span className="shrink-0 font-mono text-xs text-foreground">
        {formatTime(t, true)} <span className="text-muted">/ {formatTime(total, true)}</span>
      </span>
      <input
        type="range"
        min={0}
        max={Math.max(0.01, total)}
        step={0.01}
        value={Math.min(t, total)}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label="Seek"
        className="min-w-0 flex-1 accent-[var(--accent)]"
      />
      <select
        value={rate}
        onChange={(e) => onRate(Number(e.target.value))}
        aria-label="Playback speed"
        className="hidden rounded-md border border-border bg-surface px-1.5 py-1 text-xs text-foreground sm:block"
      >
        {RATES.map((r) => (
          <option key={r} value={r}>
            {r}×
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onMute}
        aria-label={muted ? "Unmute" : "Mute"}
        title={muted ? "Unmute" : "Mute"}
        className="rounded-md p-1.5 text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
      >
        {muted || volume === 0 ? <MuteIcon /> : <VolumeIcon />}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        onChange={(e) => onVolume(Number(e.target.value))}
        aria-label="Volume"
        className="hidden w-20 accent-[var(--accent)] md:block"
      />
      <button
        type="button"
        onClick={onFullscreen}
        aria-label="Fullscreen"
        title="Fullscreen"
        className="rounded-md p-1.5 text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
      >
        <FullscreenIcon />
      </button>
    </div>
  );
}

/** Clip panel re-rendered from the clock (for "trim here" availability)
 * without re-rendering the whole editor every frame.
 */
function ClipPanelLive({
  clock,
  lay,
  laidIndex,
  source,
  onChange,
  onSplit,
  onDelete,
  onMove,
  onAiCleanup,
  onClose,
  extra,
}: {
  clock: Clock;
  lay: ReturnType<typeof layout>;
  laidIndex: number;
  source: MediaSource;
  onChange: (patch: Partial<Clip>) => void;
  onSplit: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onAiCleanup: () => void;
  onClose: () => void;
  extra: React.ReactNode;
}) {
  const t = useClockTime(clock);
  const loc = locate(lay, t);
  const inside = loc && !loc.incoming && loc.primary.index === laidIndex ? loc.primary.sourceTime : null;
  return (
    <ClipPanel
      laid={lay.clips[laidIndex]}
      count={lay.clips.length}
      source={source}
      playheadSourceTime={inside}
      onChange={onChange}
      onSplit={onSplit}
      onDelete={onDelete}
      onMove={onMove}
      onAiCleanup={onAiCleanup}
      onClose={onClose}
      extra={extra}
    />
  );
}
