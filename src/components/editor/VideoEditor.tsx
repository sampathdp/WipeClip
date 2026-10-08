"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AuthStatus from "@/components/AuthStatus";
import Logo from "@/components/Logo";
import SignInModal from "@/components/SignInModal";
import ThemeToggle from "@/components/ThemeToggle";
import { trackEvent, useToolView } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";
import { createClock, useClockTime, type Clock } from "@/lib/editor/clock";
import { takeHandedOffFile } from "@/lib/editor/handoff";
import { useProjectHistory } from "@/lib/editor/history";
import {
  generateThumbnails,
  generateWaveform,
  loadAudioMeta,
  loadVideoMeta,
  normalizeImage,
  type ThumbnailStrip,
  type Waveform,
} from "@/lib/editor/media";
import {
  clearLastExport,
  clearProject,
  loadLastExport,
  loadProject,
  saveProject,
  saveSource,
  type RestoredProject,
} from "@/lib/editor/projectStore";
import { useOverlayRasters } from "@/lib/editor/rasters";
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
} from "@/lib/editor/timeline";
import {
  DEFAULT_CANVAS,
  newClip,
  type AudioClip,
  type Clip,
  type EffectClip,
  type EffectType,
  type Look,
  type MediaSource,
  type Overlay,
  type Project,
  type Selection,
  type TextStyle,
} from "@/lib/editor/types";
import { ApiError, ContentBlockedError, probeVideo } from "@/lib/toolsApi";
import { TIER_LIMITS, toTier, type Tier } from "@/lib/entitlements";
import AiCleanupDialog from "./AiCleanupDialog";
import ExportDialog from "./ExportDialog";
import { ActionButton, ClipPanel, PanelShell, TransitionPanel } from "./Inspector";
import OverlayLayer from "./OverlayLayer";
import {
  AudioAddPanel,
  AudioPanel,
  CanvasPanel,
  ClipExtras,
  EFFECT_ICONS,
  EffectPanel,
  EffectsAddPanel,
  ElementsPanel,
  LayersPanel,
  LookPanel,
  OverlayPanel,
  TextAddPanel,
  type Gesture,
} from "./Panels";
import PreviewPlayer from "./PreviewPlayer";
import Timeline, { type ItemMode, type TimelineTrack } from "./Timeline";
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
  TransitionIcon,
  TrashIcon,
  TrimIcon,
  UndoIcon,
  UploadIcon,
  VolumeIcon,
} from "./icons";

const TOOL = "video_editor";
const MAX_BYTES = 300 * 1024 * 1024;
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const EMPTY: Project = { clips: [], overlays: [], audio: [], effects: [], canvas: DEFAULT_CANVAS };
const RATES = [0.5, 1, 1.5, 2];

type Tool = "text" | "elements" | "audio" | "effects" | "filters" | "adjust" | "canvas" | "layers";
type Dialogs = { kind: "cleanup"; clipId: string; frameTime: number } | { kind: "export" } | null;
type ClipboardItem = { kind: "overlay"; item: Overlay } | { kind: "audio"; item: AudioClip } | { kind: "effect"; item: EffectClip };

/** `children` is shown under the upload card until a video is loaded -
 * /editor passes its server-rendered landing content (EditorLanding) here.
 */
