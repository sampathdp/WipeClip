/** Ripple edits: removing or inserting a stretch of timeline time and
 * moving everything after it, so an accepted cut or a retake leaves no gap
 * and nothing out of sync. Pure - see tests/desktop/tutorial.test.ts.
 *
 * Video clips are cut by their own source mapping (speed, reverse,
 * freeze). Items with their own media - audio clips and video layers (a
 * recording's microphone, system audio and webcam) - are split so the part
 * after the cut still plays the right moment of its file. Other timed
 * items (text, captions, shortcuts, stickers, images, shapes, effects,
 * masks, chapters, suggestions) are shifted, trimmed or removed. Focus
 * zooms are stored in source time and follow the clips by themselves.
 *
 * Cuts and inserts that would touch a transition are refused rather than
 * guessing what the transition should become.
 */
import { newId, type Layout } from "./timeline.ts";
import type { AudioClip, Chapter, Clip, EditSuggestion, EffectClip, Overlay, PrivacyMask, Project } from "./types.ts";

export type RippleResult = { ok: true; project: Project; removed: number } | { ok: false; error: string };

const MIN_ITEM = 0.1;

function snap(t: number, fps: number) {
  return Math.round(t * fps) / fps;
}

/** Transition regions [from, to) on the timeline. */
function transitionRegions(lay: Layout): [number, number][] {
  const out: [number, number][] = [];
  lay.clips.forEach((c, i) => {
    if (c.transitionOut > 0 && i < lay.clips.length - 1) {
      const next = lay.clips[i + 1];
      out.push([next.start, next.start + c.transitionOut]);
    }
  });
  return out;
}

/** The part of `clip` that plays between `from` and `to` seconds into it
 * (timeline seconds, at the clip's speed). */
function clipPart(clip: Clip, from: number, to: number): Clip {
  const speed = clip.speed || 1;
  if (clip.freeze !== null) return { ...clip, start: 0, end: to - from };
  if (clip.reverse) return { ...clip, start: clip.end - to * speed, end: clip.end - from * speed };
  return { ...clip, start: clip.start + from * speed, end: clip.start + to * speed };
}

interface Timed {
  start: number;
  end: number;
}

/** Shift/trim/remove a plain timed item for removing [t0, t1). */
function cutPlain<T extends Timed>(item: T, t0: number, t1: number): T | null {
  const d = t1 - t0;
  if (item.end <= t0) return item;
  if (item.start >= t1) return { ...item, start: item.start - d, end: item.end - d };
  const start = item.start < t0 ? item.start : t0;
  const end = item.end > t1 ? item.end - d : t0;
  return end - start >= MIN_ITEM ? { ...item, start, end } : null;
}

/** Same for an item playing its own media from `offset`: the parts on
 * either side of the cut stay where their media is. */
function cutMedia<T extends Timed & { offset: number; id: string }>(item: T, t0: number, t1: number, rename: () => string): T[] {
  const d = t1 - t0;
  if (item.end <= t0) return [item];
  if (item.start >= t1) return [{ ...item, start: item.start - d, end: item.end - d }];
  const out: T[] = [];
  if (t0 - item.start >= MIN_ITEM) out.push({ ...item, end: t0 });
  if (item.end - t1 >= MIN_ITEM) {
    const skipped = t1 - item.start;
    out.push({ ...item, id: out.length ? rename() : item.id, start: t0, end: item.end - d, offset: item.offset + skipped });
  }
  return out;
}

const audioAsTimed = (a: AudioClip) => ({ ...a, end: a.start + a.duration });
const timedAsAudio = (a: AudioClip & { end: number }): AudioClip => {
  const { end, ...rest } = a;
  return { ...rest, duration: end - a.start };
};

