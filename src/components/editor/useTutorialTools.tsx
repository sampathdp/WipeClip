"use client";

/** Phase 3 tutorial tools wired to the editor: suggestion review (silence,
 * dead time, interaction insights) with ripple cuts, chapters, shortcut
 * indicators, privacy masks, annotations, recording screenshots and the
 * retake/replace workflow. Everything edits Project data through `apply`
 * (one undo step per action); nothing changes the source files.
 */
import { modKey } from "@/lib/platform/keys";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_SILENCE, detectAudio, measureLevels, type AudioLevels, type AudioReport, type AudioSpan } from "@/lib/editor/audioAnalysis";
import { breathsForTrack, breathsOutsideWords, findBreaths, type BreathSpan } from "@/lib/editor/breaths";
import type { AutoCleanupOptions, AutoCleanupResult } from "@/lib/editor/cleanupPlan";
import { ActivityCache, screenPieces, type ScreenPiece } from "@/lib/editor/screenActivity";
import { buildSpeechMix } from "@/lib/editor/captions";
import { timelineTimeOf } from "@/lib/editor/camera";
import { DEFAULT_CHAPTERS, suggestChapters } from "@/lib/editor/chapters";
import { acceptedCuts, cutCandidates, interactionTimeline, previewSkips, suggestEdits, type Act } from "@/lib/editor/insights";
import { fillersSupported, speechAwarePauses, transcriptSuggestions } from "@/lib/editor/speechEdits";
import { findHesitations, hesitationSuggestions, type Hesitation } from "@/lib/editor/hesitations";
import { transcriptCurrent } from "@/lib/editor/wordEdit";
import { DEFAULT_KEYSTROKES, comboCounts, keystrokeOverlays, type KeystrokeSettings } from "@/lib/editor/keystrokes";
import { loadVideoMeta } from "@/lib/editor/media";
import { recordingEvents } from "@/lib/editor/pointer";
import { rippleCut, rippleReplace } from "@/lib/editor/ripple";
import { SHAPE_WIDTH, defaultShape } from "@/lib/editor/shapes";
import { layout, locate, newId, formatTime, type Layout } from "@/lib/editor/timeline";
import { captionCues, chapterList, chaptersVtt } from "@/lib/editor/transcript";
import { newClip, type CameraZoom, type Chapter, type EditSuggestion, type MaskMode, type MediaSource, type Overlay, type PrivacyMask, type Project, type Selection, type ShapeType } from "@/lib/editor/types";
import { IS_DESKTOP, saveTextFile } from "@/lib/platform";
import { recordingOpen, recordingRead } from "@/lib/platform/recorder";
import { loadRecordingBundle, recoverRecording } from "@/lib/recorder/bundle";
import { recordingToSources } from "@/lib/recorder/editorImport";
import { parseManifest } from "@/lib/recorder/format";
import { planRecordingProject } from "@/lib/recorder/importPlan";
import { ApiError, ContentBlockedError, engineSceneAnalyze, probeVideo, videoActivity } from "@/lib/toolsApi";
import { PRIVACY_LABELS, sourceToCanvas, understand, type ScreenAnalysis, type Understanding } from "@/lib/editor/sceneAnalysis";
import { matteInput } from "@/lib/editor/matte";
import { DEFAULT_TEXT } from "@/lib/editor/textRaster";
import { canvasSize } from "@/lib/editor/timeline";
import Dialog from "./Dialog";
import { ActionButton } from "./Inspector";
import type { DraftSettings, ReviewSettings, TutorialPanelProps, TutorialTab } from "./TutorialPanel";
import { applyDraft, buildDraft, draftSkips, isStale, setDraftStatus, timelineKey } from "@/lib/editor/draft";
import { FOCUS_PRESETS, analyzeFocus } from "@/lib/editor/focus";
import { eventsForSuggestions, focusPrefs } from "@/lib/editor/focusPrefs";

