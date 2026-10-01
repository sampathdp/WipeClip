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
import { useProjectHistory } from "@/lib/editor/history";
import { generateThumbnails, loadVideoMeta, type ThumbnailStrip } from "@/lib/editor/media";
import {
  clearLastExport,
  clearProject,
  loadLastExport,
  loadProject,
  saveProject,
  saveSource,
  type RestoredProject,
} from "@/lib/editor/projectStore";
import { rasterizeSticker, type RasterSticker } from "@/lib/editor/stickers";
import {
  clipVisualSpan,
  deleteClip,
  formatTime,
  layout,
  locate,
  moveClip,
  newId,
  splitAt,
  updateClip,
  updateSticker,
} from "@/lib/editor/timeline";
import type { Clip, MediaSource, Project, Selection, Sticker } from "@/lib/editor/types";
import { ApiError, ContentBlockedError, probeVideo } from "@/lib/toolsApi";
import AiCleanupDialog from "./AiCleanupDialog";
import ExportDialog from "./ExportDialog";
import { ActionButton, ClipPanel, PanelShell, StickerLibrary, StickerPanel, TransitionPanel } from "./Inspector";
import PreviewPlayer from "./PreviewPlayer";
import StickerLayer from "./StickerLayer";
import Timeline from "./Timeline";
import {
  ExportIcon,
  FullscreenIcon,
  MuteIcon,
  PauseIcon,
  PlayIcon,
  RedoIcon,
  SparkleIcon,
  SplitIcon,
  StickerIcon,
  TransitionIcon,
  TrashIcon,
  TrimIcon,
  UndoIcon,
  UploadIcon,
  VolumeIcon,
} from "./icons";

const TOOL = "video_editor";
const MAX_BYTES = 300 * 1024 * 1024;
const EMPTY: Project = { clips: [], stickers: [] };
const RATES = [0.5, 1, 1.5, 2];

type Dialogs = { kind: "cleanup"; clipId: string; frameTime: number } | { kind: "export" } | null;

