"use client";

import { modKey, useShortcutKeys } from "@/lib/platform/keys";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AppVersion from "@/components/AppVersion";
import AuthStatus from "@/components/AuthStatus";
import Logo from "@/components/Logo";
import SignInModal from "@/components/SignInModal";
import ThemeToggle from "@/components/ThemeToggle";
import { trackEvent, useToolView } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";
import { apiFetch, confirmAction, EngineUnavailableError, IS_DESKTOP, openNotices, saveExportFile, showDesktopError, watchOpenedProjectFiles } from "@/lib/platform";
import { createClock, useClockTime, type Clock } from "@/lib/editor/clock";
import { useProjectHistory } from "@/lib/editor/history";
import {
  generateThumbnails,
  generateWaveform,
  normalizedWaveform,
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
import { chooseVideoOnDisk, diskMediaUrl, matteUrl, openDiskMedia } from "@/lib/platform/media";
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
  type CamLayout,
  type Clip,
  type EffectClip,
  type LoudnessTarget,
  type MasterAudio,
  type EffectType,
  type Look,
  type DiskMedia,
  type MediaSource,
  type Overlay,
  type Project,
  type Selection,
  type TextStyle,
  type Transcript,
  type VoiceTone,
  type GainPoint,
} from "@/lib/editor/types";
import { presetTone } from "@/lib/editor/voiceTone";
import { ApiError, cleanAudio, type CleanStage, ContentBlockedError, engineAudioModels, engineDubModels, engineMatte, enginePeaks, ModelNeededError, probeVideo } from "@/lib/toolsApi";
import { ensureMatte, fullMatte, matteJobKey, matteUnsupported, setMatteEngine, useMatteJob } from "@/lib/editor/matte";
import { DUB_FROM, dubTimeline, type DubProgress } from "@/lib/editor/dub";
import type { RecordingBundle } from "@/lib/recorder/bundle";
import { recordingToSources } from "@/lib/recorder/editorImport";
import { planRecordingProject, type ImportedTrack } from "@/lib/recorder/importPlan";
import { sourceTimeOf, timelineTimeOf, zoomSpans } from "@/lib/editor/camera";
import { MIN_ZOOM_LENGTH, dragZoom, mergeSuggestions, patchZoom, removeZoom, splitZoom as splitZoomAt } from "@/lib/editor/zoomEdits";
import { analyzeFocus, type FocusSettings } from "@/lib/editor/focus";
import { interactionTimeline, skipTarget } from "@/lib/editor/insights";
import { eventsForSuggestions, excludeRange, focusPrefs, isClickIgnored, patchFocusPrefs, previewWithoutZooms, removeExclusion, setClickIgnored } from "@/lib/editor/focusPrefs";
import { buildPointerTrack, nativeCursorSize, pointerAt, recordingEvents } from "@/lib/editor/pointer";
import { FocusPanel, ZoomPanel, type AnalysisState } from "./FocusPanel";
import MaskEditLayer from "./MaskEditLayer";
import { SHAPE_LABELS } from "@/lib/editor/shapes";
import { MaskPanel, TutorialPanel } from "./TutorialPanel";
import { useTutorialTools } from "./useTutorialTools";
import { HighlightsPanel } from "./HighlightsPanel";
import { useHighlights } from "./useHighlights";
import { CREATOR_PRESETS, applyCreatorPreset, type CreatorPresetId } from "@/lib/editor/creatorPresets";
import { DEFAULT_KEYSTROKES, keystrokeOverlays } from "@/lib/editor/keystrokes";
import { captionCues, toPlainTranscript, toSrt, toVtt } from "@/lib/editor/transcript";
import {
  buildSpeechMix,
  cancelSpeech,
  saveCaptionLanguage,
  savedCaptionLanguage,
  saveCaptionPrefs,
  savedCaptionPrefs,
  speechModel,
  speechModelCached,
  type SpeechModel,
} from "@/lib/editor/captions";
import { ANALYSIS_RATE } from "@/lib/editor/audioAnalysis";
import { renderProgramMix } from "@/lib/editor/programMix";
import { LOUDNESS_TARGETS, measureLoudness, normalizationGain } from "@/lib/editor/loudness";
import { liveSolo, masterOf, mixKey, smoothCutsOn, toggleSolo, withCleanup } from "@/lib/editor/mix";
import { applyCamLayout, placeWebcam, relayoutWebcams, screenAspectOf, screenForLayout } from "@/lib/editor/webcamLayout";
import MixerPanel from "./MixerPanel";
import { saveTextFile } from "@/lib/platform";
import {
  buildSpeechAudio,
  captionOverlays,
  captionText,
  captionUpper,
  CAPTION_STYLES,
  groupWords,
  lineCharsFor,
  speechModelProbe,
  transcribe,
  type CaptionsProgress,
} from "@/lib/editor/captions";
import { editCaption, mergeCaptions, replaceInCaptions } from "@/lib/editor/captionEdit";
import { TIER_LIMITS, toTier, type Tier } from "@/lib/entitlements";
import AiCleanupDialog from "./AiCleanupDialog";
import ExportDialog from "./ExportDialog";
import BatchExportDialog, { type BatchFormat, type BatchItem } from "./BatchExportDialog";
import { ActionButton, ClipPanel, PanelShell, TransitionPanel, type ClipSection } from "./Inspector";
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
import Timeline, { type CurveEdit, type ItemMode, type TimelineTrack, type TrackToggle } from "./Timeline";
import { addPoint, normalizePoints, visibleCurve } from "@/lib/editor/envelope";
import { autoCleanupOptions, cleanupSummary, voiceTracks, type AutoCleanupResult, type CleanupOption } from "@/lib/editor/cleanupPlan";
import CleanupDialog from "./CleanupDialog";
import {
  CanvasIcon,
  ElementsIcon,
  ExportIcon,
  FilterIcon,
  FullscreenIcon,
  MusicIcon,
  MuteIcon,
  PauseIcon,
  PlayIcon,
  RedoIcon,
  SparkleIcon,
  SplitIcon,
  FreezeIcon,
  MoreIcon,
  TextIcon,
  TrashIcon,
  TrimIcon,
  UndoIcon,
  UploadIcon,
  VolumeIcon,
  ChevronLeftIcon,
} from "./icons";

const TOOL = "video_editor";
const MAX_BYTES = 300 * 1024 * 1024;
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const EMPTY: Project = { clips: [], overlays: [], audio: [], effects: [], canvas: DEFAULT_CANVAS };
const RATES = [0.5, 1, 1.5, 2];

type Tool = "text" | "captions" | "transcript" | "elements" | "audio" | "effects" | "filters" | "adjust" | "transition" | "canvas" | "layers" | "focus" | "tutorial" | "highlights";
type GroupTab = { id: Tool; label: string; hint: string };
/** The left rail: each button opens a group, whose tools show as tabs on
 * top of its panel. */
const TOOL_GROUPS: { id: string; label: string; icon: (p: React.SVGProps<SVGSVGElement>) => React.ReactNode; tabs: GroupTab[] }[] = [
  {
    id: "text",
    label: "Text",
    icon: TextIcon,
    tabs: [
      { id: "text", label: "Text", hint: "Add text (T)" },
      { id: "captions", label: "Captions", hint: "Auto captions from speech" },
      { id: "transcript", label: "Transcript", hint: "Edit by text: delete words to cut them out" },
    ],
  },
  { id: "audio", label: "Audio", icon: MusicIcon, tabs: [{ id: "audio", label: "Audio", hint: "Music, voiceover and mix" }] },
  {
    id: "elements",
    label: "Elements",
    icon: ElementsIcon,
    tabs: [
      { id: "elements", label: "Add", hint: "Stickers, shapes, images and videos" },
      { id: "layers", label: "Layers", hint: "Layer order, hide and lock" },
    ],
  },
  {
    id: "look",
    label: "Look",
    icon: FilterIcon,
    tabs: [
      { id: "filters", label: "Filters", hint: "Filters for the selected clip" },
      { id: "adjust", label: "Adjust", hint: "Color and light for the selected clip" },
      { id: "effects", label: "Effects", hint: "Timed effects" },
      { id: "transition", label: "Transition", hint: "Transition between clips" },
    ],
  },
  { id: "canvas", label: "Canvas", icon: CanvasIcon, tabs: [{ id: "canvas", label: "Canvas", hint: "Canvas size and background" }] },
  {
    id: "smart",
    label: "Smart",
    icon: SparkleIcon,
    tabs: [
      { id: "focus", label: "Focus", hint: "Automatic zoom, click highlights and cursor" },
      { id: "highlights", label: "Highlights", hint: "Suggest moments worth their own clip" },
      { id: "tutorial", label: "Tutorial", hint: "Pauses, chapters, shortcuts, privacy masks, retakes" },
    ],
  },
];
const DESKTOP = "(min-width: 1024px)"; // Tailwind lg
const groupOf = (t: Tool | null) => (t ? TOOL_GROUPS.find((g) => g.tabs.some((x) => x.id === t)) : undefined);
type Dialogs =
  | { kind: "cleanup"; clipId: string; frameTime: number }
  /** `clip`: export a copy holding only part of the timeline (a highlight). */
  | { kind: "export"; clip?: { project: Project; total: number; title: string; nameSuffix: string } }
  /** Several highlights, each its own file (BatchExportDialog). */
  | { kind: "batch"; items: BatchItem[]; vertical: boolean }
  | null;
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
/** The Text track's single block standing for every auto caption, when
 * they're shown combined (the track header's group switch). */
