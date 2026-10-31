"use client";

/** Highlight suggestions wired to the editor (src/lib/editor/highlights.ts):
 * measuring the sound, the picture (local engine) and the recorded inputs,
 * keeping the results with the project, previewing, editing, rejecting and
 * exporting a highlight on its own. Nothing here changes the timeline:
 * exporting renders a copy of the project that holds only the highlight.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { measureLevels, type AudioLevels } from "@/lib/editor/audioAnalysis";
import { buildSpeechMix } from "@/lib/editor/captions";
import { timelineTimeOf } from "@/lib/editor/camera";
import type { Clock } from "@/lib/editor/clock";
import { timelineKey } from "@/lib/editor/draft";
import {
  DEFAULT_HIGHLIGHTS,
  buildHighlightSet,
  editHighlight,
  anchorFor,
  findHighlights,
  highlightProject,
  pictureOnTimeline,
  placeHighlights,
  profileChunks,
  renameHighlight,
  setHighlightStatus,
  speechFromWords,
  workflowSettings,
  WORKFLOWS,
  type HighlightSettings,
  type HighlightWorkflow,
} from "@/lib/editor/highlights";
import { transcriptCurrent } from "@/lib/editor/wordEdit";
import { interactionTimeline } from "@/lib/editor/insights";
import { recordingEvents } from "@/lib/editor/pointer";
import { newId, type Layout } from "@/lib/editor/timeline";
import type { Highlight, HighlightSet, MediaSource, Project } from "@/lib/editor/types";
import { videoMotion } from "@/lib/toolsApi";
import { mixKey } from "./useTutorialTools";

type Profile = { times: number[]; motion: number[]; scene: number[] };

/** Motion profiles per file chunk, for the session (highlights.ts PROFILE_CHUNK). */
const profiles = new Map<string, Profile>();
const VIDEO_KINDS = new Set<MediaSource["kind"]>(["original", "cleaned", "take"]);

interface Deps {
  project: Project;
  lay: Layout;
  sources: Record<string, MediaSource>;
  recSource: MediaSource | undefined;
  clock: Clock;
  apply: (fn: (p: Project) => Project, record?: boolean) => void;
  say: (m: string) => void;
  setPlaying: (v: boolean) => void;
  openExport: (clip: { project: Project; total: number; title: string; nameSuffix: string }) => void;
  /** Several highlights as separate files (BatchExportDialog). */
  openBatchExport: (items: { id: string; title: string; project: Project; fileName: string }[], vertical: boolean) => void;
}

export interface HighlightsPanelProps {
  set: HighlightSet | null;
  stale: boolean;
  busy: string | null;
  settings: HighlightSettings;
  onSettings: (s: HighlightSettings) => void;
  onFind: () => void;
  onCancel: () => void;
  onPreview: (h: Highlight) => void;
  onStatus: (h: Highlight, status: Highlight["status"]) => void;
  onRange: (h: Highlight, start: number, end: number) => void;
  onExport: (h: Highlight) => void;
  /** Exports these highlights (kept, not out of date) as separate files. */
  onExportBatch: (ids: string[]) => void;
  onRename: (h: Highlight, title: string) => void;
  onWorkflow: (w: HighlightWorkflow) => void;
  /** Highlights whose footage changed since (preview and export are off). */
  outdated: number;
  onMark: () => void;
  onClear: () => void;
  playhead: () => number;
  total: number;
  previewing: string | null;
}