export default function VideoEditor() {
  useToolView(TOOL);
  const clock = useMemo(() => createClock(), []);
  const { project, canUndo, canRedo, apply, beginGesture, endGesture, undo, redo, reset } = useProjectHistory(EMPTY);

  const [phase, setPhase] = useState<"loading" | "import" | "probing" | "edit">("loading");
  const [importError, setImportError] = useState<{ message: string; blocked?: boolean } | null>(null);
  const [resume, setResume] = useState<RestoredProject | null>(null);
  const [sources, setSources] = useState<Record<string, MediaSource>>({});
  const [originalId, setOriginalId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, ThumbnailStrip>>({});
  const [stickerImages, setStickerImages] = useState<Record<string, RasterSticker>>({});
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const [pendingExport, setPendingExport] = useState<Blob | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const thumbJobs = useRef(new Map<string, AbortController>());

  const original = originalId ? sources[originalId] : undefined;
  const lay = useMemo(() => layout(project, original?.fps ?? 30), [project, original?.fps]);

  const say = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // --- auth (download gating, resolution tiers) - same as UploadDemo ----
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setIsSignedIn(Boolean(data.user)));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setIsSignedIn(Boolean(session?.user)));
    return () => sub.subscription.unsubscribe();
  }, []);

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

  // Autosave the (small) project JSON; sources are saved once when added.
  useEffect(() => {
    if (phase !== "edit" || project.clips.length === 0) return;
    const t = setTimeout(() => void saveProject(project, Object.values(sources)), 800);
    return () => clearTimeout(t);
  }, [project, sources, phase]);

  // Thumbnails for every source, generated once each in the background.
  useEffect(() => {
    for (const src of Object.values(sources)) {
      if (thumbJobs.current.has(src.id)) continue;
      const controller = new AbortController();
      thumbJobs.current.set(src.id, controller);
      void generateThumbnails(src.url, src.duration, (strip) => setThumbs((t) => ({ ...t, [src.id]: strip })), controller.signal);
    }
  }, [sources]);

  // Rasterize each sticker type in use (shared by preview and export).
  useEffect(() => {
    for (const s of project.stickers) {
      if (stickerImages[s.stickerId]) continue;
      rasterizeSticker(s.stickerId)
        .then((img) => setStickerImages((m) => (m[s.stickerId] ? m : { ...m, [s.stickerId]: img })))
        .catch(() => say("A sticker couldn't be loaded. Try adding it again."));
    }
  }, [project.stickers, stickerImages, say]);

  // --- project lifecycle ---------------------------------------------------
  const startProject = useCallback(
    (srcs: MediaSource[], next: Project) => {
      thumbJobs.current.forEach((c) => c.abort());
      thumbJobs.current.clear();
      Object.values(sourcesRef.current).forEach((s) => URL.revokeObjectURL(s.url));
      setThumbs({});
      setSources(Object.fromEntries(srcs.map((s) => [s.id, s])));
      setOriginalId(srcs.find((s) => s.kind === "original")?.id ?? srcs[0].id);
      reset(next);
      clock.set(0);
      setPlaying(false);
      setSelection(null);
      setShowLibrary(false);
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
        startProject([src], {
          clips: [{ id: newId("clip"), sourceId: src.id, start: 0, end: meta.duration, transition: null }],
          stickers: [],
        });
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

  const resumeProject = useCallback(() => {
    if (!resume) return;
    startProject(resume.sources, resume.project);
    setResume(null);
  }, [resume, startProject]);

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
  const selectedSticker = selection?.kind === "sticker" ? project.stickers.find((s) => s.id === selection.id) : undefined;
  const selectedTransition =
    selection?.kind === "transition" ? lay.clips.findIndex((c) => c.clip.id === selection.clipId) : -1;

  // --- editing operations --------------------------------------------------
  const split = useCallback(() => {
    const next = splitAt(project, lay, clock.get());
    if (!next) {
      say("Move the playhead inside a clip (not onto a transition or an edge) to split.");
      return;
    }
    apply(() => next);
  }, [project, lay, clock, apply, say]);

  const deleteSelection = useCallback(() => {
    if (selection?.kind === "sticker") {
      apply((p) => ({ ...p, stickers: p.stickers.filter((s) => s.id !== selection.id) }));
      setSelection(null);
    } else if (selection?.kind === "transition") {
      apply((p) => updateClip(p, selection.clipId, { transition: null }));
      setSelection(null);
    } else {
      const id = selection?.kind === "clip" ? selection.id : lay.clips[clipIndexAtPlayhead()]?.clip.id;
      if (!id) return;
      const next = deleteClip(project, id);
      if (!next) {
        say("A project needs at least one clip.");
        return;
      }
      apply(() => next);
      setSelection(null);
      if (clock.get() > layout(next, lay.fps).total) clock.set(layout(next, lay.fps).total);
    }
  }, [selection, project, lay, apply, say, clipIndexAtPlayhead, clock]);

  const moveSelected = useCallback(
    (dir: -1 | 1) => {
      if (!selectedClip) return;
      apply((p) => moveClip(p, selectedClip.index, selectedClip.index + dir));
    },
    [selectedClip, apply]
  );

  const addSticker = useCallback(
    (stickerId: string) => {
      const total = lay.total;
      const start = Math.min(clock.get(), Math.max(0, total - 0.5));
      const sticker: Sticker = {
        id: newId("stk"),
        stickerId,
        start,
        end: Math.min(total, start + 3),
        x: 0.5,
        y: 0.5,
        width: 0.22,
        rotation: 0,
        // No entrance by default: a Pop/Fade would make the sticker
        // invisible at the very frame the user just placed it on.
        animIn: "none",
        animOut: "none",
      };
      apply((p) => ({ ...p, stickers: [...p.stickers, sticker] }));
      setSelection({ kind: "sticker", id: sticker.id });
      setShowLibrary(false);
    },
    [lay.total, clock, apply]
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
    setShowLibrary(false);
    setSelection({ kind: "transition", clipId: lay.clips[best].clip.id });
  }, [lay, clock, say]);

  const openTrim = useCallback(() => {
    const idx = selectedClip ? selectedClip.index : clipIndexAtPlayhead();
    if (idx < 0) return;
    setShowLibrary(false);
    setSelection({ kind: "clip", id: lay.clips[idx].clip.id });
    say("Drag the clip's edges on the timeline, or use Trim start/end here.");
  }, [selectedClip, clipIndexAtPlayhead, lay, say]);

  const openCleanup = useCallback(() => {
    const idx = selectedClip ? selectedClip.index : clipIndexAtPlayhead();
    const laid = lay.clips[idx];
    if (!laid) return;
    setPlaying(false);
    const loc = locate(lay, clock.get());
    const inside = loc && loc.primary.index === idx && !loc.incoming;
    const frameTime = inside ? loc.primary.sourceTime : laid.clip.start + (laid.clip.end - laid.clip.start) / 2;
    setSelection({ kind: "clip", id: laid.clip.id });
    setDialog({ kind: "cleanup", clipId: laid.clip.id, frameTime });
  }, [selectedClip, clipIndexAtPlayhead, lay, clock]);

  const onCleaned = useCallback(
    (clipId: string, src: MediaSource) => {
      setSources((s) => ({ ...s, [src.id]: src }));
      void saveSource(src);
      apply((p) => updateClip(p, clipId, { sourceId: src.id, start: 0, end: src.duration }));
      setDialog(null);
      say("Clip cleaned. Undo brings the original back.");
    },
    [apply, say]
  );

  const newProject = useCallback(async () => {
    if (!window.confirm("Start a new project? Your current edit will be closed.")) return;
    setPlaying(false);
    await clearProject();
    thumbJobs.current.forEach((c) => c.abort());
    thumbJobs.current.clear();
    Object.values(sourcesRef.current).forEach((s) => URL.revokeObjectURL(s.url));
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
          (target.tagName === "INPUT" && !/^(range|checkbox|radio)$/.test((target as HTMLInputElement).type)));
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
      } else if (mod) {
        return;
      } else if (e.key === " " && target?.tagName !== "BUTTON") {
        e.preventDefault();
        togglePlay();
      } else if (key === "s") {
        e.preventDefault();
        split();
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
        setShowLibrary(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, dialog, showSignIn, undo, redo, togglePlay, split, deleteSelection, moveSelected, seek, clock, lay.fps]);

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
              <span className="text-gradient">Video Editor</span>
            </h1>
            <p className="mt-2 text-sm text-muted sm:text-base">
              Trim, cut, rearrange, add transitions and stickers, and clean up overlays with AI. Your original file is never changed.
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
      </div>
    );
  }

  const aspect = { width: original.width, height: original.height };

  let panel: React.ReactNode;
  if (showLibrary) {
    panel = <StickerLibrary onAdd={addSticker} onClose={() => setShowLibrary(false)} />;
  } else if (selectedClip && sources[selectedClip.clip.sourceId]) {
    panel = (
      <ClipPanelLive
        clock={clock}
        lay={lay}
        laidIndex={selectedClip.index}
        source={sources[selectedClip.clip.sourceId]}
        onChange={(patch) => apply((p) => updateClip(p, selectedClip.clip.id, patch))}
        onSplit={split}
        onDelete={deleteSelection}
        onMove={moveSelected}
        onAiCleanup={openCleanup}
        onClose={() => setSelection(null)}
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
      />
    );
  } else if (selectedSticker) {
    panel = (
      <StickerPanel
        sticker={selectedSticker}
        total={lay.total}
        onChange={(patch) => apply((p) => updateSticker(p, selectedSticker.id, patch))}
        onDelete={deleteSelection}
        onClose={() => setSelection(null)}
        onGestureStart={beginGesture}
        onGestureEnd={endGesture}
      />
    );
  } else {
    panel = (
      <PanelShell title="Project">
        <dl className="grid grid-cols-2 gap-3 text-xs">
          <Stat label="Length" value={formatTime(lay.total, true)} />
          <Stat label="Clips" value={String(project.clips.length)} />
          <Stat label="Size" value={`${original.width}×${original.height}`} />
          <Stat label="Audio" value={original.hasAudio ? "Yes" : "None"} />
        </dl>
        <div className="mt-5 space-y-2 text-xs text-muted">
          <p className="font-semibold text-foreground">Getting started</p>
          <p>Click a clip on the timeline to trim, move, delete or AI-clean it.</p>
          <p>Press S (or Split) to cut at the playhead. Split twice and delete the middle to remove a section.</p>
          <p>Drag clips to reorder them. Click the diamond between clips to add a transition.</p>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <ActionButton onClick={() => setShowLibrary(true)}>
            <StickerIcon width={14} height={14} /> Add sticker
          </ActionButton>
          <ActionButton onClick={openCleanup} tone="accent">
            <SparkleIcon width={14} height={14} /> AI Cleanup
          </ActionButton>
        </div>
        <p className="mt-6 text-[11px] text-muted">
          Shortcuts: Space play/pause · S split · Delete remove · ←/→ frame step (Shift: 1s) · Alt+←/→ move clip · Ctrl+Z / Ctrl+Shift+Z undo/redo
        </p>
      </PanelShell>
    );
  }

  const cleanupClip = dialog?.kind === "cleanup" ? project.clips.find((c) => c.id === dialog.clipId) : undefined;

  return (
    <div className="flex min-h-dvh flex-col bg-background lg:h-dvh">
      {header}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="h-[42dvh] min-h-[200px] p-3 lg:h-auto lg:flex-1">
            <PreviewPlayer
              lay={lay}
              sources={sources}
              aspect={aspect}
              clock={clock}
              playing={playing}
              onEnded={onEnded}
              rate={rate}
              volume={volume}
              muted={muted}
              stageRef={stageRef}
            >
              <StickerLayer
                clock={clock}
                aspect={aspect}
                stickers={project.stickers}
                images={stickerImages}
                selectedId={selectedSticker?.id ?? null}
                onSelect={(id) => {
                  if (id) setShowLibrary(false);
                  setSelection(id ? { kind: "sticker", id } : selection?.kind === "sticker" ? null : selection);
                }}
                onChange={(id, patch) => apply((p) => updateSticker(p, id, patch))}
                onGestureStart={beginGesture}
                onGestureEnd={endGesture}
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

          <div className="flex flex-wrap items-center gap-1 border-y border-border bg-surface/60 px-2 py-1.5 sm:gap-1.5 sm:px-3" role="toolbar" aria-label="Editing tools">
            <ToolButton label="Split at playhead (S)" onClick={split} text="Split">
              <SplitIcon />
            </ToolButton>
            <ToolButton label="Trim the clip at the playhead" onClick={openTrim} text="Trim">
              <TrimIcon />
            </ToolButton>
            <ToolButton label="Delete selection (Delete)" onClick={deleteSelection} text="Delete">
              <TrashIcon />
            </ToolButton>
            <span className="mx-1 h-6 w-px bg-border" aria-hidden />
            <ToolButton label="AI Cleanup on the selected clip" onClick={openCleanup} text="AI Cleanup" accent>
              <SparkleIcon />
            </ToolButton>
            <ToolButton label="Transition between clips" onClick={openTransition} text="Transition">
              <TransitionIcon />
            </ToolButton>
            <ToolButton
              label="Add a sticker"
              onClick={() => {
                setShowLibrary((v) => !v);
              }}
              text="Sticker"
              active={showLibrary}
            >
              <StickerIcon />
            </ToolButton>
          </div>

          <div className="p-2 sm:p-3">
            <Timeline
              lay={lay}
              sources={sources}
              thumbnails={thumbs}
              stickers={project.stickers}
              selection={selection}
              clock={clock}
              playing={playing}
              onSelect={(s) => {
                setShowLibrary(false);
                setSelection(s);
              }}
              onSeek={seek}
              onClipChange={(id, patch) => apply((p) => updateClip(p, id, patch))}
              onStickerChange={(id, patch) => apply((p) => updateSticker(p, id, patch))}
              onMoveClip={(from, to) => apply((p) => moveClip(p, from, to))}
              onGestureStart={beginGesture}
              onGestureEnd={endGesture}
            />
          </div>
        </main>

        <aside className="border-t border-border bg-surface/50 lg:w-80 lg:shrink-0 lg:border-l lg:border-t-0 xl:w-96" aria-label="Properties">
          {panel}
        </aside>
      </div>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 z-[80] max-w-[90vw] -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-center text-xs font-medium text-background shadow-xl"
        >
          {toast}
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
      className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:cursor-not-allowed disabled:opacity-35 ${
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
    />
  );
}