const CAPTION_GROUP = "captions-group";
const GROUP_KEY = "wipeclip.captionsGrouped";

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
  const keys = useShortcutKeys();
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
  // Focus panel's "Compare with original": preview only, while the panel is open.
  const [comparingZooms, setComparingZooms] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, ThumbnailStrip>>({});
  const [waves, setWaves] = useState<Record<string, Waveform>>({});
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Solo is a listening aid (mix.ts): kept out of the project and history.
  const [soloRaw, setSolo] = useState<ReadonlySet<string>>(() => new Set());
  const [cleaningTrack, setCleaningTrack] = useState<string | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [captionOpts, setCaptionOpts] = useState<CaptionOptions>(() => ({
    maxWords: 3,
    style: "bold",
    y: 0.82,
    ...savedCaptionPrefs(),
    language: savedCaptionLanguage(),
  }));
  useEffect(() => saveCaptionLanguage(captionOpts.language), [captionOpts.language]);
  useEffect(() => {
    const { maxWords, style, y, look, hint, accurate } = captionOpts;
    saveCaptionPrefs({ maxWords, style, y, look, hint, accurate });
  }, [captionOpts]);
  const [captioning, setCaptioning] = useState(false);
  // Captions shown as one block on the Text track (a view setting, kept on this device).
  const [captionsGrouped, setCaptionsGrouped] = useState(() => {
    try {
      return localStorage.getItem(GROUP_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(GROUP_KEY, captionsGrouped ? "1" : "0");
    } catch {
      // Not remembered.
    }
  }, [captionsGrouped]);
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
        // Desktop: measured by the engine from disk, any length, without
        // reading the file into the page.
        if (src.disk) {
          const measured = await enginePeaks(src.disk.path, controller.signal).catch(() => null);
          if (measured) {
            const wave = normalizedWaveform(measured.peaks, measured.rate);
            if (wave && !controller.signal.aborted) setWaves((w) => ({ ...w, [src.id]: wave }));
            return;
          }
        }
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
        } else if (e instanceof ApiError || e instanceof EngineUnavailableError) {
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
        // Moving or resizing a webcam placed by a layout frees it.
        const freed = o?.kind === "video" && o.camLayout && ("x" in patch || "y" in patch || "width" in patch) && !("camLayout" in patch);
        const next = freed ? ({ ...patch, camLayout: undefined } as Partial<Overlay>) : patch;
        return updateOverlay(p, id, o ? animateOverlayPatch(o, next, clock.get()) : next);
      }),
    [apply, clock]
  );
  // --- webcam background removal (matte.ts) ----------------------------------
  useEffect(() => {
    if (IS_DESKTOP) setMatteEngine({ render: engineMatte, url: matteUrl });
  }, []);
  // Every shown webcam layer with its background removed gets its matted
  // file made (once per video and detail, cached by the engine): the
  // layers' source ids and details, a line each.
  const matteJobs = [
    ...new Set(project.overlays.flatMap((o) => (o.kind === "video" && o.matte && !o.hidden && sources[o.sourceId] ? [`${o.sourceId}\t${o.matte.detail ?? "fine"}`] : []))),
  ].join("\n");
  useEffect(() => {
    if (!IS_DESKTOP) return;
    for (const line of matteJobs.split("\n").filter(Boolean)) {
      const [id, detail] = line.split("\t");
      const src = sourcesRef.current[id];
      if (src && !matteUnsupported(src, IS_DESKTOP)) ensureMatte(src, detail === "fast" ? "fast" : "fine").catch(() => {});
    }
  }, [matteJobs]);
  const selectedLayerSrc = selectedOverlay?.kind === "video" ? sources[selectedOverlay.sourceId] : undefined;
  const selectedMatteJob = useMatteJob(
    selectedOverlay?.kind === "video" && selectedOverlay.matte ? matteJobKey(selectedLayerSrc, selectedOverlay.matte.detail) : null
  );
  const matteBgInput = useRef<HTMLInputElement>(null);
  const matteBgFor = useRef<string | null>(null);
  const setMatteBg = useCallback(
    (layerId: string, src: MediaSource) =>
      apply((p) => {
        const o = p.overlays.find((x) => x.id === layerId);
        return o?.kind === "video" && o.matte ? updateOverlay(p, layerId, { matte: { ...fullMatte(o.matte), bgSourceId: src.id } } as Partial<Overlay>) : p;
      }),
    [apply]
  );
  /** A background video picked on disk: played where it is, like any disk
   * video, after the same decode check and screening as an import. */
  const pickMatteVideo = useCallback(
    async (layerId: string) => {
      const disk = await chooseVideoOnDisk().catch((e) => {
        say(String(e));
        return null;
      });
      if (!disk) return;
      setBusy("Adding background video…");
      try {
        const url = await diskMediaUrl(disk.path);
        const [meta, probe] = await Promise.all([loadVideoMeta(url), probeVideo(disk)]);
        URL.revokeObjectURL(probe.previewUrl);
        const src: MediaSource = {
          id: newId("lyr"),
          kind: "layer",
          file: null,
          disk,
          url,
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
          fps: probe.info.fps > 0 && probe.info.fps <= 240 ? probe.info.fps : 30,
          hasAudio: probe.info.hasAudio ?? false,
        };
        addSource(src);
        setMatteBg(layerId, src);
      } catch (e) {
        if (e instanceof ContentBlockedError || e instanceof ApiError || e instanceof EngineUnavailableError) say(e.message);
        else if (e instanceof Error && e.message === "media_error") say("This video's format can't be played. Try an MP4 (H.264) file.");
        else say("Couldn't use this video as the background. Try a different file.");
      } finally {
        setBusy(null);
      }
    },
    [addSource, setMatteBg, say]
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

  // One side panel (beside the rail on desktop, below the timeline on
  // mobile) shows whatever was opened last: a tool from the rail, or the
  // properties of what's selected. Selecting something closes the tool,
  // except that picking another clip keeps Filters/Adjust open on it.
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP);
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const select = useCallback((s: Selection) => {
    // The combined captions block opens the captions panel (Edit text).
    if (s?.kind === "overlay" && s.id === CAPTION_GROUP) {
      setSelection(null);
      setTool("captions");
      return;
    }
    setTool((t) => ((t === "filters" || t === "adjust") && s?.kind === "clip" ? t : null));
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
    say(`Copied. Press ${modKey()}+V to paste at the playhead.`);
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
        if (e instanceof ContentBlockedError || e instanceof ApiError || e instanceof EngineUnavailableError) say(e.message);
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
  // Cancel: set when the user stops a transcription, checked between steps
  // (the audio is prepared before the model workers run).
  const speechCancelled = useRef(false);
  const cancelTranscription = useCallback(() => {
    speechCancelled.current = true;
    cancelSpeech();
  }, []);

  const transcribeTimeline = useCallback(async (): Promise<Transcript | null> => {
    speechCancelled.current = false;
    const stopIfCancelled = () => {
      if (speechCancelled.current) throw new DOMException("Speech recognition cancelled", "AbortError");
    };
    const progress = ({ stage, value }: CaptionsProgress) =>
      setBusy(
        stage === "download"
          ? `Downloading speech files (first time only)… ${Math.round(value * 100)}%`
          : stage === "prepare"
            ? "Preparing speech model…"
            : `Transcribing speech on your device… ${Math.round(value * 100)}%`
      );
    setBusy("Preparing audio…");
    const samples = await buildSpeechAudio(lay, project, sources, speechModelProbe(progress));
    stopIfCancelled();
    if (!samples) return null;
    setBusy("Loading speech model…");
    let res;
    try {
      res = await transcribe(samples, captionOpts.language, progress, { hint: captionOpts.hint, accurate: captionOpts.accurate });
    } catch (e) {
      // "Auto" heard a language whose own model isn't downloaded: pick the
      // language so the panel offers that download (its own consent).
      if (e instanceof ModelNeededError) setCaptionOpts((o) => ({ ...o, language: e.language }));
      throw e;
    }
    stopIfCancelled();
    return { language: res.language, words: res.words, total: lay.total };
  }, [lay, project, sources, captionOpts.language, captionOpts.hint, captionOpts.accurate]);

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
      const caps = captionOverlays(chunks, captionOpts.style, captionOpts.y, captionOpts.look);
      // One undo step; regenerating replaces earlier captions. The words
      // are kept too, for editing by text (Transcript).
      apply((p) => ({ ...p, overlays: [...p.overlays.filter((o) => !o.caption), ...caps], transcript }));
      say(`Added ${caps.length} captions. Fix any word in Edit text.`);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        say("Captioning cancelled. Nothing was changed.");
        return;
      }
      console.error("[captions]", e);
      say(e instanceof ApiError ? e.message : "Captioning failed. Check your connection and try again.");
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
      if ((e as Error)?.name === "AbortError") {
        say("Transcribing cancelled. Nothing was changed.");
        return;
      }
      console.error("[transcript]", e);
      say(e instanceof ApiError ? e.message : "Transcribing failed. Check your connection and try again.");
    } finally {
      setBusy(null);
      setCaptioning(false);
    }
  }, [transcribeTimeline, apply, say]);

  // --- voice translation (desktop): the speech said again in English in
  // the speaker's voice (lib/editor/dub.ts). Lands as two audio tracks, the
  // English voice and the background, with the original speech muted - one
  // undo step.
  const [dubbing, setDubbing] = useState(false);
  const [dubModels, setDubModels] = useState<{ ready: boolean; sizeMb: number } | null>(null);
  const dubAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    if (tool !== "transcript" || !IS_DESKTOP) return;
    let cancelled = false;
    void engineDubModels().then((m) => !cancelled && setDubModels(m));
    return () => {
      cancelled = true;
    };
  }, [tool, dubbing]);
  const runDub = useCallback(async () => {
    const transcript = project.transcript;
    if (!transcript || !transcriptCurrent(transcript, lay)) return;
    setPlaying(false);
    setDubbing(true);
    const abort = new AbortController();
    dubAbort.current = abort;
    const label = (p: DubProgress) => {
      const pct = "value" in p ? ` ${Math.round(p.value * 100)}%` : "";
      switch (p.stage) {
        case "translate":
          return "Translating the transcript…";
        case "mix":
          return "Preparing audio…";
        case "download":
          return `Downloading voice files (first time only)…${pct}`;
        case "separate":
          return `Separating the voice from the background…${pct}`;
        case "voice":
          return "Learning the speaker's voice…";
        case "speak":
          return `Speaking in English…${pct}`;
      }
    };
    try {
      const res = await dubTimeline(lay, project, sources, transcript.words, transcript.language, (p) => setBusy(label(p)), abort.signal);
      const track = (file: File, label: string): { src: MediaSource; clip: AudioClip } => {
        const src: MediaSource = { id: newId("snd"), kind: "audio", file, url: URL.createObjectURL(file), duration: lay.total, width: 0, height: 0, fps: 0, hasAudio: true };
        const clip: AudioClip = { id: newId("aud"), sourceId: src.id, label, start: 0, offset: 0, duration: lay.total, volume: 1, fadeIn: 0, fadeOut: 0, muted: false };
        return { src, clip };
      };
      const background = track(res.background, "Background (voice removed)");
      const voice = { ...track(res.voice, "English voice") };
      voice.clip.captions = "speech";
      background.clip.captions = "music";
      addSource(background.src);
      addSource(voice.src);
      const muted = new Set(res.tracks);
      apply((p) => ({
        ...p,
        clips: p.clips.map((c) => (c.freeze === null && !c.reverse && c.volume > 0 && sources[c.sourceId]?.hasAudio ? { ...c, volume: 0 } : c)),
        audio: [...p.audio.map((a) => (muted.has(a.id) ? { ...a, muted: true } : a)), background.clip, voice.clip],
      }));
      setSelection({ kind: "audio", id: voice.clip.id });
      say("Added the English voice and the background as audio tracks; the original speech is muted. Undo to go back.");
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        say("Voice translation cancelled. Nothing was changed.");
        return;
      }
      console.error("[dub]", e);
      say(e instanceof ApiError ? e.message : "Voice translation failed. Check your connection and try again.");
    } finally {
      dubAbort.current = null;
      setBusy(null);
      setDubbing(false);
    }
  }, [project, lay, sources, addSource, apply, say]);

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
        next = { ...next, overlays: [...next.overlays.filter((o) => !o.caption), ...captionOverlays(chunks, captionOpts.style, captionOpts.y, captionOpts.look)] };
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
            ? { ...o, y: opts.y, animIn: CAPTION_STYLES[opts.style].animIn, text: captionText(o.text.content, opts.style, opts.look) }
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
        const { blob } = await cleanAudio(sourceInput(src), laid.clip.start, laid.clip.end, { denoise: 0.6, level: true });
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

  /** Noise reduction for an audio track: a cleaned copy of its whole
   * file, made by the local engine and played (and exported) instead of
   * the original, which is never changed (mix.ts). Every part of the same
   * file (a microphone split by cuts) gets it, so they stay alike. */
  const cleanTrack = useCallback(
    async (
      audioId: string,
      strength: number,
      repair = false,
      extra: { wind?: boolean; mouth?: boolean; echo?: number; isolate?: boolean } = {},
      run: { signal?: AbortSignal; onProgress?: (stage: CleanStage, value: number) => void } = {}
    ): Promise<boolean> => {
      const a = project.audio.find((x) => x.id === audioId);
      const src = a && sources[a.sourceId];
      if (!a || !src) return false;
      const duration = src.duration > 0 ? src.duration : a.offset + a.duration;
      setPlaying(false);
      setCleaningTrack(audioId);
      try {
        const { blob, gain } = await cleanAudio(sourceInput(src), 0, duration, { denoise: strength, level: false, repair, ...extra }, run.signal, run.onProgress);
        const file = new File([blob], `clean-${sourceName(src).replace(/.[^.]+$/, "")}.m4a`, { type: "audio/mp4" });
        const cleaned: MediaSource = {
          id: newId("snd"),
          kind: "audio",
          file,
          url: URL.createObjectURL(file),
          duration,
          width: 0,
          height: 0,
          fps: 0,
          hasAudio: true,
        };
        addSource(cleaned);
        const parts = project.audio.filter((x) => x.sourceId === a.sourceId).length;
        apply((p) => ({ ...p, audio: p.audio.map((x) => (x.sourceId === a.sourceId ? withCleanup(x, cleaned.id, strength, { ...(repair ? { repairGain: gain } : { gain }), ...extra }) : x)) }));
        const what = [
          strength > 0 && "background noise reduced",
          repair && "distortion repaired",
          extra.mouth && "mouth clicks removed",
          extra.wind && "wind and rumble cut",
          extra.echo && "echo reduced",
          extra.isolate && "background removed",
        ].filter(Boolean) as string[];
        const sentence = what.length ? what.join(", ").replace(/^./, (c) => c.toUpperCase()) : "Cleaned";
        say(`${sentence}${parts > 1 ? ` on all ${parts} parts of this track` : ""}. Switch to Original in the panel to compare; undo removes it.`);
        return true;
      } catch (e) {
        if ((e as Error)?.name === "AbortError") {
          say("Cleaning up was cancelled. Nothing was changed.");
          return false;
        }
        console.error("[editor] track noise reduction failed", e);
        say(e instanceof Error && e.message ? e.message : "This track's noise couldn't be reduced.");
        return false;
      } finally {
        setCleaningTrack(null);
      }
    },
    [project.audio, sources, apply, say, addSource]
  );

  /** Measures the whole mix's loudness (programMix.ts, loudness.ts) and
   * sets the master gain for `target`, one undo step. */
  const measureMix = useCallback(
    async (target: Exclude<LoudnessTarget, "off">): Promise<boolean> => {
      setPlaying(false);
      setMeasuring(true);
      try {
        const key = mixKey(project);
        const mix = await renderProgramMix(lay, project, sources);
        if (!mix.samples) {
          say("There's no sound on the timeline to measure.");
          return false;
        }
        const result = measureLoudness(mix.samples, ANALYSIS_RATE);
        const plan = normalizationGain(result, LOUDNESS_TARGETS[target].lufs);
        if (!plan) {
          say("The mix is silent, so there's nothing to bring up to a loudness. Check that the tracks aren't muted.");
          return false;
        }
        const round = (v: number) => Math.round(v * 10) / 10;
        apply((p) => ({
          ...p,
          master: { ...masterOf(p), loudness: target, gainDb: plan.gainDb, measured: { lufs: round(result.lufs), peakDb: round(result.peakDb), key } },
        }));
        if (mix.skipped.length) say(`Measured without ${mix.skipped.join(", ")}: ${mix.skipped.length === 1 ? "it couldn't" : "they couldn't"} be read here.`);
        return true;
      } catch (e) {
        console.error("[editor] loudness measurement failed", e);
        say("The mix couldn't be measured.");
        return false;
      } finally {
        setMeasuring(false);
      }
    },
    [lay, project, sources, apply, say]
  );

  /** An edit of a track's volume curve from the timeline (timeline
   * seconds) on its points (seconds of the file). A moved point stays
   * between its neighbors and inside the track. */
  const editCurve = useCallback(
    (audioId: string, edit: CurveEdit) =>
      apply((p) => {
        const a = p.audio.find((x) => x.id === audioId);
        if (!a) return p;
        const src = (t: number) => Math.min(a.offset + a.duration, Math.max(a.offset, a.offset + (t - a.start)));
        const pts = a.envelope ?? [];
        let next: GainPoint[];
        // NaN: on the current curve ("Add point at playhead").
        if (edit.kind === "add") next = addPoint(pts, src(edit.t), Number.isFinite(edit.v) ? edit.v : undefined);
        else if (edit.kind === "remove") next = pts.filter((_, i) => i !== edit.index);
        else {
          const lo = edit.index > 0 ? pts[edit.index - 1].t + 0.01 : 0;
          const hi = edit.index < pts.length - 1 ? pts[edit.index + 1].t - 0.01 : Infinity;
          next = pts.map((q, i) => (i === edit.index ? { t: Math.min(hi, Math.max(lo, src(edit.t))), v: edit.v } : q));
        }
        next = normalizePoints(next);
        return updateAudio(p, audioId, { envelope: next.length ? next : undefined });
      }),
    [apply]
  );

  /** A track's tone, set on every part of its file (a microphone split by
   * cuts keeps one sound), like noise reduction. */
  const setTrackTone = useCallback(
    (audioId: string, tone: VoiceTone | undefined) =>
      apply((p) => {
        const a = p.audio.find((x) => x.id === audioId);
        if (!a) return p;
        return { ...p, audio: p.audio.map((x) => (x.sourceId === a.sourceId ? { ...x, tone } : x)) };
      }),
    [apply]
  );

  // Enhance voice measures the loudness once its tone and noise reduction
  // are in the project (measureMix reads the rendered project).
  const [measureNext, setMeasureNext] = useState<{ target: Exclude<LoudnessTarget, "off">; denoised: boolean | null } | null>(null);
  const [enhancing, setEnhancing] = useState<string | null>(null);
  useEffect(() => {
    if (!measureNext || measuring) return;
    const { target, denoised } = measureNext;
    setMeasureNext(null);
    void measureMix(target).then((ok) => {
      const noise = denoised === true ? ", less background noise" : denoised === false ? " (the noise couldn't be reduced)" : "";
      say(`Voice enhanced: clearer tone${noise}${ok ? ` and the mix at ${LOUDNESS_TARGETS[target].lufs} LUFS` : ""}. Undo takes it back one step at a time.`);
    });
  }, [measureNext, measuring, measureMix, say]);

  /** Enhance voice: the "clear" tone preset, then (desktop app) medium
   * noise reduction unless the track already has some, then the mix's
   * loudness measured again - for voice (-16 LUFS) unless another target
   * is already chosen. */
  const enhanceVoice = useCallback(
    async (audioId: string) => {
      const a = project.audio.find((x) => x.id === audioId);
      if (!a || enhancing) return;
      setEnhancing(audioId);
      try {
        setTrackTone(audioId, presetTone("clear"));
        // null: not tried (browser version, or already cleaned).
        // With the clipping repair: it only redraws flattened peaks (a clean
        // recording comes out the same), so it costs nothing to include.
        const denoised = IS_DESKTOP && !a.clean ? await cleanTrack(audioId, 0.5, true) : null;
        const current = masterOf(project).loudness;
        setMeasureNext({ target: current === "off" ? "voice" : current, denoised });
      } finally {
        setEnhancing(null);
      }
    },
    [project, enhancing, setTrackTone, cleanTrack]
  );

  /** Places a video layer as a webcam (webcamLayout.ts); null frees it.
   * A side-by-side layout moves the screen clips too, and leaving one puts
   * them back to full size. */
  const setCamLayout = useCallback(
    (id: string, l: CamLayout | null) =>
      apply((p) => {
        const o = p.overlays.find((x) => x.id === id);
        if (!o || o.kind !== "video") return p;
        const src = sources[o.sourceId];
        const aspect = canvasSize.width / Math.max(1, canvasSize.height);
        const camAspect = src && src.height > 0 ? src.width / src.height : 16 / 9;
        const wasSplit = !!o.camLayout?.split;
        if (!l) {
          const { camLayout: _drop, ...free } = o;
          void _drop;
          return { ...p, clips: wasSplit ? screenForLayout(p.clips, null) : p.clips, overlays: p.overlays.map((x) => (x.id === id ? free : x)) };
        }
        const screen = screenAspectOf(p, sources);
        const placement = placeWebcam(l, aspect, camAspect, screen);
        const clips = placement.screen || wasSplit ? screenForLayout(p.clips, placement) : p.clips;
        return { ...p, clips, overlays: p.overlays.map((x) => (x.id === id ? applyCamLayout(o, l, aspect, camAspect, screen) : x)) };
      }),
    [apply, sources, canvasSize]
  );

  // Webcam layouts follow canvas size changes. Not its own undo step: undoing
  // the canvas change brings back the layout that went with it.
  useEffect(() => {
    apply((p) => relayoutWebcams(p, sources, canvasSize.width / Math.max(1, canvasSize.height)), false);
  }, [apply, sources, canvasSize]);

  const solo = useMemo(() => liveSolo(soloRaw, project), [soloRaw, project]);
  const onSolo = useCallback((key: string) => setSolo((s) => toggleSolo(s, key)), []);

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
      if (kind === "group") {
        setCaptionsGrouped((g) => !g);
        return;
      }
      if (kind === "magnet") {
        const on = !masterOf(project).magnetic;
        apply((p) => ({ ...p, master: { ...masterOf(p), magnetic: on } }));
        say(on ? "Magnetic audio on: parts from one file now sit back to back, and deleting or trimming one slides the rest. Undo puts them back." : "Magnetic audio off: parts move freely.");
        return;
      }
      if (kind === "smooth") {
        const on = !smoothCutsOn(project);
        apply((p) => ({ ...p, master: { ...masterOf(p), smoothCuts: on } }));
        say(on ? "Smooth cuts on: every audio part fades in and out over 20 ms, so cuts don't click." : "Smooth cuts off: audio parts start and stop exactly at their cuts.");
        return;
      }
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
    [apply, project, say]
  );

  /** Row-header delete: removes every item on a track (one undo step).
   * Locked layers stay. */
  const onTrackDelete = useCallback(
    (track: string) => {
      const mine = (o: Overlay) => (track === "text" ? o.kind === "text" : o.kind !== "text");
      const layers = track === "text" || track === "elements";
      const kept = layers ? project.overlays.filter((o) => mine(o) && o.locked).length : 0;
      apply((p) => {
        if (layers) return { ...p, overlays: p.overlays.filter((o) => !mine(o) || o.locked) };
        if (track === "audio") return { ...p, audio: [] };
        if (track === "effects") return { ...p, effects: [] };
        if (track === "zoom") return { ...p, zooms: [] };
        if (track === "chapters") return { ...p, chapters: [] };
        if (track === "privacy") return { ...p, masks: [] };
        return p;
      });
      setSelection(null);
      say(`Track deleted${kept ? `; ${kept} locked layer${kept === 1 ? "" : "s"} kept` : ""}. Undo with ${modKey()}+Z.`);
    },
    [apply, say, project.overlays]
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
      } else if (id === CAPTION_GROUP) {
        // Dragging the combined block moves every caption together; its
        // edges aren't trimmed (edit single captions in the panel).
        if (mode !== "move") return;
        apply((p) => {
          const caps = p.overlays.filter((o) => o.caption && !o.locked);
          if (!caps.length) return p;
          const from = Math.min(...caps.map((o) => o.start));
          const delta = Math.max(-from, start - from);
          if (Math.abs(delta) < 1e-4) return p;
          return { ...p, overlays: p.overlays.map((o) => (o.caption && !o.locked ? { ...o, start: o.start + delta, end: o.end + delta } : o)) };
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
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const tutorial = useTutorialTools({
    onOpenCleanup: () => setCleanupOpen(true),
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
  // --- Clean up audio (CleanupDialog, cleanupPlan.ts) ------------------------
  // In stages, each on the project the last one left: the sound fixes and
  // the tone (cleaned copies are added to the project), then the edits
  // (Review's analysis of the new sound: breaths and cuts, one undo step),
  // then the loudness of the result.
  const [cleanupBusy, setCleanupBusy] = useState<string | null>(null);
  type CleanupJob = { chosen: Set<CleanupOption>; cleaned: string[]; studio: boolean; edit: AutoCleanupResult | null };
  const [cleanupStage, setCleanupStage] = useState<{ stage: "edit" | "measure"; job: CleanupJob } | null>(null);
  const cleanupVoices = useMemo(() => voiceTracks(project.audio, sources), [project.audio, sources]);
  const cleanupCtrl = useRef<AbortController | null>(null);
  const [separatorModel, setSeparatorModel] = useState<{ ready: boolean; sizeMb: number } | null>(null);
  useEffect(() => {
    if (!cleanupOpen || !IS_DESKTOP) return;
    let live = true;
    void engineAudioModels().then((m) => live && setSeparatorModel(m?.separator ?? null));
    return () => {
      live = false;
    };
  }, [cleanupOpen]);
  const cancelCleanup = useCallback(() => {
    cleanupCtrl.current?.abort();
    cleanupCtrl.current = null;
    setCleanupStage(null);
    setCleanupBusy(null);
  }, []);

  const finishCleanup = useCallback(
    (job: CleanupJob, lufs: number | null) => {
      setCleanupBusy(null);
      setCleanupOpen(false);
      say(cleanupSummary({ cleaned: job.cleaned, studio: job.studio, lufs, edit: job.edit }));
    },
    [say]
  );

  const runCleanup = useCallback(
    async (chosen: Set<CleanupOption>, echo: number) => {
      setPlaying(false);
      const job: CleanupJob = { chosen, cleaned: [], studio: false, edit: null };
      const ctrl = new AbortController();
      cleanupCtrl.current = ctrl;
      // One copy per file (a microphone split by cuts is one file).
      const files = [...new Map(cleanupVoices.map((a) => [a.sourceId, a])).values()];
      const engineFix =
        IS_DESKTOP && ["noise", "clipping", "mouth", "wind", "echo", "background"].some((k) => chosen.has(k as CleanupOption));
      if (engineFix) {
        const STAGE: Record<CleanStage, string> = { download: "Downloading the voice separation model", separate: "Removing background audio", echo: "Removing echo" };
        for (const [i, a] of files.entries()) {
          const of = files.length > 1 ? ` (${i + 1} of ${files.length})` : "";
          setCleanupBusy(`Cleaning the sound${of}…`);
          const ok = await cleanTrack(
            a.id,
            chosen.has("noise") ? 0.5 : 0,
            chosen.has("clipping"),
            { wind: chosen.has("wind"), mouth: chosen.has("mouth"), echo: chosen.has("echo") ? echo : 0, isolate: chosen.has("background") },
            { signal: ctrl.signal, onProgress: (stage, v) => setCleanupBusy(`${STAGE[stage]}${of}… ${Math.round(v * 100)}%`) }
          );
          if (!ok || ctrl.signal.aborted) {
            setCleanupBusy(null);
            return;
          }
        }
        job.cleaned = [
          chosen.has("background") && "background audio removed",
          chosen.has("noise") && "noise removed",
          chosen.has("echo") && "echo reduced",
          chosen.has("clipping") && "clipping fixed",
          chosen.has("mouth") && "mouth sounds removed",
          chosen.has("wind") && "wind noise removed",
        ].filter(Boolean) as string[];
      }
      if (ctrl.signal.aborted) return;
      if (chosen.has("studio") && files.length) {
        for (const a of files) setTrackTone(a.id, presetTone("clear"));
        job.studio = true;
      }
      const edits = ["breaths", "silences", "hesitations", "fillers", "stutters"].some((k) => chosen.has(k as CleanupOption));
      if (edits) setCleanupStage({ stage: "edit", job });
      else if (chosen.has("normalize")) setCleanupStage({ stage: "measure", job });
      else finishCleanup(job, null);
    },
    [cleanupVoices, cleanTrack, setTrackTone, finishCleanup]
  );

  // The next stage runs once the last one's changes are in the project.
  const cleanupRunning = useRef(false);
  useEffect(() => {
    if (!cleanupStage || cleanupRunning.current || cleaningTrack || measuring) return;
    const { stage, job } = cleanupStage;
    cleanupRunning.current = true;
    setCleanupStage(null);
    void (async () => {
      try {
        if (stage === "edit") {
          setCleanupBusy("Finding silences, hesitations and breaths…");
          job.edit = await tutorial.autoCleanup(autoCleanupOptions(job.chosen));
          if (job.chosen.has("normalize")) setCleanupStage({ stage: "measure", job });
          else finishCleanup(job, null);
        } else {
          setCleanupBusy("Setting the loudness…");
          const current = masterOf(project).loudness;
          const target = current === "off" ? "voice" : current;
          const ok = await measureMix(target);
          finishCleanup(job, ok ? LOUDNESS_TARGETS[target].lufs : null);
        }
      } catch (e) {
        console.error("[editor] clean up audio failed", e);
        setCleanupBusy(null);
        say("Cleaning up the audio stopped part way. What was done so far can be undone.");
      } finally {
        cleanupRunning.current = false;
      }
    })();
  }, [cleanupStage, cleaningTrack, measuring, tutorial, project, measureMix, finishCleanup, say]);

  const highlights = useHighlights({
    project,
    lay,
    sources,
    recSource,
    clock,
    apply,
    say,
    setPlaying,
    openExport: (clip) => setDialog({ kind: "export", clip }),
    openBatchExport: (items, vertical) => setDialog({ kind: "batch", items, vertical }),
  });
  /** A highlight's copy in another shape for a batch export: the vertical or
   * square creator preset, reframed from the activity in that copy's own
   * clips (and shown whole where it's spread too wide). */
  const reframeCopy = (copy: Project, format: BatchFormat): { project: Project; notes: string[] } => {
    if (format === "project" || !originalId) return { project: copy, notes: [] };
    const copyLay = layout(copy, lay.fps);
    const events = recordingEvents(recSource);
    const acts = recSource && events ? interactionTimeline(copyLay, recSource.id, events) : null;
    return applyCreatorPreset(copy, format === "vertical" ? "vertical" : "square", {
      lay: copyLay,
      sources,
      originalId,
      acts,
      recSourceId: recSource?.id ?? null,
      cursorCaptured: recSource?.recording?.manifest.capture.cursorCaptured !== false,
      keystrokes: [],
    });
  };
  /** Canvas > Made for: a creator preset as one undo step (creatorPresets.ts). */
  const applyPreset = (id: CreatorPresetId) => {
    if (!originalId) return;
    const events = recordingEvents(recSource);
    const acts = recSource && events ? interactionTimeline(lay, recSource.id, events) : null;
    const isMac = recSource?.recording?.manifest.app?.platform === "macos";
    const keystrokes = id === "tutorial" && acts ? keystrokeOverlays(acts, DEFAULT_KEYSTROKES, lay.total, isMac, () => newId("key")) : [];
    let notes: string[] = [];
    apply((p) => {
      const r = applyCreatorPreset(p, id, {
        lay,
        sources,
        originalId,
        acts,
        recSourceId: recSource?.id ?? null,
        cursorCaptured: recSource?.recording?.manifest.capture.cursorCaptured !== false,
        keystrokes,
      });
      notes = r.notes;
      return r.project;
    });
    const label = CREATOR_PRESETS.find((x) => x.id === id)?.label ?? id;
    say([`${label} preset applied.`, ...notes].join(" "));
  };
  // "Preview the result": while playing, jump over the pending cuts.
  const skipRanges = tutorial.skipRanges;
  useEffect(() => {
    if (!playing || !skipRanges.length) return;
    return clock.subscribe(() => {
      const t = clock.get();
      const to = skipTarget(skipRanges, t);
      if (to !== t) clock.set(Math.min(to, lay.total));
    });
  }, [playing, skipRanges, clock, lay.total]);
  // Per language: the desktop engine has models of their own for some, so a
  // check for another language reads as "still checking".
  const [modelCheck, setModelCheck] = useState<{ language: string; cached: boolean } | null>(null);
  const modelCached = modelCheck?.language === captionOpts.language ? modelCheck.cached : null;
  const captionItems = useMemo(
    () =>
      project.overlays
        .filter((o): o is Extract<Overlay, { kind: "text" }> => o.kind === "text" && !!o.caption)
        .map((o) => ({ id: o.id, start: o.start, end: o.end, text: o.text.content }))
        .sort((a, b) => a.start - b.start),
    [project.overlays]
  );
  const [captionModel, setCaptionModel] = useState<SpeechModel | null>(null);
  useEffect(() => {
    if (tool !== "captions" && tool !== "transcript") return;
    let cancelled = false;
    const language = captionOpts.language;
    void speechModel(language).then((m) => !cancelled && setCaptionModel(m));
    void speechModelCached(language).then((cached) => !cancelled && setModelCheck({ language, cached }));
    return () => {
      cancelled = true;
    };
  }, [tool, captionOpts.language]);
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
  const projectFocus = project.focus;

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
          { events: eventsForSuggestions(events, recSource.id, focusPrefs({ focus: projectFocus })), duration: recSource.duration, aspect: recSource.width / Math.max(1, recSource.height), sourceId: recSource.id },
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
    [recSource, projectFocus, apply, say]
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

  /** Source time under the playhead, on the recorded source. */
  const recordedTimeAtPlayhead = useCallback((): number | null => {
    const loc = locate(lay, clock.get());
    const laid = loc ? lay.clips[loc.primary.index] : undefined;
    if (!laid || !recSource || laid.clip.sourceId !== recSource.id || laid.clip.freeze !== null) return null;
    return sourceTimeOf(laid, clock.get());
  }, [clock, lay, recSource]);

  /** No zoom suggestions from the playhead for `seconds` (or over a
   * zoom's range); unedited suggestions there are removed. One undo step. */
  const excludeFocusRange = useCallback(
    (range?: { start: number; end: number }) => {
      const s = range ? null : recordedTimeAtPlayhead();
      if (!recSource || (!range && s === null)) {
        say("Move the playhead onto the recording first.");
        return;
      }
      const start = range?.start ?? s!;
      const end = range?.end ?? Math.min(recSource.duration, s! + 10);
      apply((p) => excludeRange(p, { id: newId("fx"), sourceId: recSource.id, start, end }));
    },
    [recSource, recordedTimeAtPlayhead, apply, say]
  );

  /** Ignores the recorded click nearest the playhead (within 0.5 s). */
  const ignoreClickAtPlayhead = useCallback(() => {
    const s = recordedTimeAtPlayhead();
    const near = s === null || !rawPointer ? undefined : rawPointer.clicks.reduce<{ t: number; d: number } | undefined>((best, c) => {
      const d = Math.abs(c.t - s);
      return d <= 0.5 && (!best || d < best.d) ? { t: c.t, d } : best;
    }, undefined);
    if (!near || !recSource) {
      say("No recorded click within half a second of the playhead.");
      return;
    }
    apply((p) => setClickIgnored(p, recSource.id, near.t, true));
  }, [recordedTimeAtPlayhead, rawPointer, recSource, apply, say]);

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
    setSelection({ kind: "transition", clipId: lay.clips[best].clip.id });
    setTool("transition");
  }, [lay, clock, say]);

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
    <header className="relative z-[60] flex items-center gap-2 border-b border-border bg-surface/80 px-3 py-2 backdrop-blur sm:gap-3 sm:px-4">
      <Link href="/" className="inline-flex shrink-0 items-center" aria-label="WipeClip home">
        <Logo size={28} textSize="text-base" />
      </Link>
      <span className="hidden rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[11px] font-bold text-accent sm:inline dark:text-accent-light">
        Editor
      </span>
      {phase === "edit" && (
        <ToolButton label="Back to projects (this one is saved)" onClick={closeProject} text="Projects">
          <ChevronLeftIcon />
        </ToolButton>
      )}
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
            <ToolButton label={`Undo (${keys.mod}+Z)`} onClick={undo} disabled={!canUndo}>
              <UndoIcon />
            </ToolButton>
            <ToolButton label={`Redo (${keys.mod}+Shift+Z)`} onClick={redo} disabled={!canRedo}>
              <RedoIcon />
            </ToolButton>
          </>
        )}
        <MoreMenu
          items={[
            ...(phase === "edit"
              ? [
                  { label: "Projects", hint: "Back to your projects. This one is saved.", onClick: closeProject },
                  { label: "Save file", hint: "Save this project, with its videos, as one .wipeclip file", onClick: saveProjectFile },
                ]
              : []),
            ...(onRecord
              ? [
                  {
                    label: "Record screen",
                    onClick: () => {
                      setPlaying(false);
                      onRecord();
                    },
                  },
                ]
              : []),
            ...(onImageTools
              ? [
                  {
                    label: "Image tools",
                    onClick: () => {
                      setPlaying(false);
                      onImageTools();
                    },
                  },
                ]
              : []),
          ]}
        />
        <div className="hidden sm:block">
          <AuthStatus />
        </div>
        {phase === "edit" && (
          <button
            type="button"
            onClick={async () => {
              setPlaying(false);
              // Privacy suggestions nobody looked at: not hidden in the export, so ask.
              const d = project.draft;
              const unreviewed = d && !d.appliedAt ? d.items.filter((i) => i.kind === "privacy" && i.status === "pending").length : 0;
              if (
                unreviewed &&
                !(await confirmAction(
                  `${unreviewed} possible sensitive spot${unreviewed === 1 ? " hasn't" : "s haven't"} been reviewed in the Draft, so ${unreviewed === 1 ? "it isn't" : "they aren't"} hidden in this export. Export anyway?`,
                  { okLabel: "Export anyway" }
                ))
              )
                return;
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
    const caps = layers.filter((o) => o.caption);
    const grouped = captionsGrouped && caps.length > 1;
    const block: TimelineTrack["items"] = grouped
      ? [
          {
            id: CAPTION_GROUP,
            start: Math.min(...caps.map((o) => o.start)),
            end: Math.max(...caps.map((o) => o.end)),
            label: `Captions · ${caps.length}`,
            glyph: "CC",
            hidden: caps.every((o) => o.hidden),
            locked: caps.every((o) => o.locked),
            selected: tool === "captions",
            sel: { kind: "overlay" as const, id: CAPTION_GROUP },
          },
        ]
      : [];
    return {
      key: "text",
      label: "Text",
      tone: "border-sky-500/40 bg-sky-500/20",
      toggles: [...layerToggles(layers), ...(caps.length > 1 ? [{ kind: "group" as const, on: captionsGrouped }] : [])],
      deletable: true,
      items: [
        ...block,
        ...(grouped ? layers.filter((o) => !o.caption) : layers).map(
          (o): TimelineTrack["items"][number] => ({
            id: o.id,
            start: o.start,
            end: o.end,
            label: o.kind === "text" ? o.text.content.split("\n")[0] || "Text" : "",
            glyph: "T",
            hidden: o.hidden,
            locked: o.locked,
            selected: selIs(selection, "overlay", o.id),
            sel: { kind: "overlay", id: o.id },
          })
        ),
      ],
    };
  }, [project.overlays, selection, captionsGrouped, tool]);
  const elementsTrack = useMemo<TimelineTrack>(() => {
    const layers = project.overlays.filter((o) => o.kind !== "text");
    return {
      key: "elements",
      label: "Elements",
      tone: "border-accent/40 bg-accent/20",
      toggles: layerToggles(layers),
      deletable: true,
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
      toggles: [
        { kind: "mute", on: project.audio.length > 0 && project.audio.every((a) => a.muted) },
        { kind: "magnet", on: !!project.master?.magnetic },
        { kind: "smooth", on: smoothCutsOn({ master: project.master }) },
      ],
      deletable: true,
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
        curve: visibleCurve(a),
        selected: selIs(selection, "audio", a.id),
        sel: { kind: "audio" as const, id: a.id },
      })),
    }),
    [project.audio, project.master, selection]
  );
  const layClips = lay.clips;
  const zoomTrack = useMemo<TimelineTrack | null>(() => {
    if (!anyRecording && !zooms.length) return null;
    // Recorded clicks as ticks behind the zooms.
    const ticks: NonNullable<TimelineTrack["ticks"]> = [];
    if (rawPointer && recSource) {
      for (const c of layClips) {
        if (c.clip.sourceId !== recSource.id) continue;
        const prefs = focusPrefs({ focus: projectFocus });
        for (const k of rawPointer.clicks) {
          const t = timelineTimeOf(c, k.t);
          if (t === null || ticks.length >= 3000) continue;
          const ignored = isClickIgnored(prefs, recSource.id, k.t);
          ticks.push({
            t,
            className: ignored ? "bg-muted/40" : k.button === "left" ? "bg-cyan-400/80" : "bg-amber-400/80",
            title: ignored ? `${k.button} click (ignored)` : `${k.button} click`,
          });
        }
      }
    }
    return {
      key: "zoom",
      label: "Zoom",
      tone: "border-violet-500/40 bg-violet-500/20",
      deletable: true,
      items: zooms.flatMap((z) =>
        zoomSpans(layClips, z).map((sp) => ({
          id: `${z.id}#${sp.clipIndex}`,
          start: sp.start,
          end: sp.end,
          label: `${z.zoom.toFixed(1)}× ${z.reason ?? "Zoom"}`,
          glyph: "⌕",
          hidden: !z.enabled || !!projectFocus?.bypass,
          selected: selIs(selection, "zoom", z.id),
          sel: { kind: "zoom" as const, id: z.id },
        }))
      ),
      ticks,
    };
  }, [anyRecording, zooms, rawPointer, recSource, layClips, selection, projectFocus]);
  const effectsTrack = useMemo<TimelineTrack>(
    () => ({
      key: "effects",
      label: "Effects",
      tone: "border-amber-500/40 bg-amber-500/20",
      deletable: true,
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
                        {IS_DESKTOP ? "MP4, MOV, WebM · any size and length, edited where it is · free plan exports up to 10 minutes" : "MP4, MOV, WebM · up to 300MB · up to 10 minutes"}
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
            {IS_DESKTOP && (
              <p className="mt-1 text-center text-xs text-muted">
                <AppVersion />
              </p>
            )}
          </div>
        </main>
      </div>
    );
  }

  // --- panel (right side / bottom sheet on mobile) -------------------------------
  const lookClip = selectedClip?.clip;
  let toolPanel: React.ReactNode = null;
  if ((tool === "filters" || tool === "adjust") && lookClip) {
    toolPanel = (
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
    toolPanel = <TextAddPanel onAdd={addText} onClose={() => setTool(null)} />;
  } else if (tool === "elements") {
    toolPanel = (
      <ElementsPanel
        onAddSticker={addSticker}
        onUploadImage={(f) => void uploadImage(f)}
        onUploadVideo={(f) => void uploadVideoLayer(f)}
        onClose={() => setTool(null)}
      />
    );
  } else if (tool === "audio") {
    toolPanel = (
      <AudioAddPanel
        mixer={
          <MixerPanel
            project={project}
            solo={solo}
            onSolo={onSolo}
            onMaster={(patch: Partial<MasterAudio>) => apply((p) => ({ ...p, master: { ...masterOf(p), ...patch } }))}
            onTrack={(id, patch) => apply((p) => updateAudio(p, id, patch))}
            onMeasure={(target) => void measureMix(target)}
            measuring={measuring}
            gesture={gesture}
          />
        }
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
    toolPanel = <EffectsAddPanel onAdd={addEffect} onClose={() => setTool(null)} premiumLocked={premiumLocked} />;
  } else if (tool === "canvas") {
    toolPanel = (
      <CanvasPanel
        canvas={project.canvas}
        onChange={(canvas) => apply((p) => ({ ...p, canvas }))}
        onUploadBackground={(f) => void uploadBackground(f)}
        onClose={() => setTool(null)}
        gesture={gesture}
        onPreset={originalId ? applyPreset : undefined}
      />
    );
  } else if (tool === "transcript") {
    toolPanel = (
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
        onCancel={cancelTranscription}
        modelCached={modelCached}
        model={captionModel}
        onDelete={cutByWords}
        dub={
          IS_DESKTOP && project.transcript && DUB_FROM.has(project.transcript.language)
            ? { models: dubModels, busy: dubbing, onStart: () => void runDub(), onCancel: () => dubAbort.current?.abort() }
            : null
        }
        onClose={() => setTool(null)}
      />
    );
  } else if (tool === "captions") {
    toolPanel = (
      <CaptionsPanel
        options={captionOpts}
        onOptions={setCaptionOpts}
        count={project.overlays.filter((o) => o.caption).length}
        busy={captioning}
        onGenerate={() => void runCaptions()}
        onCancel={cancelTranscription}
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
        onExport={(f) => void exportCaptions(f)}
        captions={captionItems}
        total={lay.total}
        gesture={gesture}
        onSeek={(t) => {
          setPlaying(false);
          seek(t + 0.01);
        }}
        onEditCaption={(id, patch) =>
          apply((p) => {
            // Typed text follows the captions' letter case (Style).
            const upper = captionUpper(captionOpts.style, captionOpts.look);
            const fixed = patch.text !== undefined && upper ? { ...patch, text: patch.text.toUpperCase() } : patch;
            return { ...p, overlays: p.overlays.map((o) => (o.id === id && o.kind === "text" && o.caption ? editCaption(o, fixed) : o)) };
          })
        }
        onDeleteCaption={(id) => {
          apply((p) => ({ ...p, overlays: p.overlays.filter((o) => o.id !== id) }));
          if (selection?.kind === "overlay" && selection.id === id) setSelection(null);
        }}
        onMergeNext={(id) =>
          apply((p) => {
            const caps = p.overlays
              .filter((o): o is Extract<Overlay, { kind: "text" }> => o.kind === "text" && !!o.caption)
              .sort((a, b) => a.start - b.start);
            const i = caps.findIndex((o) => o.id === id);
            const next = caps[i + 1];
            if (i < 0 || !next) return p;
            const merged = mergeCaptions(caps[i], next, lineCharsFor(canvasSize));
            return { ...p, overlays: p.overlays.filter((o) => o.id !== next.id).map((o) => (o.id === id ? merged : o)) };
          })
        }
        onReplaceAll={(find, raw, matchCase) => {
          const replace = captionUpper(captionOpts.style, captionOpts.look) ? raw.toUpperCase() : raw;
          const res = replaceInCaptions(project.overlays, find, replace, matchCase);
          if (res.changed) apply((p) => ({ ...p, overlays: replaceInCaptions(p.overlays, find, replace, matchCase).overlays }));
          return res.changed;
        }}
      />
    );
  } else if (tool === "focus") {
    toolPanel = (
      <FocusPanel
        available={!!recSource}
        unavailableReason={
          anyRecording
            ? "This recording has no mouse events that can be placed on the video (a single window was recorded, the display couldn't be identified, or mouse recording was off). You can still add zooms by hand."
            : "Automatic zoom uses the mouse activity saved with screen recordings made in WipeClip's recorder. For this video you can add zooms by hand."
        }
        clickCount={rawPointer?.clicks.length ?? 0}
        cursorAllowed={recSource?.recording?.manifest.capture.cursorCaptured === false}
        nativeCursorSize={nativeCursorSize(recSource?.recording?.manifest.capture)}
        zooms={zooms}
        pointer={project.pointer ?? null}
        analysis={analysis}
        onAnalyze={(s) => void runAnalysis(s)}
        onCancel={() => analysisCtrl.current?.abort()}
        onRemoveSuggestions={() => apply((p) => ({ ...p, zooms: (p.zooms ?? []).filter((z) => !z.auto) }))}
        onAddAtPlayhead={addZoomAtPlayhead}
        onSelect={selectZoom}
        onPointerChange={(pointer) => apply((p) => ({ ...p, pointer }))}
        focus={focusPrefs(project)}
        onFocusChange={(patch) => apply((p) => patchFocusPrefs(p, patch))}
        comparing={comparingZooms}
        onCompare={setComparingZooms}
        onExcludeAtPlayhead={() => excludeFocusRange()}
        onRemoveExclusion={(id) => apply((p) => removeExclusion(p, id))}
        onIgnoreClickAtPlayhead={ignoreClickAtPlayhead}
        onRestoreClick={(t) => recSource && apply((p) => setClickIgnored(p, recSource.id, t, false))}
        onSeek={(s) => {
          const at = recSource ? lay.clips.filter((c) => c.clip.sourceId === recSource.id).map((c) => timelineTimeOf(c, s)).find((v) => v !== null) : null;
          if (at != null) seek(at);
          else say("That part of the recording isn't on the timeline.");
        }}
        onClose={() => setTool(null)}
        gesture={gesture}
      />
    );
  } else if (tool === "layers") {
    toolPanel = (
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
  } else if (tool === "transition" && selectedTransition >= 0 && selectedTransition < lay.clips.length - 1) {
    const laid = lay.clips[selectedTransition];
    toolPanel = (
      <TransitionPanel
        laid={laid}
        next={lay.clips[selectedTransition + 1]}
        onChange={(transition) => apply((p) => updateClip(p, laid.clip.id, { transition }))}
        onClose={() => setTool(null)}
        premiumLocked={premiumLocked}
      />
    );
  } else if (tool === "highlights") {
    toolPanel = <HighlightsPanel {...highlights} onClose={() => setTool(null)} />;
  } else if (tool === "tutorial") {
    toolPanel = <TutorialPanel {...tutorial.panelProps} />;
  }

  let selPanel: React.ReactNode;
  if (selection?.kind === "chapter" && tool !== "tutorial") {
    selPanel = <TutorialPanel {...tutorial.panelProps} />;
  } else if (selectedMask) {
    selPanel = (
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
    selPanel = (
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
        onNeverHere={() => {
          const z = selectedZoom;
          apply((p) => excludeRange({ ...p, zooms: removeZoom(p.zooms ?? [], z.id) }, { id: newId("fx"), sourceId: z.sourceId, start: z.start, end: z.end }));
          setSelection(null);
        }}
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
    selPanel = (
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
        extra={(section) => (
          <ClipExtras
            section={section}
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
        )}
      />
    );
  } else if (selectedTransition >= 0 && selectedTransition < lay.clips.length - 1 && tool !== "transition") {
    const laid = lay.clips[selectedTransition];
    selPanel = (
      <TransitionPanel
        laid={laid}
        next={lay.clips[selectedTransition + 1]}
        onChange={(transition) => apply((p) => updateClip(p, laid.clip.id, { transition }))}
        onClose={() => setSelection(null)}
        premiumLocked={premiumLocked}
      />
    );
  } else if (selectedOverlay) {
    selPanel = (
      <OverlayPanel
        overlay={selectedOverlay}
        total={lay.total}
        sourceDuration={selectedOverlay.kind === "video" ? sources[selectedOverlay.sourceId]?.duration : undefined}
        onChange={(patch) => changeOverlay(selectedOverlay.id, patch)}
        onCamLayout={selectedOverlay.kind === "video" ? (l) => setCamLayout(selectedOverlay.id, l) : undefined}
        background={
          selectedOverlay.kind === "video"
            ? {
                unsupported: matteUnsupported(selectedLayerSrc, IS_DESKTOP),
                job: selectedMatteJob,
                bgSource: selectedOverlay.matte?.bgSourceId ? (sources[selectedOverlay.matte.bgSourceId] ?? null) : null,
                onPickImage: () => {
                  matteBgFor.current = selectedOverlay.id;
                  matteBgInput.current?.click();
                },
                onPickVideo: () => void pickMatteVideo(selectedOverlay.id),
                onRetry: () => {
                  if (selectedLayerSrc && selectedOverlay.matte) ensureMatte(selectedLayerSrc, selectedOverlay.matte.detail).catch(() => {});
                },
              }
            : undefined
        }
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
    selPanel = (
      <AudioPanel
        key={selectedAudio.id}
        clip={selectedAudio}
        soloed={solo.has(selectedAudio.id)}
        onSolo={() => onSolo(selectedAudio.id)}
        onCleanup={IS_DESKTOP ? (strength, repair) => void cleanTrack(selectedAudio.id, strength, repair) : undefined}
        cleaning={cleaningTrack === selectedAudio.id}
        sourceDuration={sources[selectedAudio.sourceId]?.duration ?? selectedAudio.offset + selectedAudio.duration}
        total={lay.total}
        onChange={(patch) => {
          const { tone, ...rest } = patch;
          if ("tone" in patch) setTrackTone(selectedAudio.id, tone);
          if (Object.keys(rest).length) apply((p) => updateAudio(p, selectedAudio.id, rest));
        }}
        onEnhance={() => void enhanceVoice(selectedAudio.id)}
        onOpenCleanup={() => setCleanupOpen(true)}
        onAddCurvePoint={() => editCurve(selectedAudio.id, { kind: "add", t: clock.get(), v: NaN })}
        enhancing={enhancing === selectedAudio.id || (cleaningTrack === selectedAudio.id && enhancing !== null) || measureNext !== null}
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
    selPanel = (
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
    selPanel = (
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
          Shortcuts: Space play/pause · S split · F freeze frame · T text · Delete remove · {keys.mod}+C / {keys.mod}+V copy/paste · {keys.mod}+D duplicate · ←/→ frame step (Shift:
          1s) · {keys.alt}+←/→ move clip · {keys.mod}+Z / {keys.mod}+Shift+Z undo/redo
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
            deletable: true,
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
            deletable: true,
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
  const openTab = (t: GroupTab["id"]) => {
    if (t === "transition") openTransition();
    else if (t === "filters" || t === "adjust") openLook(t);
    else setTool(t);
  };
  const tabsOf = (g: (typeof TOOL_GROUPS)[number]) => g.tabs.filter((x) => x.id !== "focus" || IS_DESKTOP || zooms.length > 0);
  const activeGroup = groupOf(tool);
  const rail = (
    <nav
      aria-label="Editing tools"
      className="flex shrink-0 gap-1 overflow-x-auto border-y border-border bg-surface/60 px-2 py-1.5 lg:flex-col lg:overflow-visible lg:border-y-0 lg:border-r lg:px-1.5 lg:py-2"
    >
      {TOOL_GROUPS.map((g) => {
        const active = activeGroup?.id === g.id;
        const Icon = g.icon;
        return (
          <button
            key={g.id}
            type="button"
            aria-pressed={active}
            title={g.tabs.map((x) => x.label).join(", ")}
            onClick={() => (active ? setTool(null) : openTab(tabsOf(g)[0].id))}
            className={`flex min-w-14 shrink-0 flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 text-[10px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 lg:w-16 lg:py-2 ${
              active ? "bg-accent/15 text-accent dark:text-accent-light" : "text-muted hover:bg-surface-3 hover:text-foreground"
            }`}
          >
            <Icon width={20} height={20} />
            {g.label}
          </button>
        );
      })}
    </nav>
  );
  const toolArea = toolPanel && activeGroup && (
    <div className="flex h-full min-h-0 flex-col">
      {tabsOf(activeGroup).length > 1 && (
        // Segmented control: tabs share the width, so the strip never scrolls.
        <div className="shrink-0 border-b border-border px-3 py-2">
          <div role="tablist" aria-label={activeGroup.label} className="flex gap-0.5 rounded-lg border border-border bg-surface-2/70 p-0.5">
            {tabsOf(activeGroup).map((x) => (
              <button
                key={x.id}
                type="button"
                role="tab"
                aria-selected={tool === x.id}
                title={x.hint}
                onClick={() => openTab(x.id)}
                className={`min-w-0 flex-1 truncate rounded-md px-1.5 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
                  tool === x.id ? "bg-surface-3 text-foreground shadow-sm ring-1 ring-border" : "text-muted hover:text-foreground"
                }`}
              >
                {x.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1">{toolPanel}</div>
    </div>
  );
  const editActions = (
    <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto" role="toolbar" aria-label="Clip actions">
      <ToolButton label="Split at playhead (S)" onClick={split} text="Split">
        <SplitIcon width={16} height={16} />
      </ToolButton>
      <ToolButton label="Freeze the frame at the playhead (F)" onClick={freezeFrame} text="Freeze">
        <FreezeIcon width={16} height={16} />
      </ToolButton>
      <ToolButton label="Trim the clip at the playhead" onClick={openTrim} text="Trim">
        <TrimIcon width={16} height={16} />
      </ToolButton>
      <ToolButton label="Delete selection (Delete)" onClick={deleteSelection} text="Delete">
        <TrashIcon width={16} height={16} />
      </ToolButton>
      {AI_CLEANUP_ENABLED && (
        <ToolButton label="AI Cleanup on the selected clip" onClick={openCleanup} text="AI Cleanup" accent>
          <SparkleIcon width={16} height={16} />
        </ToolButton>
      )}
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col bg-background lg:h-dvh">
      {header}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="hidden lg:flex">{rail}</div>
        {desktop && (toolArea || selPanel) && (
          <aside className="w-80 shrink-0 overflow-hidden border-r border-border bg-surface/50" aria-label={toolArea ? "Tool" : "Properties"}>
            <PremiumLocked.Provider value={premiumLocked}>{toolArea || selPanel}</PremiumLocked.Provider>
          </aside>
        )}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="h-[42dvh] min-h-[200px] p-3 lg:h-auto lg:min-h-0 lg:flex-1">
            <PreviewPlayer
              project={comparingZooms && tool === "focus" ? previewWithoutZooms(project) : project}
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
              solo={solo}
              meters={tool === "audio"}
            >
              {/* A webcam background image (matte.ts), picked from the layer panel. */}
              <input
                ref={matteBgInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  const layerId = matteBgFor.current;
                  e.target.value = "";
                  if (f && layerId) void importImage(f).then((src) => src && setMatteBg(layerId, src));
                }}
              />
              <OverlayLayer
                clock={clock}
                canvasSize={canvasSize}
                overlays={project.overlays}
                rasters={rasters}
                sources={sources}
                playback={{ playing, rate, volume, muted: muted || solo.size > 0 }}
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

          <div className="lg:hidden">{rail}</div>

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
              onTrackDelete={onTrackDelete}
              onCurveChange={(track, id, edit) => track === "audio" && editCurve(id, edit)}
              actions={editActions}
              onGestureStart={beginGesture}
              onGestureEnd={endGesture}
            />
          </div>
        </main>

        {!desktop && (
          <aside className="border-t border-border bg-surface/50" aria-label={toolArea ? "Tool" : "Properties"}>
            <PremiumLocked.Provider value={premiumLocked}>{toolArea || selPanel}</PremiumLocked.Provider>
          </aside>
        )}
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
      {cleanupOpen && (
        <CleanupDialog
          tracks={cleanupVoices.map((a) => a.label)}
          engine={IS_DESKTOP}
          hasTranscript={!!project.transcript && transcriptCurrent(project.transcript, lay)}
          busy={cleanupBusy}
          separator={separatorModel}
          onCancel={cancelCleanup}
          onRun={(chosen, echo) => void runCleanup(chosen, echo)}
          onClose={() => setCleanupOpen(false)}
        />
      )}
      {dialog?.kind === "export" && originalId && (
        <ExportDialog
          project={dialog.clip?.project ?? project}
          sources={sources}
          originalId={originalId}
          total={dialog.clip?.total ?? lay.total}
          title={dialog.clip?.title}
          nameSuffix={dialog.clip?.nameSuffix}
          isSignedIn={isSignedIn}
          tier={tier}
          initialResult={dialog.clip ? null : pendingExport}
          onClose={() => setDialog(null)}
          onSignIn={() => setShowSignIn(true)}
        />
      )}
      {dialog?.kind === "batch" && originalId && (
        <BatchExportDialog
          items={dialog.items}
          sources={sources}
          originalId={originalId}
          isSignedIn={isSignedIn}
          tier={tier}
          defaultFormat={dialog.vertical ? "vertical" : "project"}
          reframe={reframeCopy}
          onExported={(n) => apply((p) => (p.highlights ? { ...p, highlights: { ...p.highlights, stats: { ...p.highlights.stats, exported: p.highlights.stats.exported + n } } } : p), false)}
          onClose={() => setDialog(null)}
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

/** Header overflow menu: project and app actions that don't need to be
 * one click away, plus the theme switch. */
function MoreMenu({ items }: { items: { label: string; hint?: string; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <ToolButton label="More" onClick={() => setOpen((v) => !v)} active={open}>
        <MoreIcon />
      </ToolButton>
      {open && (
        <div role="menu" className="absolute right-0 top-11 z-[60] w-56 rounded-2xl border border-border bg-background/95 p-2 shadow-2xl backdrop-blur-xl">
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              type="button"
              title={it.hint}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              className="flex w-full rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
            >
              {it.label}
            </button>
          ))}
          <div className={`flex items-center justify-between px-3 py-1 text-sm text-foreground ${items.length ? "mt-1 border-t border-border pt-2" : ""}`}>
            Theme
            <ThemeToggle />
          </div>
        </div>
      )}
    </div>
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
  extra: (section: ClipSection) => React.ReactNode;
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