interface Deps {
  /** Longest timeline the plan makes a Draft for, in seconds (entitlements.ts); null = any. */
  maxDraftSeconds: number | null;
  /** The plan's name, for the upgrade message. */
  planLabel: string;
  /** Opens Clean up audio (VideoEditor). */
  onOpenCleanup: () => void;
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

/** What the speech mix (captions.ts buildSpeechMix) is made of: the clips
 * and audio tracks with their timing and volume, and which files they play.
 * Over-inclusive on purpose - a change that doesn't affect the sound only
 * costs a new mix. */
export function mixKey(lay: Layout, project: Project, sources: Record<string, MediaSource>): string {
  const files = Object.values(sources).map((s) => [s.id, s.kind, s.duration, s.disk?.path ?? null, s.disk?.size ?? s.file?.size ?? null, s.hasAudio]);
  return JSON.stringify([lay.fps, lay.total, project.clips, project.audio, files]);
}

export function useTutorialTools(d: Deps) {
  const { project, lay, sources, recSource, clock, apply, say, maxDraftSeconds, planLabel } = d;
  const [tab, setTab] = useState<TutorialTab>("review");
  const [analysis, setAnalysis] = useState<string | null>(null);
  const analysisRun = useRef(0);
  const analysisCtrl = useRef<AbortController | null>(null);
  useEffect(() => () => analysisCtrl.current?.abort(), []);
  const lastReport = useRef<AudioReport | null>(null);
  const levelsCache = useRef<{
    key: string;
    levels: AudioLevels | null;
    hesitations: Hesitation[];
    breaths: BreathSpan[];
    /** The audio tracks mixed in as speech (captions.ts buildSpeechMix). */
    speechTracks: string[];
    clipping: AudioSpan[];
    skipped: string[];
  } | null>(null);
  const activity = useRef(new ActivityCache());
  const [previewingCuts, setPreviewingCuts] = useState(false);
  const [keySettings, setKeySettings] = useState<KeystrokeSettings>(DEFAULT_KEYSTROKES);
  const [replaceBusy, setReplaceBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingReplace | null>(null);

  // --- scene analysis (sceneAnalysis.ts; the engine reads the screen) ---------
  /** The latest analysis of the main video and what was made of it. Kept
   * for this session; the engine caches the analysis itself, so running it
   * again on the same file is instant. */
  const [scene, setScene] = useState<{ key: string; sourceId: string; analysis: ScreenAnalysis; understanding: Understanding } | null>(null);
  const screenSource = recSource ?? (project.clips[0] ? sources[project.clips[0].sourceId] : undefined);

  const events = recordingEvents(recSource);
  const acts: Act[] | null = useMemo(() => (recSource && events ? interactionTimeline(lay, recSource.id, events) : null), [lay, recSource, events]);
  const isMac = recSource?.recording?.manifest.app?.platform === "macos";
  const suggestions = useMemo(() => project.suggestions ?? [], [project.suggestions]);
  const skipRanges = useMemo(() => {
    if (!previewingCuts) return [];
    const all = [...previewSkips(suggestions), ...draftSkips(project.draft, lay)].sort((a, b) => a.start - b.start);
    const out: { start: number; end: number }[] = [];
    for (const r of all) {
      const last = out[out.length - 1];
      if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
      else out.push({ ...r });
    }
    return out;
  }, [previewingCuts, suggestions, project.draft, lay]);

  // --- review -----------------------------------------------------------------
  /** Cut and review suggestions for the current timeline (sound levels,
   * picture check, interaction events). null when a newer run took over.
   * Throws AbortError when cancelled. Shared by Review > Analyze and the
   * draft. */
  const reviewSuggestions = useCallback(
    async (s: ReviewSettings, run: number, signal: AbortSignal): Promise<{ list: EditSuggestion[]; notes: string[]; nothing: boolean } | null> => {
      const t0 = performance.now();
      {
        // The mix's levels are reused while the timeline's sound is the same
        // (only the settings changed, or edits that don't touch the sound).
        const key = mixKey(lay, project, sources);
        let cached = levelsCache.current?.key === key ? levelsCache.current : null;
        const reused = cached !== null;
        if (!cached) {
          setAnalysis("Mixing the timeline's audio…");
          const mix = await buildSpeechMix(lay, project, sources, { withClipping: true, signal });
          if (run !== analysisRun.current) return null;
          cached = {
            key,
            levels: mix.samples ? measureLevels(mix.samples) : null,
            hesitations: mix.samples ? findHesitations(mix.samples) : [],
            breaths: mix.samples ? findBreaths(mix.samples) : [],
            speechTracks: mix.tracks,
            clipping: mix.clipping,
            skipped: mix.skipped,
          };
          levelsCache.current = cached;
        }
        setAnalysis("Analyzing…");
        await new Promise((r) => setTimeout(r, 0));
        if (run !== analysisRun.current) return null;
        const report = cached.levels ? detectAudio(cached.levels, s.silence, cached.clipping) : null;
        lastReport.current = report;
        const notes: string[] = [];
        if (cached.skipped.length) notes.push(`${cached.skipped.join(", ")} ${cached.skipped.length === 1 ? "is" : "are"} too large to analyze for sound.`);
        if (!report && !acts) return { list: [], notes, nothing: true };
        // Silences that could become cuts: check whether the picture moves
        // (local engine; each file range measured once per session).
        let checked = false;
        const pieces = new Map<string, ScreenPiece[]>();
        if (report) {
          for (const c of cutCandidates(report, acts)) pieces.set(`${c.start}|${c.end}`, screenPieces(lay, sources, c.start, c.end));
          const todo = activity.current.missing([...pieces.values()].flat());
          const byPath = new Map<string, ScreenPiece[]>();
          for (const p of todo) byPath.set(p.path, [...(byPath.get(p.path) ?? []), p]);
          let done = 0;
          try {
            for (const [path, list] of byPath) {
              for (let i = 0; i < list.length; i += 10) {
                const batch = list.slice(i, i + 10);
                setAnalysis(`Checking the picture in quiet parts… ${Math.round((done / todo.length) * 100)}%`);
                const res = await videoActivity(path, batch.map((p) => [p.sourceStart, p.sourceEnd]), signal);
                if (run !== analysisRun.current) return null;
                if (!res) break; // no local engine
                res.forEach((v, k) => activity.current.set(batch[k], v));
                done += batch.length;
              }
            }
          } catch (e) {
            if ((e as Error)?.name === "AbortError") throw e;
            console.warn("[review] picture check failed", e);
          }
          checked = [...pieces.values()].some((ps) => activity.current.share(ps) !== null);
        }
        const motion = (start: number, end: number) => {
          const ps = pieces.get(`${start}|${end}`);
          return ps ? activity.current.share(ps) : null;
        };
        const aspect = recSource ? recSource.width / Math.max(1, recSource.height) : 16 / 9;
        let list = suggestEdits({ lay, acts, audio: report, motion }, { silence: s.silence, idle: s.idle, aspect }, () => newId("sg"));
        // With a transcript that still matches the edit: filler words,
        // repeats, and pauses checked against what was actually said.
        const transcript = project.transcript;
        if (transcript && transcriptCurrent(transcript, lay)) {
          const sg = () => newId("sg");
          list = [...speechAwarePauses(list, transcript, report?.silences ?? null, sg), ...transcriptSuggestions(transcript, sg)].sort((a, b) => a.start - b.start);
          if (!fillersSupported(transcript.language))
            notes.push("Filler words are only recognized in English text; held sounds like “aaa” or “mmm” are found from the sound in any language.");
        } else {
          notes.push(
            transcript
              ? "The transcript no longer matches the edit, so filler words and repeats weren't checked. Transcribe again in the Transcript panel."
              : "Transcribe the speech (Transcript panel) to also find filler words, repeated words and quiet speech."
          );
        }
        // Held sounds ("aaa", "eee", "mmm"), from the sound, checked against
        // the transcript when it still matches.
        if (cached.hesitations.length) {
          const current = transcript && transcriptCurrent(transcript, lay) ? transcript : null;
          list = [...list, ...hesitationSuggestions(cached.hesitations, current, list, () => newId("sg"))].sort((a, b) => a.start - b.start);
        }
        if (run !== analysisRun.current) return null;
        console.info(`[review] analysis took ${Math.round(performance.now() - t0)} ms (levels ${reused ? "reused" : "measured"}, picture ${checked ? "checked" : "not checked"})`);
        if (pieces.size && !checked) notes.push("Quiet parts couldn't be checked for movement on screen here, so watch them before cutting.");
        return { list, notes, nothing: false };
      }
    },
    [lay, project, sources, acts, recSource]
  );

  const analyze = useCallback(
    async (s: ReviewSettings) => {
      const run = ++analysisRun.current;
      analysisCtrl.current?.abort();
      const ctrl = new AbortController();
      analysisCtrl.current = ctrl;
      try {
        const r = await reviewSuggestions(s, run, ctrl.signal);
        if (!r) return;
        const tail = r.notes.length ? ` ${r.notes.join(" ")}` : "";
        if (r.nothing) {
          say(tail ? `Nothing to analyze.${tail}` : "There's no sound or recorded interaction to analyze.");
          return;
        }
        const list = r.list;
        apply((p) => ({ ...p, suggestions: [...(p.suggestions ?? []).filter((x) => x.kind === "retake"), ...list] }));
        const cuts = list.filter((x) => x.action === "cut").length;
        say(
          (list.length
            ? `${list.length} suggestion${list.length === 1 ? "" : "s"} (${cuts} possible cut${cuts === 1 ? "" : "s"}). Nothing changes until you accept.`
            : "Nothing stood out. Your recording looks tight.") + tail
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
    [reviewSuggestions, apply, say]
  );

  /** Reads the screen of the main video (engine) and makes events, scenes
   * and suggestions of it. Null when it can't run here. */
  const runScene = useCallback(
    async (level: "quick" | "thorough", signal: AbortSignal, run: number): Promise<{ analysis: ScreenAnalysis; understanding: Understanding } | null> => {
      const src = screenSource;
      if (!IS_DESKTOP || !src || (!src.disk && !src.file)) return null;
      const clicks: [number, number, number][] = (src === recSource && events ? events : [])
        .filter((e) => e.type === "button" && e.down && e.x >= 0 && e.x <= 1 && e.y >= 0 && e.y <= 1)
        .map((e) => [e.t / 1000, (e as { x: number }).x, (e as { y: number }).y]);
      const label = (stage: "scan" | "read", v: number) =>
        setAnalysis(stage === "scan" ? `Scanning the screen… ${Math.round(v * 100)}%` : `Reading the screen (on this computer)… ${Math.round(v * 100)}%`);
      setAnalysis("Scanning the screen…");
      const analysis = (await engineSceneAnalyze(matteInput(src), level, clicks, src.duration, label, signal)) as ScreenAnalysis;
      if (run !== analysisRun.current) return null;
      const understanding = understand(
        { analysis, sourceId: src.id, lay, events: src === recSource ? events : null, cues: captionCues(project.overlays) },
        (prefix) => newId(prefix)
      );
      setScene({ key: timelineKey(lay), sourceId: src.id, analysis, understanding });
      return { analysis, understanding };
    },
    [screenSource, recSource, events, lay, project.overlays]
  );

  /** "Analyze the screen" on its own (the Scenes tab). */
  const analyzeScreen = useCallback(
    async (level: "quick" | "thorough") => {
      const run = ++analysisRun.current;
      analysisCtrl.current?.abort();
      const ctrl = new AbortController();
      analysisCtrl.current = ctrl;
      try {
        const res = await runScene(level, ctrl.signal, run);
        if (!res) {
          if (run === analysisRun.current) say("Screen analysis runs in the desktop app, on a video in the project.");
          return;
        }
        const n = res.understanding.scenes.length;
        say(`${n} scene${n === 1 ? "" : "s"} found. Generate a draft to review chapters, cuts, annotations and privacy suggestions.`);
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        say(e instanceof ApiError ? e.message : "The screen couldn't be analyzed. Your project hasn't changed.");
      } finally {
        if (run === analysisRun.current) setAnalysis(null);
        if (analysisCtrl.current === ctrl) analysisCtrl.current = null;
      }
    },
    [runScene, say]
  );

  /** Annotation text layers for the suggestions, placed by the clicked
   * spot on the canvas (or low on the screen), in the editor's text style. */
  const annotationLayers = useCallback(
    (u: Understanding, sourceId: string) => {
      const src = sources[sourceId];
      const clip = project.clips.find((c) => c.sourceId === sourceId);
      const original = sources[project.clips[0]?.sourceId ?? ""];
      if (!src || !clip || !original) return [];
      const canvas = canvasSize(project.canvas.aspect, original.width, original.height);
      return u.annotations.map((a) => {
        const at = sourceToCanvas(clip, src, canvas, project.canvas, a.at.x, a.at.y);
        // Under the clicked spot when there's room, else above it.
        const y = at.y < 0.8 ? Math.min(0.92, at.y + 0.08) : at.y - 0.08;
        const overlay: Overlay = {
          id: newId("ovl"),
          kind: "text",
          start: Math.round(a.start * 100) / 100,
          end: Math.round(Math.min(lay.total, a.end) * 100) / 100,
          x: Math.max(0.15, Math.min(0.85, at.x)),
          y,
          width: 0.25,
          rotation: 0,
          opacity: 1,
          animIn: "fade",
          animOut: "fade",
          hidden: false,
          locked: false,
          text: { ...DEFAULT_TEXT, content: a.text, size: 0.04, background: "#000000", backgroundOpacity: 0.7 },
        };
        return { overlay, title: `Annotation: ${a.text}`, detail: a.evidence, confidence: (a.confidence >= 0.75 ? "high" : a.confidence >= 0.5 ? "medium" : "low") as "high" | "medium" | "low" };
      });
    },
    [sources, project.clips, project.canvas, lay.total]
  );

  // --- draft ----------------------------------------------------------------------
  /** Record -> Analyze -> Review: zooms, click highlights, cuts, review
   * items and chapters in one reviewable draft (draft.ts). Generating is
   * one undo step; nothing else changes until the draft is applied. */
  const generateDraft = useCallback(
    async (ds: DraftSettings) => {
      const inputsKey = JSON.stringify([mixKey(lay, project, sources), timelineKey(lay), recSource?.id ?? null, events?.length ?? 0, project.focus ?? null, captionCues(project.overlays).length, ds]);
      if (project.draft && !project.draft.appliedAt && project.draft.inputsKey === inputsKey) {
        say("The draft is up to date: nothing it's based on has changed.");
        return;
      }
      if (maxDraftSeconds !== null && lay.total > maxDraftSeconds + 0.5) {
        say(
          `Your ${planLabel} plan makes a Draft for videos up to ${Math.round(maxDraftSeconds / 60)} minutes, and this one is ${Math.ceil(lay.total / 60)} minutes. Upgrade to Starter for any length, or trim it first.`
        );
        return;
      }
      const run = ++analysisRun.current;
      analysisCtrl.current?.abort();
      const ctrl = new AbortController();
      analysisCtrl.current = ctrl;
      const notes: string[] = [];
      try {
        let zooms: CameraZoom[] = [];
        let clicks = 0;
        if ((ds.zooms || ds.highlights) && recSource && events) {
          const prefs = focusPrefs(project);
          const usable = eventsForSuggestions(events, recSource.id, prefs);
          clicks = usable.filter((e) => e.type === "button" && e.down && e.x >= 0 && e.x <= 1 && e.y >= 0 && e.y <= 1).length;
          if (ds.zooms) {
            const res = await analyzeFocus(
              { events: usable, duration: recSource.duration, aspect: recSource.width / Math.max(1, recSource.height), sourceId: recSource.id },
              FOCUS_PRESETS[ds.preset],
              () => newId("zm"),
              { signal: ctrl.signal, onProgress: (pr) => pr.stage !== "done" && setAnalysis(pr.stage === "reading" ? "Reading the recorded interactions…" : "Finding focus points…") }
            );
            if (run !== analysisRun.current) return;
            zooms = res.zooms;
          }
        } else if (ds.zooms || ds.highlights) {
          notes.push("No recorded mouse activity that can be placed on the video, so no zooms or click highlights.");
        }
        let suggestions: EditSuggestion[] = [];
        if (ds.cuts) {
          const r = await reviewSuggestions(ds.review, run, ctrl.signal);
          if (!r) return;
          suggestions = r.list;
          notes.push(...r.notes);
        }
        // Reading the screen: scenes give chapters titled from what was on
        // screen, waiting to cut, annotations and privacy masks.
        let screen: { analysis: ScreenAnalysis; understanding: Understanding } | null = null;
        if (ds.screen && IS_DESKTOP) {
          try {
            screen = await runScene(ds.screenLevel, ctrl.signal, run);
          } catch (e) {
            if ((e as Error)?.name === "AbortError") return;
            notes.push(e instanceof ApiError ? `The screen wasn't read: ${e.message}` : "The screen couldn't be read, so this draft is based on timing, sound and recorded events only.");
          }
          if (run !== analysisRun.current) return;
          if (screen) {
            const st = screen.analysis.stats;
            notes.push(
              `Screen read on this computer: ${st.framesRead} moment${st.framesRead === 1 ? "" : "s"} where the screen settled, ${st.clicksRead} click${st.clicksRead === 1 ? "" : "s"} (${(st.scanSeconds + st.readSeconds).toFixed(0)} s). Only English and other Latin-script text is read.`
            );
            if (screen.understanding.masks.length)
              notes.push("Privacy suggestions can miss things (small, blurred or moving text, pictures) and can be wrong. Check each one, and watch the recording before you publish.");
          }
        }
        const fromScreen = screen && ds.chapters && screen.understanding.chapters.length > 0;
        const chapters = !ds.chapters
          ? []
          : fromScreen
            ? screen!.understanding.chapters
            : suggestChapters({ acts, cues: captionCues(project.overlays), audio: lastReport.current, total: lay.total }, DEFAULT_CHAPTERS, () => newId("ch"));
        if (screen && ds.cuts) suggestions = [...suggestions, ...screen.understanding.cuts];
        if (run !== analysisRun.current) return;
        const draft = buildDraft(
          {
            lay,
            project,
            zooms,
            suggestions,
            chapters,
            clicks: ds.highlights ? clicks : 0,
            inputsKey,
            notes,
            ...(fromScreen ? { chapterDetail: "Where the screen moved on to something else, titled with what was read there (a heading, an app, an address, a command) or said." } : {}),
            ...(screen && ds.annotations ? { annotations: annotationLayers(screen.understanding, screenSource!.id) } : {}),
            ...(screen && ds.privacy
              ? {
                  masks: screen.understanding.masks.map((m) => ({
                    mask: m.mask,
                    title: `Hide: ${PRIVACY_LABELS[m.category]}`,
                    detail: `${m.reason}. Covers it for as long as that part of the screen stays as it is - check that it's the right spot.`,
                    confidence: (m.confidence >= 0.8 ? "high" : m.confidence >= 0.55 ? "medium" : "low") as "high" | "medium" | "low",
                  })),
                }
              : {}),
          },
          () => newId("di")
        );
        apply((p) => ({ ...p, draft }));
        setTab("draft");
        say(draft.items.length ? `Draft ready: ${draft.items.length} suggestion${draft.items.length === 1 ? "" : "s"} to review. Nothing has changed yet.` : "The draft found nothing to suggest.");
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        console.error("[draft] generation failed", e);
        say("The draft couldn't be made. Your project hasn't changed.");
      } finally {
        if (run === analysisRun.current) setAnalysis(null);
        if (analysisCtrl.current === ctrl) analysisCtrl.current = null;
      }
    },
    [lay, project, sources, recSource, events, acts, reviewSuggestions, apply, say, runScene, annotationLayers, screenSource, maxDraftSeconds, planLabel]
  );

  /** Frame previews for draft items (privacy: with the spot marked), from
   * this session's analysis. */
  const draftPreviews = useMemo(() => {
    const out: Record<string, { src: string; box?: [number, number, number, number] }> = {};
    const d = project.draft;
    if (!d || !scene) return out;
    const byMask = new Map(scene.understanding.masks.map((m) => [m.mask.id, m]));
    for (const i of d.items) {
      if (i.kind === "privacy" && i.mask) {
        const m = byMask.get(i.mask.id);
        const f = m ? scene.analysis.frames[m.frame] : undefined;
        if (f) out[i.id] = { src: f.preview, box: [i.mask.x, i.mask.y, i.mask.w, i.mask.h] };
      }
    }
    return out;
  }, [project.draft, scene]);

  const applyDraftNow = useCallback(() => {
    const res = applyDraft(project, lay.fps);
    if ("error" in res) {
      say(res.error);
      return;
    }
    apply(() => res.project);
    const a = res.applied;
    const parts = [
      a.cut && `${a.cut} cut${a.cut === 1 ? "" : "s"}`,
      a.zoom && `${a.zoom} zoom${a.zoom === 1 ? "" : "s"}`,
      a.highlights && "click highlights",
      a.chapter && `${a.chapter} chapter${a.chapter === 1 ? "" : "s"}`,
      a.review && `${a.review} item${a.review === 1 ? "" : "s"} to review`,
      a.annotation && `${a.annotation} annotation${a.annotation === 1 ? "" : "s"}`,
      a.privacy && `${a.privacy} privacy mask${a.privacy === 1 ? "" : "s"}`,
    ].filter(Boolean);
    say(`Applied ${parts.join(", ") || "nothing"}.${res.skipped.length ? ` ${res.skipped.join(" ")}` : ""} Undo with ${modKey()}+Z.`);
  }, [project, lay.fps, apply, say]);

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
      say(`Removed ${removed.toFixed(1)} s. Undo with ${modKey()}+Z if it doesn't feel right.`);
      return true;
    },
    [project, lay.fps, apply, say]
  );

  /** Clean up audio's edits (CleanupDialog): analyzes the timeline like
   * Review > Analyze, then in one undo step turns the breaths down on the
   * speech tracks and cuts the chosen kinds of suggestions - those that
   * aren't low confidence. Everything else stays in Review to look at.
   * null when cancelled or superseded. */
  const autoCleanup = useCallback(
    async (o: AutoCleanupOptions): Promise<AutoCleanupResult | null> => {
      const run = ++analysisRun.current;
      analysisCtrl.current?.abort();
      const ctrl = new AbortController();
      analysisCtrl.current = ctrl;
      try {
        const r = await reviewSuggestions({ silence: DEFAULT_SILENCE, idle: 10 }, run, ctrl.signal);
        if (!r || run !== analysisRun.current) return null;
        const cached = levelsCache.current;
        const transcript = project.transcript && transcriptCurrent(project.transcript, lay) ? project.transcript : null;
        const kinds = new Set<EditSuggestion["kind"]>([
          ...(o.silences ? (["silence"] as const) : []),
          ...(o.hesitations ? (["hesitation"] as const) : []),
          ...(o.fillers ? (["filler"] as const) : []),
          ...(o.stutters ? (["repeat"] as const) : []),
        ]);
        const chosen = r.list.filter((s) => s.action === "cut" && kinds.has(s.kind) && s.confidence !== "low");
        const rest = r.list.filter((s) => !chosen.includes(s));
        let next: Project = { ...project, suggestions: [...(project.suggestions ?? []).filter((x) => x.kind === "retake"), ...rest] };
        let breaths = 0;
        if (o.breaths && cached) {
          const spans = breathsOutsideWords(cached.breaths, transcript);
          const voice = new Set(cached.speechTracks);
          next = {
            ...next,
            audio: next.audio.map((a) => {
              if (!voice.has(a.id)) return a;
              const b = breathsForTrack(a, spans);
              breaths += b.length;
              return { ...a, breaths: b.length ? b : undefined };
            }),
          };
        }
        let removed = 0;
        for (const c of acceptedCuts(chosen.map((s) => ({ ...s, status: "accepted" as const })))) {
          const res = rippleCut(next, layout(next, lay.fps), c.start, c.end);
          if (!res.ok) {
            say(res.error);
            return null;
          }
          next = res.project;
          removed += res.removed;
        }
        apply(() => next);
        const count = (k: EditSuggestion["kind"]) => chosen.filter((s) => s.kind === k).length;
        return {
          removed,
          silences: count("silence"),
          hesitations: count("hesitation"),
          fillers: count("filler"),
          stutters: count("repeat"),
          breaths,
          toReview: rest.filter((s) => s.action === "cut" && s.status === "pending").length,
          notes: r.notes,
        };
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return null;
        throw e;
      } finally {
        if (run === analysisRun.current) setAnalysis(null);
        if (analysisCtrl.current === ctrl) analysisCtrl.current = null;
      }
    },
    [reviewSuggestions, project, lay, apply, say]
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
    say(`Replaced ${formatTime(mark.start)}–${formatTime(mark.end)}. Undo with ${modKey()}+Z.`);
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
    onOpenCleanup: d.onOpenCleanup,
    onRemoveFillers: () => {
      const fillers = suggestions.filter((s) => s.status === "pending" && s.action === "cut" && (s.kind === "filler" || s.kind === "hesitation") && s.confidence !== "low").map((s) => ({ ...s, status: "accepted" as const }));
      cut(acceptedCuts(fillers));
    },
    onClearSuggestions: () => apply((p) => ({ ...p, suggestions: (p.suggestions ?? []).filter((s) => s.kind === "retake") })),
    previewingCuts,
    onPreviewCuts: setPreviewingCuts,
    screenAvailable: IS_DESKTOP && !!screenSource && (!!screenSource.disk || !!screenSource.file),
    scene: scene && scene.key === timelineKey(lay) ? scene : null,
    onAnalyzeScreen: (level) => void analyzeScreen(level),
    draftPreviews,
    draft: project.draft ?? null,
    draftStale: project.draft ? isStale(project.draft, lay) : false,
    onGenerateDraft: (s) => void generateDraft(s),
    onDraftStatus: (status, which) => apply((p) => (p.draft ? { ...p, draft: setDraftStatus(p.draft, status, which) } : p)),
    onApplyDraft: applyDraftNow,
    onDiscardDraft: () => apply((p) => { const { draft: _drop, ...rest } = p; void _drop; return rest; }),
    onSeek: (t) => clock.set(Math.max(0, Math.min(lay.total, t))),
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

  return { panelProps, dialog, acts, setTab, skipRanges, autoCleanup };
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