export default function VideoEditor({ children }: { children?: React.ReactNode }) {
  useToolView(TOOL);
  const clock = useMemo(() => createClock(), []);
  const { project, canUndo, canRedo, apply, beginGesture, endGesture, undo, redo, reset } = useProjectHistory(EMPTY);

  const [phase, setPhase] = useState<"loading" | "import" | "probing" | "edit">("loading");
  const [importError, setImportError] = useState<{ message: string; blocked?: boolean } | null>(null);
  const [resume, setResume] = useState<RestoredProject | null>(null);
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
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [signedInTier, setSignedInTier] = useState<Tier>("free");
  const [showSignIn, setShowSignIn] = useState(false);
  const [pendingExport, setPendingExport] = useState<Blob | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const thumbJobs = useRef(new Map<string, AbortController>()); // thumbnail + "wave:" jobs
  const waveQueue = useRef<Promise<void>>(Promise.resolve());
  const clipboard = useRef<ClipboardItem | null>(null);

  const original = originalId ? sources[originalId] : undefined;
  const lay = useMemo(() => layout(project, original?.fps ?? 30), [project, original?.fps]);
  const canvasSize = useMemo(
    () => (original ? canvasSizeOf(project.canvas.aspect, original.width, original.height) : { width: 16, height: 9 }),
    [project.canvas.aspect, original]
  );

  const say = useCallback((message: string) => setToast(message), []);
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
      fetch("/api/credits")
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

  // --- recovery -----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadProject(), loadLastExport()]).then(([saved, lastExport]) => {
      if (cancelled) return;
      setResume(saved);
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

  // Autosave the (small) project JSON; source files are saved once when added.
  useEffect(() => {
    if (phase !== "edit" || project.clips.length === 0) return;
    const t = setTimeout(() => void saveProject(project, Object.values(sources)), 800);
    return () => clearTimeout(t);
  }, [project, sources, phase]);

  // Thumbnails for every video source, generated once each in the background.
  useEffect(() => {
    for (const src of Object.values(sources)) {
      if (src.kind === "audio" || src.kind === "image" || thumbJobs.current.has(src.id)) continue;
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
        const wave = await generateWaveform(src.file, controller.signal);
        if (wave && !controller.signal.aborted) setWaves((w) => ({ ...w, [src.id]: wave }));
      });
    }
  }, [sources]);

  // --- project lifecycle ---------------------------------------------------
  const startProject = useCallback(
    (srcs: MediaSource[], next: Project) => {
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
      setPhase("edit");
    },
    [reset, clock]
  );

  const importFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      trackEvent("file_selected", { tool: TOOL });
      setImportError(null);
      if (!file.type.startsWith("video/")) {
        setImportError({ message: "Please choose a video file (MP4, MOV or WebM)." });
        return;
      }
      if (file.size > MAX_BYTES) {
        setImportError({ message: "That file is over the 300MB limit. Try a shorter or smaller video." });
        return;
      }
      setPhase("probing");
      const url = URL.createObjectURL(file);
      try {
        // Browser decode check (codec support, display size, exact
        // duration) and the server's own validation + content screening,
        // in parallel. The server check is the one that counts.
        const [meta, probe] = await Promise.all([loadVideoMeta(url), probeVideo(file)]);
        URL.revokeObjectURL(probe.previewUrl);
        const src: MediaSource = {
          id: newId("src"),
          kind: "original",
          file,
          url,
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
          fps: probe.info.fps > 0 && probe.info.fps <= 240 ? probe.info.fps : 30,
          hasAudio: probe.info.hasAudio ?? true,
        };
        await clearProject();
        await clearLastExport();
        setPendingExport(null);
        setResume(null);
        startProject([src], { ...EMPTY, clips: [newClip(newId("clip"), src.id, 0, meta.duration)] });
        void saveSource(src);
      } catch (e) {
        URL.revokeObjectURL(url);
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
        setPhase("import");
      }
    },
    [startProject]
  );

  // A file handed over from the homepage tool ("Edit this video") opens
  // straight into a new project once recovery has been checked.
  const handOffChecked = useRef(false);
  useEffect(() => {
    if (phase !== "import" || handOffChecked.current) return;
    handOffChecked.current = true;
    const file = takeHandedOffFile();
    if (file) queueMicrotask(() => void importFile(file));
  }, [phase, importFile]);

  const resumeProject = useCallback(() => {
    if (!resume) return;
    startProject(resume.sources, resume.project);
    setResume(null);
  }, [resume, startProject]);

  const addSource = useCallback((src: MediaSource) => {
    setSources((s) => ({ ...s, [src.id]: src }));
    void saveSource(src);
  }, []);

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
    if (selection?.kind === "overlay") {
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

  const uploadBackground = useCallback(
    async (file: File) => {
      const src = await importImage(file);
      if (src) apply((p) => ({ ...p, canvas: { ...p.canvas, background: { type: "image", sourceId: src.id } } }));
    },
    [importImage, apply]
  );

  const uploadAudio = useCallback(
    async (file: File) => {
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
        const start = Math.min(clock.get(), Math.max(0, lay.total - 0.5));
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

  const extractAudio = useCallback(
    (clipId: string) => {
      const laid = lay.clips.find((c) => c.clip.id === clipId);
      if (!laid) return;
      if (laid.clip.freeze !== null || laid.clip.reverse) {
        say("Freeze frames and reversed clips have no audio to extract.");
        return;
      }
      if (laid.clip.speed !== 1) {
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

  const addEffect = useCallback(
    (type: EffectType) => {
      const e: EffectClip = { id: newId("fx"), type, ...placeAt(2), intensity: 50 };
      apply((p) => ({ ...p, effects: [...p.effects, e] }));
      setTool(null);
      setSelection({ kind: "effect", id: e.id });
    },
    [apply, placeAt]
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

  const newProject = useCallback(async () => {
    if (!window.confirm("Start a new project? Your current edit will be closed.")) return;
    setPlaying(false);
    await clearProject();
    thumbJobs.current.forEach((c) => c.abort());
    thumbJobs.current.clear();
    Object.values(sourcesRef.current).forEach((s) => URL.revokeObjectURL(s.url));
    setThumbs({});
    setWaves({});
    setSources({});
    setOriginalId(null);
    reset(EMPTY);
    setPhase("import");
  }, [reset]);

  // --- keyboard shortcuts ------------------------------------------------
  useEffect(() => {
    if (phase !== "edit") return;
    const onKey = (e: KeyboardEvent) => {
      if (dialog || showSignIn) return;
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
  }, [phase, dialog, showSignIn, undo, redo, copy, paste, duplicate, currentItem, togglePlay, split, freezeFrame, addText, deleteSelection, moveSelected, seek, clock, lay.fps]);

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
      {phase === "edit" && original && (
        <div className="hidden min-w-0 flex-1 md:block">
          <p className="truncate text-xs font-semibold text-foreground">{original.file.name}</p>
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
              onClick={newProject}
              className="hidden rounded-full px-3 py-2 text-xs font-semibold text-muted hover:text-foreground sm:inline"
            >
              New
            </button>
          </>
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

  if (phase !== "edit" || !original) {
    return (
      <div className="flex min-h-dvh flex-col bg-background">
        {header}
        <main className="flex flex-1 items-center justify-center p-4 sm:p-8">
          <div className="glass-card w-full max-w-2xl rounded-[2rem] p-6 sm:p-10">
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Online <span className="text-gradient">Video Editor</span>
            </h1>
            <p className="mt-2 text-sm text-muted sm:text-base">
              Trim, cut and rearrange clips, add text, music, filters, effects, transitions and stickers, and clean up overlays with AI. Your
              original file is never changed.
            </p>

            {resume && phase === "import" && (
              <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-accent-2/40 bg-accent-2/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">Continue where you left off?</p>
                  <p className="truncate text-xs text-muted">
                    {resume.sources.find((s) => s.kind === "original")?.file.name} · {resume.project.clips.length} clip
                    {resume.project.clips.length === 1 ? "" : "s"} · saved {new Date(resume.savedAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" onClick={resumeProject} className="btn-primary rounded-full px-4 py-2 text-sm font-semibold">
                    Resume
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      resume.sources.forEach((s) => URL.revokeObjectURL(s.url));
                      setResume(null);
                      void clearProject();
                    }}
                    className="btn-secondary rounded-full px-4 py-2 text-sm font-semibold"
                  >
                    Discard
                  </button>
                </div>
              </div>
            )}

            {phase === "probing" ? (
              <div className="mt-8 flex flex-col items-center gap-4 rounded-[1.75rem] border border-border bg-surface-2/70 p-12 text-center" role="status">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-2/20 border-t-accent-2" />
                <p className="text-sm font-medium text-foreground">Checking your video…</p>
              </div>
            ) : phase === "loading" ? (
              <div className="mt-8 h-48 animate-pulse rounded-[1.75rem] bg-surface-2/70" />
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
                <button
                  type="button"
                  onClick={() => {
                    trackEvent("upload_clicked", { tool: TOOL });
                    fileInput.current?.click();
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
                  className={`mt-8 flex w-full flex-col items-center justify-center rounded-[1.75rem] border-2 border-dashed px-6 py-14 text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 ${
                    isDragOver ? "scale-[1.01] border-accent-2 bg-accent-2/10" : "border-border hover:border-accent-2/50 hover:bg-surface-2/40"
                  }`}
                >
                  <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-accent-2/30 bg-gradient-to-tr from-accent/20 to-accent-2/20 text-accent-2">
                    <UploadIcon width={24} height={24} />
                  </span>
                  <span className="text-base font-semibold text-foreground">Drop a video here, or click to browse</span>
                  <span className="mt-1 text-xs text-muted sm:text-sm">MP4, MOV, WebM · up to 300MB · up to 10 minutes</span>
                </button>
              </>
            )}

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
            <p className="mt-6 text-center text-xs text-muted">
              Editing happens in your browser. Your video is only uploaded to check it and when you export or run AI Cleanup, and isn&apos;t stored.
            </p>
          </div>
        </main>
        {children}
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
    panel = <AudioAddPanel audio={project.audio} onUpload={(f) => void uploadAudio(f)} onSelect={(id) => select({ kind: "audio", id })} onClose={() => setTool(null)} />;
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
        onChange={(id, patch) => apply((p) => updateOverlay(p, id, patch))}
        onRestack={(id, dir) => apply((p) => restackOverlay(p, id, dir))}
        onDelete={(id) => apply((p) => ({ ...p, overlays: p.overlays.filter((o) => o.id !== id) }))}
        onClose={() => setTool(null)}
      />
    );
  } else if (selectedClip && sources[selectedClip.clip.sourceId]) {
    const src = sources[selectedClip.clip.sourceId];
    const change = (patch: Partial<Clip>) => apply((p) => updateClip(p, selectedClip.clip.id, patch));
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
            onOpenLook={() => openLook("filters")}
            gesture={gesture}
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
        onChange={(patch) => apply((p) => updateOverlay(p, selectedOverlay.id, patch))}
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
          <ActionButton onClick={openCleanup} tone="accent">
            <SparkleIcon width={14} height={14} /> AI Cleanup
          </ActionButton>
        </div>
        <p className="mt-6 text-[11px] leading-relaxed text-muted">
          Shortcuts: Space play/pause · S split · F freeze frame · T text · Delete remove · Ctrl+C / Ctrl+V copy/paste · Ctrl+D duplicate · ←/→ frame step (Shift:
          1s) · Alt+←/→ move clip · Ctrl+Z / Ctrl+Shift+Z undo/redo
        </p>
      </PanelShell>
    );
  }

  // --- timeline tracks ------------------------------------------------------------
  const sel = selection;
  const isSel = (kind: string, id: string) => sel !== null && sel.kind === kind && "id" in sel && sel.id === id;
  const tracks: TimelineTrack[] = [
    {
      key: "text",
      label: "Text",
      tone: "border-sky-500/40 bg-sky-500/20",
      empty: "Press T to add text",
      items: project.overlays
        .filter((o) => o.kind === "text")
        .map((o) => ({
          id: o.id,
          start: o.start,
          end: o.end,
          label: o.kind === "text" ? o.text.content.split("\n")[0] || "Text" : "",
          glyph: "T",
          hidden: o.hidden,
          locked: o.locked,
          selected: isSel("overlay", o.id),
          sel: { kind: "overlay", id: o.id },
        })),
    },
    {
      key: "elements",
      label: "Elements",
      tone: "border-accent/40 bg-accent/20",
      empty: "Stickers and images appear here",
      items: project.overlays
        .filter((o) => o.kind !== "text")
        .map((o) => {
          const def = o.kind === "sticker" ? getStickerDef(o.stickerId) : undefined;
          return {
            id: o.id,
            start: o.start,
            end: o.end,
            label: o.kind === "sticker" ? (def?.label ?? "Sticker") : o.kind === "video" ? "Video" : "Image",
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
            selected: isSel("overlay", o.id),
            sel: { kind: "overlay" as const, id: o.id },
          };
        }),
    },
    {
      key: "audio",
      label: "Audio",
      tone: "border-emerald-500/40 bg-emerald-500/20",
      empty: "Music and extracted audio appear here",
      items: project.audio.map((a) => ({
        id: a.id,
        start: a.start,
        end: a.start + a.duration,
        label: `${a.muted ? "🔇 " : ""}${a.label}`,
        glyph: "♪",
        wave: { sourceId: a.sourceId, offset: a.offset, duration: a.duration, gain: a.muted ? 0 : a.volume },
        selected: isSel("audio", a.id),
        sel: { kind: "audio" as const, id: a.id },
      })),
    },
    {
      key: "effects",
      label: "Effects",
      tone: "border-amber-500/40 bg-amber-500/20",
      empty: "Timed effects appear here",
      items: project.effects.map((e) => ({
        id: e.id,
        start: e.start,
        end: e.end,
        label: EFFECT_LABELS[e.type],
        glyph: EFFECT_ICONS[e.type],
        selected: isSel("effect", e.id),
        sel: { kind: "effect" as const, id: e.id },
      })),
    },
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
                onChange={(id, patch) => apply((p) => updateOverlay(p, id, patch))}
                onGestureStart={beginGesture}
                onGestureEnd={endGesture}
                onEditText={(id) => {
                  select({ kind: "overlay", id });
                  setTimeout(() => textAreaRef.current?.focus(), 30);
                }}
              />
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
            {toolBtn("audio", "Audio", <MusicIcon />, "Music and audio")}
            {toolBtn("elements", "Elements", <ElementsIcon />, "Stickers and images")}
            {toolBtn("effects", "Effects", <EffectIcon />, "Timed effects")}
            {toolBtn("filters", "Filters", <FilterIcon />, "Filters for the selected clip")}
            {toolBtn("adjust", "Adjust", <AdjustIcon />, "Adjust color and light")}
            <ToolButton label="Transition between clips" onClick={openTransition} text="Transition">
              <TransitionIcon />
            </ToolButton>
            {toolBtn("canvas", "Canvas", <CanvasIcon />, "Canvas size and background")}
            {toolBtn("layers", "Layers", <LayersIcon />, "Layer order, hide and lock")}
            <span className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden />
            <ToolButton label="AI Cleanup on the selected clip" onClick={openCleanup} text="AI Cleanup" accent>
              <SparkleIcon />
            </ToolButton>
          </div>

          <div className="max-h-[40dvh] overflow-y-auto p-2 sm:p-3 lg:max-h-[38dvh]">
            <Timeline
              lay={lay}
              sources={sources}
              thumbnails={thumbs}
              waveforms={waves}
              tracks={tracks}
              selection={selection}
              clock={clock}
              playing={playing}
              onSelect={select}
              onSeek={seek}
              onClipChange={(id, patch) => apply((p) => updateClip(p, id, patch))}
              onItemChange={onItemChange}
              onMoveClip={(from, to) => apply((p) => moveClip(p, from, to))}
              onGestureStart={beginGesture}
              onGestureEnd={endGesture}
            />
          </div>
        </main>

        <aside className="border-t border-border bg-surface/50 lg:w-80 lg:shrink-0 lg:overflow-hidden lg:border-l lg:border-t-0 xl:w-96" aria-label="Properties">
          {panel}
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