export function useHighlights(d: Deps): HighlightsPanelProps {
  const { project, lay, sources, recSource, clock, apply, say, setPlaying, openExport, openBatchExport } = d;
  const [settings, setSettings] = useState<HighlightSettings>(DEFAULT_HIGHLIGHTS);
  const [busy, setBusy] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const levelsCache = useRef<{ key: string; levels: AudioLevels | null } | null>(null);
  const stopPreview = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      ctrl.current?.abort();
      stopPreview.current?.();
    },
    []
  );

  const tlKey = useMemo(() => timelineKey(lay), [lay]);
  // The saved set placed on the current timeline: after trims, splits and
  // moves each highlight follows its footage or is marked out of date.
  const set = useMemo(() => (project.highlights ? placeHighlights(project.highlights, lay, tlKey) : null), [project.highlights, lay, tlKey]);
  const stale = !!project.highlights && project.highlights.timelineKey !== tlKey;
  const outdated = set?.items.filter((h) => h.outdated && h.status !== "rejected").length ?? 0;
  const events = recordingEvents(recSource);

  const find = useCallback(async () => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    const signal = c.signal;
    const t0 = performance.now();
    try {
      // Sound: the speech mix's levels (clip sound and recorded tracks, not music).
      const key = mixKey(lay, project, sources);
      if (levelsCache.current?.key !== key) {
        setBusy("Mixing the timeline's audio…");
        const mix = await buildSpeechMix(lay, project, sources, { signal });
        levelsCache.current = { key, levels: mix.samples ? measureLevels(mix.samples) : null };
      }
      const levels = levelsCache.current.levels;
      // Picture: motion profiles of the on-timeline parts of each file on disk.
      const clips = lay.clips.map((lc) => {
        const src = sources[lc.clip.sourceId];
        const path = src?.disk && VIDEO_KINDS.has(src.kind) && lc.clip.freeze === null ? src.disk.path : null;
        return { lc, src, path };
      });
      const needed: { path: string; a: number; b: number }[] = [];
      for (const { lc, src, path } of clips) {
        if (!path || !src) continue;
        const lo = Math.min(lc.clip.start, lc.clip.end);
        const hi = Math.max(lc.clip.start, lc.clip.end);
        for (const [a, b] of profileChunks(lo, hi)) {
          const k = `${path}|${a}`;
          if (!profiles.has(k) && !needed.some((n) => `${n.path}|${n.a}` === k)) needed.push({ path, a, b: Math.min(b, src.duration || b) });
        }
      }
      let measured = needed.length === 0;
      let engine = true;
      for (let i = 0; i < needed.length && engine; i++) {
        setBusy(`Measuring movement in the picture… ${Math.round((i / needed.length) * 100)}%`);
        const n = needed[i];
        if (n.b - n.a < 0.3) continue;
        const prof = await videoMotion(n.path, n.a, n.b, signal);
        if (!prof) engine = false;
        else {
          profiles.set(`${n.path}|${n.a}`, prof);
          measured = true;
        }
      }
      const byPath = new Map<string, Profile[]>();
      for (const [k, v] of profiles) {
        const path = k.slice(0, k.lastIndexOf("|"));
        byPath.set(path, [...(byPath.get(path) ?? []), v]);
      }
      const hasPicture = engine && measured && clips.some((x) => x.path);
      const picture = hasPicture
        ? pictureOnTimeline(
            clips.map(({ lc, path }) => ({ start: lc.start, duration: lc.duration, path, toTimeline: (s: number) => timelineTimeOf(lc, s) })),
            byPath
          )
        : null;
      const acts = recSource && events ? interactionTimeline(lay, recSource.id, events) : null;
      // Spoken stretches from the transcript while it matches the edit;
      // otherwise findHighlights estimates them from the sound.
      const speech = project.transcript && transcriptCurrent(project.transcript, lay) ? speechFromWords(project.transcript.words) : null;
      setBusy("Finding highlights…");
      await new Promise((r) => setTimeout(r, 0));
      if (signal.aborted) return;
      const inputsKey = JSON.stringify([key, settings, !!picture, acts?.length ?? 0, speech?.length ?? null, tlKey]);
      if (set && set.inputsKey === inputsKey) {
        say("Highlights are up to date: nothing changed since they were found.");
        return;
      }
      const result = findHighlights({ total: lay.total, levels, picture, acts, speech }, settings);
      console.info(`[highlights] ${result.items.length} found in ${Math.round(performance.now() - t0)} ms (picture ${picture ? "measured" : "not measured"})`);
      apply((p) => ({ ...p, highlights: buildHighlightSet(p.highlights, result, { timelineKey: tlKey, inputsKey, lay }, () => newId("hl")) }));
      say(result.items.length ? `${result.items.length} possible highlight${result.items.length === 1 ? "" : "s"}. Nothing in your timeline changes.` : "Nothing stood out.");
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        say("Stopped. Nothing changed.");
        return;
      }
      console.error("[highlights] failed", e);
      say("Finding highlights failed. Your project hasn't changed.");
    } finally {
      if (ctrl.current === c) {
        ctrl.current = null;
        setBusy(null);
      }
    }
  }, [lay, project, sources, recSource, events, settings, tlKey, set, apply, say]);

  // Edits apply to the set as placed on the current timeline.
  const updateSet = (fn: (s: HighlightSet) => HighlightSet, record = true) =>
    apply((p) => (p.highlights ? { ...p, highlights: fn(placeHighlights(p.highlights, lay, tlKey)) } : p), record);

  const OUTDATED = "This highlight's footage was cut or changed since it was found. Set its start and end again, or find highlights again.";

  const exportItem = (h: Highlight, index: number) => {
    const r = highlightProject(project, lay.fps, h.start, h.end);
    if (!r.ok) return r;
    const name = (h.title ?? "").replace(/[^p{L}p{N} _-]+/gu, "").trim().slice(0, 40);
    return { ok: true as const, item: { id: h.id, title: h.title ?? `Highlight ${index}`, project: r.project, fileName: `${name || `highlight-${index}`}.mp4` } };
  };

  const preview = (h: Highlight) => {
    if (h.outdated) {
      say(OUTDATED);
      return;
    }
    stopPreview.current?.();
    setPlaying(false);
    clock.set(h.start);
    setPreviewing(h.id);
    const unsub = clock.subscribe(() => {
      const t = clock.get();
      if (t >= h.end || t < h.start - 0.5) {
        if (t >= h.end) setPlaying(false);
        stop();
      }
    });
    const stop = () => {
      unsub();
      setPreviewing(null);
      stopPreview.current = null;
    };
    stopPreview.current = stop;
    setPlaying(true);
  };

  return {
    set,
    stale,
    busy,
    settings,
    onSettings: setSettings,
    onFind: () => void find(),
    onCancel: () => ctrl.current?.abort(),
    onPreview: preview,
    onStatus: (h, status) => updateSet((s) => setHighlightStatus(s, h.id, status)),
    onRange: (h, start, end) => updateSet((s) => editHighlight(s, h.id, start, end, lay.total, lay)),
    onRename: (h, title) => updateSet((s) => renameHighlight(s, h.id, title)),
    onWorkflow: (w) => setSettings(workflowSettings(w, settings.sensitivity)),
    outdated,
    onExportBatch: (ids) => {
      const visible = (set?.items ?? []).filter((x) => x.status !== "rejected");
      const chosen = visible.filter((h) => ids.includes(h.id) && !h.outdated);
      const items = [];
      for (const h of chosen) {
        const r = exportItem(h, visible.indexOf(h) + 1);
        if (!r.ok) {
          say(`${h.title ?? "A highlight"}: ${r.error}`);
          return;
        }
        items.push(r.item);
      }
      if (!items.length) {
        say("Keep some highlights first (out-of-date ones can't be exported).");
        return;
      }
      setPlaying(false);
      openBatchExport(items, !!WORKFLOWS[settings.workflow ?? "gameplay"].vertical);
    },
    onExport: (h) => {
      if (h.outdated) {
        say(OUTDATED);
        return;
      }
      const r = highlightProject(project, lay.fps, h.start, h.end);
      if (!r.ok) {
        say(r.error);
        return;
      }
      const index = (set?.items ?? []).filter((x) => x.status !== "rejected").indexOf(h) + 1;
      updateSet((s) => ({ ...s, stats: { ...s.stats, exported: s.stats.exported + 1 } }), false);
      setPlaying(false);
      openExport({ project: r.project, total: h.end - h.start, title: "Export highlight", nameSuffix: `highlight-${Math.max(1, index)}` });
    },
    onMark: () => {
      const t = clock.get();
      const h: Highlight = {
        id: newId("hl"),
        start: Math.max(0, t - settings.preRoll),
        end: Math.min(lay.total, t + settings.postRoll),
        peak: t,
        score: 1,
        confidence: "high",
        reasons: [{ signal: "marker", text: "You added this moment" }],
        status: "kept",
        title: "Your highlight",
      };
      if (h.end - h.start < 0.5) return;
      const anchor = anchorFor(lay, h.start, h.end);
      if (anchor) h.anchor = anchor;
      apply((p) => {
        // Earlier highlights are kept, placed on the current timeline.
        const base: HighlightSet = p.highlights
          ? placeHighlights(p.highlights, lay, tlKey)
          : { version: 1, createdAt: new Date().toISOString(), timelineKey: tlKey, inputsKey: "", items: [], notes: [], stats: { suggested: 0, kept: 0, rejected: 0, edited: 0, exported: 0 } };
        return { ...p, highlights: { ...base, items: [...base.items, h].sort((a, b) => a.start - b.start) } };
      });
    },
    onClear: () => apply((p) => ({ ...p, highlights: undefined })),
    playhead: () => clock.get(),
    total: lay.total,
    previewing,
  };
}