export function rippleCut(project: Project, lay: Layout, from: number, to: number): RippleResult {
  const fps = lay.fps || 30;
  const t0 = Math.max(0, snap(Math.min(from, to), fps));
  const t1 = Math.min(lay.total, snap(Math.max(from, to), fps));
  if (t1 - t0 < 1 / fps) return { ok: false, error: "That range is too short to cut." };
  if (transitionRegions(lay).some(([a, b]) => t0 < b && t1 > a)) {
    return { ok: false, error: "This range touches a transition. Remove the transition or adjust the range first." };
  }
  const d = t1 - t0;

  const clips: Clip[] = [];
  for (const c of lay.clips) {
    const s = c.start;
    const e = c.start + c.duration;
    if (e <= t0 || s >= t1) {
      clips.push(c.clip);
      continue;
    }
    if (t0 - s >= 1 / fps) clips.push({ ...clipPart(c.clip, 0, t0 - s), transition: null });
    if (e - t1 >= 1 / fps) {
      const right = clipPart(c.clip, t1 - s, c.duration);
      clips.push(t0 - s >= 1 / fps ? { ...right, id: newId("clip") } : right);
    }
  }
  if (clips.length === 0) return { ok: false, error: "A project needs at least one clip - this would remove everything." };

  const overlays: Overlay[] = [];
  for (const o of project.overlays) {
    if (o.kind === "video") overlays.push(...cutMedia(o, t0, t1, () => newId("ovl")));
    else {
      const r = cutPlain(o, t0, t1);
      if (r) overlays.push(r);
    }
  }
  const audio: AudioClip[] = project.audio.flatMap((a) => cutMedia(audioAsTimed(a), t0, t1, () => newId("aud")).map(timedAsAudio));
  const effects = project.effects.map((e) => cutPlain(e, t0, t1)).filter((e): e is EffectClip => !!e);
  const masks = (project.masks ?? []).map((m) => cutPlain(m, t0, t1)).filter((m): m is PrivacyMask => !!m);
  const suggestions = (project.suggestions ?? [])
    .map((s) => cutPlain(s, t0, t1))
    .filter((s): s is EditSuggestion => !!s);
  const chapters: Chapter[] = [];
  for (const ch of project.chapters ?? []) {
    const t = ch.t < t0 ? ch.t : ch.t >= t1 ? ch.t - d : t0;
    if (!chapters.some((x) => Math.abs(x.t - t) < 0.5)) chapters.push({ ...ch, t });
  }

  // Words in the cut go; later ones move up (a word the cut runs into is
  // trimmed, like the other timed items).
  const transcript = project.transcript && {
    ...project.transcript,
    total: project.transcript.total - d,
    words: project.transcript.words.map((w) => cutPlain(w, t0, t1)).filter((w): w is NonNullable<typeof w> => !!w),
  };

  return {
    ok: true,
    removed: d,
    project: { ...project, clips, overlays, audio, effects, masks, suggestions, chapters, ...(transcript ? { transcript } : {}) },
  };
}

/** Inserts `inserted` clips (lasting `duration` timeline seconds) at
 * timeline time `at`, splitting the clip there and moving everything after
 * it; `extra` audio clips and overlays are already in timeline time. */
export function rippleInsert(
  project: Project,
  lay: Layout,
  atTime: number,
  inserted: Clip[],
  duration: number,
  extra: { audio?: AudioClip[]; overlays?: Overlay[] } = {}
): RippleResult {
  const fps = lay.fps || 30;
  const at = Math.max(0, Math.min(lay.total, snap(atTime, fps)));
  if (transitionRegions(lay).some(([a, b]) => at > a && at < b)) {
    return { ok: false, error: "The insert point is inside a transition. Move it or remove the transition first." };
  }
  const clips: Clip[] = [];
  let placed = false;
  for (const c of lay.clips) {
    const s = c.start;
    const e = c.start + c.duration;
    if (!placed && at <= s + 1e-9) {
      clips.push(...inserted);
      placed = true;
    }
    if (!placed && at < e - 1e-9) {
      clips.push({ ...clipPart(c.clip, 0, at - s), transition: null }, ...inserted, { ...clipPart(c.clip, at - s, c.duration), id: newId("clip") });
      placed = true;
      continue;
    }
    clips.push(c.clip);
  }
  if (!placed) {
    // At the very end: the last clip's transition has nothing to go into.
    if (clips.length) clips[clips.length - 1] = { ...clips[clips.length - 1], transition: null };
    clips.push(...inserted);
  }

  const shift = <T extends Timed>(it: T): T => (it.start >= at ? { ...it, start: it.start + duration, end: it.end + duration } : it);
  const splitMedia = <T extends Timed & { offset: number; id: string }>(it: T, rename: () => string): T[] => {
    if (it.start >= at || it.end <= at) return [shift(it)];
    const first = at - it.start;
    return [
      { ...it, end: at },
      { ...it, id: rename(), start: at + duration, end: it.end + duration, offset: it.offset + first },
    ];
  };
  const overlays: Overlay[] = project.overlays.flatMap((o): Overlay[] => (o.kind === "video" ? splitMedia(o, () => newId("ovl")) : [shift(o)]));
  const audio = project.audio.flatMap((a) => splitMedia(audioAsTimed(a), () => newId("aud")).map(timedAsAudio));
  return {
    ok: true,
    removed: 0,
    project: {
      ...project,
      clips,
      overlays: [...overlays, ...(extra.overlays ?? [])],
      audio: [...audio, ...(extra.audio ?? [])],
      effects: project.effects.map(shift),
      masks: (project.masks ?? []).map(shift),
      suggestions: (project.suggestions ?? []).map(shift),
      chapters: (project.chapters ?? []).map((c) => (c.t >= at ? { ...c, t: c.t + duration } : c)),
      // The inserted material has no words yet; later words move along.
      ...(project.transcript
        ? { transcript: { ...project.transcript, total: project.transcript.total + duration, words: project.transcript.words.map(shift) } }
        : {}),
    },
  };
}

/** Replaces [from, to) with new material: one undo step in the editor. */
export function rippleReplace(
  project: Project,
  lay: Layout,
  from: number,
  to: number,
  inserted: Clip[],
  duration: number,
  extra: { audio?: AudioClip[]; overlays?: Overlay[] },
  relayout: (p: Project) => Layout
): RippleResult {
  const cut = rippleCut(project, lay, from, to);
  if (!cut.ok) return cut;
  const at = Math.max(0, Math.min(from, to));
  const ins = rippleInsert(cut.project, relayout(cut.project), at, inserted, duration, extra);
  return ins.ok ? { ...ins, removed: cut.removed } : ins;
}
