"use client";

/** Phase 3 tutorial tools wired to the editor: suggestion review (silence,
 * dead time, interaction insights) with ripple cuts, chapters, shortcut
 * indicators, privacy masks, annotations, recording screenshots and the
 * retake/replace workflow. Everything edits Project data through `apply`
 * (one undo step per action); nothing changes the source files.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { analyzeAudio, type AudioReport } from "@/lib/editor/audioAnalysis";
import { buildSpeechMix } from "@/lib/editor/captions";
import { timelineTimeOf } from "@/lib/editor/camera";
import { DEFAULT_CHAPTERS, suggestChapters } from "@/lib/editor/chapters";
import { acceptedCuts, interactionTimeline, suggestEdits, type Act } from "@/lib/editor/insights";
import { DEFAULT_KEYSTROKES, comboCounts, keystrokeOverlays, type KeystrokeSettings } from "@/lib/editor/keystrokes";
import { loadVideoMeta } from "@/lib/editor/media";
import { recordingEvents } from "@/lib/editor/pointer";
import { rippleCut, rippleReplace } from "@/lib/editor/ripple";
import { SHAPE_WIDTH, defaultShape } from "@/lib/editor/shapes";
import { layout, locate, newId, formatTime, type Layout } from "@/lib/editor/timeline";
import { captionCues, chapterList, chaptersVtt } from "@/lib/editor/transcript";
import { newClip, type Chapter, type EditSuggestion, type MaskMode, type MediaSource, type Overlay, type PrivacyMask, type Project, type Selection, type ShapeType } from "@/lib/editor/types";
import { IS_DESKTOP, saveTextFile } from "@/lib/platform";
import { recordingOpen, recordingRead } from "@/lib/platform/recorder";
import { loadRecordingBundle, recoverRecording } from "@/lib/recorder/bundle";
import { recordingToSources } from "@/lib/recorder/editorImport";
import { parseManifest } from "@/lib/recorder/format";
import { planRecordingProject } from "@/lib/recorder/importPlan";
import { ApiError, ContentBlockedError, probeVideo } from "@/lib/toolsApi";
import Dialog from "./Dialog";
import { ActionButton } from "./Inspector";
import type { ReviewSettings, TutorialPanelProps, TutorialTab } from "./TutorialPanel";

interface Deps {
  project: Project;
  lay: Layout;
  sources: Record<string, MediaSource>;
  recSource: MediaSource | undefined;
  clock: { get: () => number; set: (t: number) => void };
  apply: (fn: (p: Project) => Project, record?: boolean) => void;
  say: (m: string) => void;
  setSelection: (s: Selection) => void;
  setPlaying: (v: boolean) => void;
  addSource: (s: MediaSource) => void;
  addOverlay: (o: Overlay) => void;
  baseOverlay: (length: number) => Omit<Overlay, "kind"> & Record<string, unknown>;
  importImage: (file: File) => Promise<MediaSource | null>;
  fileName: string;
  onClose: () => void;
}

interface PendingReplace {
  mark: EditSuggestion;
  made: MediaSource[];
  clipSource: MediaSource;
  duration: number;
  audio: Project["audio"];
  overlays: Overlay[];
  label: string;
}

export function useTutorialTools(d: Deps) {
  const { project, lay, sources, recSource, clock, apply, say } = d;
  const [tab, setTab] = useState<TutorialTab>("review");
  const [analysis, setAnalysis] = useState<string | null>(null);
  const analysisRun = useRef(0);
  const analysisCtrl = useRef<AbortController | null>(null);
  useEffect(() => () => analysisCtrl.current?.abort(), []);
  const lastReport = useRef<AudioReport | null>(null);
  const [keySettings, setKeySettings] = useState<KeystrokeSettings>(DEFAULT_KEYSTROKES);
  const [replaceBusy, setReplaceBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingReplace | null>(null);

  const events = recordingEvents(recSource);
  const acts: Act[] | null = useMemo(() => (recSource && events ? interactionTimeline(lay, recSource.id, events) : null), [lay, recSource, events]);
  const isMac = recSource?.recording?.manifest.app?.platform === "macos";
  const suggestions = useMemo(() => project.suggestions ?? [], [project.suggestions]);

  // --- review -----------------------------------------------------------------
  const analyze = useCallback(
    async (s: ReviewSettings) => {
      const run = ++analysisRun.current;
      analysisCtrl.current?.abort();
      const ctrl = new AbortController();
      analysisCtrl.current = ctrl;
      setAnalysis("Mixing the timeline's audio…");
      try {
        const mix = await buildSpeechMix(lay, project, sources, { withClipping: true, signal: ctrl.signal });
        if (run !== analysisRun.current) return;
        setAnalysis("Analyzing…");
        await new Promise((r) => setTimeout(r, 0));
        if (run !== analysisRun.current) return;
        const report = mix.samples ? analyzeAudio(mix.samples, s.silence, undefined, mix.clipping) : null;
        lastReport.current = report;
        const tooLarge = mix.skipped.length ? ` ${mix.skipped.join(", ")} ${mix.skipped.length === 1 ? "is" : "are"} too large to analyze for sound.` : "";
        if (!report && !acts) {
          say(tooLarge ? `Nothing to analyze.${tooLarge}` : "There's no sound or recorded interaction to analyze.");
          return;
        }
        const aspect = recSource ? recSource.width / Math.max(1, recSource.height) : 16 / 9;
        const list = suggestEdits({ lay, acts, audio: report }, { silence: s.silence, idle: s.idle, aspect }, () => newId("sg"));
        if (run !== analysisRun.current) return;
        apply((p) => ({ ...p, suggestions: [...(p.suggestions ?? []).filter((x) => x.kind === "retake"), ...list] }));
        const cuts = list.filter((x) => x.action === "cut").length;
        say(
          (list.length
            ? `${list.length} suggestion${list.length === 1 ? "" : "s"} (${cuts} possible cut${cuts === 1 ? "" : "s"}). Nothing changes until you accept.`
            : "Nothing stood out. Your recording looks tight.") + tooLarge
        );
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        console.error("[review] analysis failed", e);
        say("Analysis failed.");
      } finally {
        if (run === analysisRun.current) setAnalysis(null);
        if (analysisCtrl.current === ctrl) analysisCtrl.current = null;
      }
    },
    [lay, project, sources, acts, recSource, apply, say]
  );

  const cut = useCallback(
    (ranges: { start: number; end: number }[]) => {
      // Back to front so earlier ranges stay valid; one undo step.
      let next = project;
      let removed = 0;
      for (const r of [...ranges].sort((a, b) => b.start - a.start)) {
        const res = rippleCut(next, layout(next, lay.fps), r.start, r.end);
        if (!res.ok) {
          say(res.error);
          return false;
        }
        next = res.project;
        removed += res.removed;
      }
      apply(() => next);
      say(`Removed ${removed.toFixed(1)} s. Undo with Ctrl+Z if it doesn't feel right.`);
      return true;
    },
    [project, lay.fps, apply, say]
  );

  const setStatus = useCallback(
    (id: string, status: EditSuggestion["status"]) =>
      apply((p) => ({ ...p, suggestions: (p.suggestions ?? []).map((s) => (s.id === id ? { ...s, status } : s)) })),
    [apply]
  );

  // --- chapters ------------------------------------------------------------------
  const chapters = useMemo(() => project.chapters ?? [], [project.chapters]);
  const suggestChaptersNow = useCallback(() => {
    const list = suggestChapters({ acts, cues: captionCues(project.overlays), audio: lastReport.current, total: lay.total }, DEFAULT_CHAPTERS, () => newId("ch"));
    apply((p) => {
      const kept = (p.chapters ?? []).filter((c) => !c.auto);
      const merged = [...kept, ...list.filter((c) => !kept.some((k) => Math.abs(k.t - c.t) < DEFAULT_CHAPTERS.minLength / 2))];
      return { ...p, chapters: merged.sort((a, b) => a.t - b.t) };
    });
    say(`${list.length} chapter${list.length === 1 ? "" : "s"} suggested${lastReport.current ? "" : " (run Review > Analyze first to also use pauses)"}.`);
  }, [acts, project.overlays, lay.total, apply, say]);

  const exportText = useCallback(
    async (name: string, contents: string) => {
      try {
        const r = await saveTextFile(name, contents);
        if (r.status === "saved") say(`Saved ${r.path}`);
      } catch (e) {
        say(e instanceof Error ? e.message : "Couldn't save the file.");
      }
    },
    [say]
  );
  const base = d.fileName.replace(/\.[^.]+$/, "") || "wipeclip";

  // --- masks ------------------------------------------------------------------
  const addMask = useCallback(
    (mode: MaskMode) => {
      const t = Math.min(clock.get(), Math.max(0, lay.total - 0.5));
      const loc = locate(lay, t);
      const clip = loc ? lay.clips[loc.primary.index].clip : null;
      const m: PrivacyMask = {
        id: newId("mask"),
        start: t,
        end: Math.min(lay.total, t + 5),
        mode,
        strength: 60,
        color: "#000000",
        x: 0.35,
        y: 0.4,
        w: 0.3,
        h: 0.2,
        // Stick to the content of the clip under the playhead by default.
        space: clip ? "video" : "canvas",
        sourceId: clip?.sourceId,
        follow: "none",
        enabled: true,
      };
      apply((p) => ({ ...p, masks: [...(p.masks ?? []), m] }));
      d.setSelection({ kind: "mask", id: m.id });
    },
    [clock, lay, apply, d]
  );

  // --- annotations & screenshots ------------------------------------------------------
  const addShape = useCallback(
    (type: ShapeType) => {
      const steps = project.overlays.filter((o) => o.kind === "shape" && o.shape.type === "step").length;
      d.addOverlay({ ...d.baseOverlay(4), width: SHAPE_WIDTH[type], kind: "shape", shape: defaultShape(type, steps + 1) } as Overlay);
    },
    [project.overlays, d]
  );

  const screenshots = recSource?.recording?.manifest.screenshots ?? [];
  const insertScreenshot = useCallback(
    async (path: string) => {
      const rec = recSource?.recording;
      if (!rec || !IS_DESKTOP) return;
      try {
        const bytes = await recordingRead(rec.folder, path);
        const src = await d.importImage(new File([bytes], path.split("/").pop() ?? "screenshot.png", { type: "image/png" }));
        if (!src) return;
        const shot = (rec.manifest.screenshots ?? []).find((s) => s.path === path);
        // At the moment it was taken, if that part is still on the timeline.
        const at = shot ? lay.clips.map((c) => (c.clip.sourceId === recSource!.id ? timelineTimeOf(c, (shot.tMs + (rec.timeOffsetMs ?? 0)) / 1000) : null)).find((t) => t !== null) : null;
        if (at !== null && at !== undefined) clock.set(at);
        d.addOverlay({ ...d.baseOverlay(3), width: 0.4, kind: "image", sourceId: src.id } as Overlay);
      } catch (e) {
        say(e instanceof Error ? e.message : "Couldn't open that screenshot.");
      }
    },
    [recSource, d, lay.clips, clock, say]
  );

  // --- retakes ----------------------------------------------------------------------
  const markRetake = useCallback(
    (start: number, end: number, note: string) => {
      const mark: EditSuggestion = {
        id: newId("rt"),
        kind: "retake",
        start,
        end,
        title: "Marked for retake",
        detail: note,
        action: "retake",
        status: "pending",
        confidence: "high",
      };
      apply((p) => ({ ...p, suggestions: [...(p.suggestions ?? []), mark] }));
    },
    [apply]
  );

  const chooseReplacement = useCallback(
    async (mark: EditSuggestion, from: "recording" | "file") => {
      try {
        if (from === "recording") {
          const found = await recordingOpen();
          if (!found) return;
          setReplaceBusy("Opening the recording…");
          const m = parseManifest(found.manifest);
          const rec = m.status === "recording" ? await recoverRecording(found) : { path: found.path, manifest: m };
          const bundle = await loadRecordingBundle(rec.path, rec.manifest);
          const { made, imported } = await recordingToSources(bundle, "take");
          const plan = planRecordingProject(bundle.manifest, imported, () => newId("rec"));
          const clip = plan.project.clips[0];
          const clipSource = made.find((s) => s.id === clip.sourceId)!;
          setPending({
            mark,
            made,
            clipSource,
            duration: clip.end - clip.start,
            // Its own microphone / system audio / webcam, placed at the cut.
            audio: plan.project.audio.map((a) => ({ ...a, start: a.start + mark.start })),
            overlays: plan.project.overlays.map((o) => ({ ...o, start: o.start + mark.start, end: o.end + mark.start })),
            label: rec.path.split(/[\\/]/).pop() ?? "Recording",
          });
        } else {
          const file = await pickVideoFile();
          if (!file) return;
          setReplaceBusy("Checking the video…");
          const url = URL.createObjectURL(file);
          try {
            // Same checks as any imported video (browser decode + server check).
            const [meta, probe] = await Promise.all([loadVideoMeta(url), probeVideo(file)]);
            URL.revokeObjectURL(probe.previewUrl);
            const src: MediaSource = {
              id: newId("take"),
              kind: "take",
              file,
              url,
              duration: meta.duration,
              width: meta.width,
              height: meta.height,
              fps: probe.info.fps > 0 && probe.info.fps <= 240 ? probe.info.fps : 30,
              hasAudio: probe.info.hasAudio ?? true,
            };
            setPending({ mark, made: [src], clipSource: src, duration: meta.duration, audio: [], overlays: [], label: file.name });
          } catch (e) {
            URL.revokeObjectURL(url);
            throw e;
          }
        }
      } catch (e) {
        say(e instanceof ContentBlockedError || e instanceof ApiError || e instanceof Error ? e.message || "Couldn't use that video." : "Couldn't use that video.");
      } finally {
        setReplaceBusy(null);
      }
    },
    [say]
  );

  const commitReplace = useCallback(() => {
    if (!pending) return;
    const { mark, made, clipSource, duration, audio, overlays } = pending;
    const clip = newClip(newId("clip"), clipSource.id, 0, duration);
    const res = rippleReplace(project, lay, mark.start, mark.end, [clip], layout({ ...project, clips: [clip] }, lay.fps).total, { audio, overlays }, (p) => layout(p, lay.fps));
    if (!res.ok) {
      say(res.error);
      return;
    }
    made.forEach((s) => d.addSource(s));
    apply(() => res.project);
    setPending(null);
    say(`Replaced ${formatTime(mark.start)}–${formatTime(mark.end)}. Undo with Ctrl+Z.`);
  }, [pending, project, lay, apply, say, d]);

  const cancelReplace = useCallback(() => {
    pending?.made.forEach((s) => URL.revokeObjectURL(s.url));
    setPending(null);
  }, [pending]);

  // --- panel props ---------------------------------------------------------------
  const keystrokeCount = project.overlays.filter((o) => o.keystroke).length;
  const panelProps: TutorialPanelProps = {
    tab,
    onTab: setTab,
    onClose: d.onClose,
    hasEvents: !!acts,
    isMac,
    suggestions,
    analysis,
    onAnalyze: (s) => void analyze(s),
    onCancelAnalysis: () => {
      analysisRun.current++;
      analysisCtrl.current?.abort();
      setAnalysis(null);
      say("Analysis cancelled.");
    },
    onPreview: (s) => {
      d.setPlaying(false);
      clock.set(Math.max(0, s.start - 1.5));
      d.setPlaying(true);
    },
    onAccept: (s) => {
      if (s.action === "cut") cut([s]);
    },
    onReject: (s) => (s.kind === "retake" ? apply((p) => ({ ...p, suggestions: (p.suggestions ?? []).filter((x) => x.id !== s.id) })) : setStatus(s.id, "rejected")),
    onEditSuggestion: (id, patch) => apply((p) => ({ ...p, suggestions: (p.suggestions ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s)) })),
    onAcceptAllHigh: () => {
      const high = suggestions.filter((s) => s.status === "pending" && s.action === "cut" && s.confidence === "high").map((s) => ({ ...s, status: "accepted" as const }));
      cut(acceptedCuts(high));
    },
    onClearSuggestions: () => apply((p) => ({ ...p, suggestions: (p.suggestions ?? []).filter((s) => s.kind === "retake") })),
    chapters,
    onSuggestChapters: suggestChaptersNow,
    onAddChapter: () => {
      const c: Chapter = { id: newId("ch"), t: Math.round(clock.get() * 100) / 100, title: `Chapter ${chapters.length + 1}`, auto: false };
      apply((p) => ({ ...p, chapters: [...(p.chapters ?? []), c].sort((a, b) => a.t - b.t) }));
    },
    onChapterChange: (id, patch) => apply((p) => ({ ...p, chapters: (p.chapters ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
    onDeleteChapter: (id) => apply((p) => ({ ...p, chapters: (p.chapters ?? []).filter((c) => c.id !== id) })),
    onJump: (t) => clock.set(t),
    onExportChapters: (f) => void exportText(`${base}-chapters.${f}`, f === "txt" ? chapterList(chapters) : chaptersVtt(chapters, lay.total)),
    total: lay.total,
    combos: acts ? comboCounts(acts) : [],
    keystrokeCount,
    keySettings,
    onKeySettings: setKeySettings,
    onGenerateKeys: () => {
      if (!acts) return;
      const keys = keystrokeOverlays(acts, keySettings, lay.total, isMac, () => newId("key"));
      apply((p) => ({ ...p, overlays: [...p.overlays.filter((o) => !o.keystroke), ...keys] }));
      say(`${keys.length} shortcut indicator${keys.length === 1 ? "" : "s"} on the Text track.`);
    },
    onRemoveKeys: () => apply((p) => ({ ...p, overlays: p.overlays.filter((o) => !o.keystroke) })),
    masks: project.masks ?? [],
    onAddMask: addMask,
    onSelectMask: (id) => {
      d.setSelection({ kind: "mask", id });
      const m = (project.masks ?? []).find((x) => x.id === id);
      if (m && (clock.get() < m.start || clock.get() >= m.end)) clock.set(m.start);
    },
    onAddShape: addShape,
    screenshots: IS_DESKTOP ? screenshots : [],
    onInsertScreenshot: (p) => void insertScreenshot(p),
    retakes: suggestions.filter((s) => s.kind === "retake"),
    playhead: () => clock.get(),
    onMarkRetake: markRetake,
    onReplace: (m, from) => void chooseReplacement(m, from),
    canReplaceFromRecording: IS_DESKTOP,
    replaceBusy,
  };

  let dialog: ReactNode = null;
  if (pending) {
    const removed = pending.mark.end - pending.mark.start;
    const delta = pending.duration - removed;
    dialog = (
      <Dialog title="Review the replacement" onClose={cancelReplace} wide>
        <div className="space-y-3 text-sm">
          <video src={pending.clipSource.url} controls className="max-h-[40vh] w-full rounded-xl bg-black" />
          <ul className="space-y-1 text-xs text-muted">
            <li>
              Replaces {formatTime(pending.mark.start, true)}–{formatTime(pending.mark.end, true)} ({removed.toFixed(1)} s) with “{pending.label}” ({pending.duration.toFixed(1)} s).
            </li>
            <li>
              The timeline gets {Math.abs(delta).toFixed(1)} s {delta >= 0 ? "longer" : "shorter"}; everything after it moves to fit.
            </li>
            <li>
              {pending.audio.length || pending.overlays.length
                ? `The retake brings its own ${[pending.audio.length ? "audio" : "", pending.overlays.length ? "webcam" : ""].filter(Boolean).join(" and ")}, kept in sync.`
                : "The retake's own sound plays with it."}{" "}
              Audio and layers of the replaced section are removed with it.
            </li>
            <li>The original recording files are not changed. Undo restores the previous edit.</li>
          </ul>
          <div className="flex gap-2">
            <ActionButton tone="accent" onClick={commitReplace}>
              Replace
            </ActionButton>
            <ActionButton onClick={cancelReplace}>Cancel</ActionButton>
          </div>
        </div>
      </Dialog>
    );
  }

  return { panelProps, dialog, acts, setTab };
}

function pickVideoFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
