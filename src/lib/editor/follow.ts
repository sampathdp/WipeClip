/** Layers that follow the main video row. When an edit changes only the
 * clips - trimming, moving, deleting, duplicating, splitting, a speed
 * change, a freeze frame - every timed layer is moved the way the clips
 * moved, so captions, text, music, voice parts, effects, masks, chapters
 * and the transcript stay on the picture they were placed on.
 *
 * How a layer moves:
 * - **Attached** layers lie within one clip: they travel with that clip
 *   (also when it's moved elsewhere), shrink with it when it's trimmed past
 *   them, and go when it's deleted. Their times are found again through the
 *   clip's source time, so they stay on the same moment of the footage.
 * - **Spanning** layers (background music, a long effect) cover several
 *   clips: they stay where they are when clips are only reordered, and
 *   otherwise keep their place relative to what's before them. Music keeps
 *   its length; a text or effect range shrinks with removed footage.
 * - **Locked** layers never move.
 * - Media layers (audio, video layers) whose start is trimmed away start
 *   later in their file, so the rest still plays in sync.
 *
 * Pure - see tests/desktop/follow.test.ts. */
import { clipVisualSpan, type Layout } from "./timeline.ts";
import { localToSource, sourceToLocal } from "./speed.ts";
import type { AudioClip, Chapter, Clip, Marker, Overlay, Project } from "./types.ts";

const MIN_ITEM = 0.1;
const EPS = 1e-6;
const ATTACH_SLACK = 0.05;

type LaidOut = Layout["clips"][number];

interface Mapped {
  /** New timeline time. */
  t: number;
  /** The point was in footage that's gone; `t` is where that footage was. */
  removed: boolean;
  /** For a removed point: the old timeline time of the nearest footage that
   * remains, towards the end of the timeline. */
  keptFrom?: number;
}

/** Playback-order offset into a clip as an absolute position in its source
 * (a freeze's hold has no source range: its own seconds are used). */
function sourcePos(c: Clip, local: number): number {
  if (c.freeze !== null) return local;
  const off = localToSource(c, local);
  return c.reverse ? c.end - off : c.start + off;
}

function localOf(c: Clip, pos: number): number {
  if (c.freeze !== null) return pos;
  return sourceToLocal(c, c.reverse ? c.end - pos : pos - c.start);
}

/** Whether a clip shows source position `pos`. A start point belongs to
 * the clip starting there, an end point to the clip ending there (a layer
 * from a cut point on stays with the later part). */
function covers(c: Clip, pos: number, end: boolean): boolean {
  const [lo, hi] = c.freeze !== null ? [0, c.end - c.start] : c.reverse ? [c.end, c.start].map((x) => -x) : [c.start, c.end];
  const p = c.freeze === null && c.reverse ? -pos : pos;
  return end ? p > lo + EPS && p <= hi + EPS : p >= lo - EPS && p < hi - EPS;
}

const sameFootage = (a: Clip, b: Clip) =>
  a.sourceId === b.sourceId && a.reverse === b.reverse && (a.freeze === null) === (b.freeze === null) && (a.freeze === null || Math.abs(a.freeze - b.freeze!) < 1e-3);

export class ClipMap {
  readonly reorder: boolean;
  private readonly spans: { from: number; to: number }[];
  private readonly nextById = new Map<string, LaidOut>();
  private readonly prevIds: Set<string>;
  private readonly fresh: LaidOut[];
  private readonly prev: Layout;
  private readonly next: Layout;

  constructor(prev: Layout, next: Layout) {
    this.prev = prev;
    this.next = next;
    this.spans = prev.clips.map((_, i) => clipVisualSpan(prev, i));
    for (const c of next.clips) this.nextById.set(c.clip.id, c);
    this.prevIds = new Set(prev.clips.map((c) => c.clip.id));
    this.fresh = next.clips.filter((c) => !this.prevIds.has(c.clip.id));
    const kept = prev.clips.map((c) => c.clip.id).filter((id) => this.nextById.has(id));
    const order = next.clips.map((c) => c.clip.id).filter((id) => this.prevIds.has(id));
    this.reorder = kept.some((id, i) => id !== order[i]);
  }

  /** Index of the old clip showing at `t` (an end point looks just before it). */
  clipAt(t: number, end = false): number {
    const x = end ? t - EPS : t;
    for (let i = 0; i < this.spans.length; i++) if (x >= this.spans[i].from - EPS && x < this.spans[i].to + EPS) return i;
    return -1;
  }

  /** Whether [start, end] lies within one old clip. */
  attached(start: number, end: number): boolean {
    const i = this.clipAt(start);
    return i >= 0 && end <= this.spans[i].to + ATTACH_SLACK;
  }

  map(t: number, end = false): Mapped {
    const prev = this.prev;
    if (t >= prev.total - EPS || !prev.clips.length) return { t: this.reorder ? t : t + this.next.total - prev.total, removed: false };
    const i = this.clipAt(t, end);
    if (i < 0) return { t, removed: false };
    const old = prev.clips[i];
    const pos = sourcePos(old.clip, Math.max(0, Math.min(old.duration, t - old.start)));
    const same = this.nextById.get(old.clip.id);
    const target =
      // A split moves the later part into a new clip of the same footage.
      same && covers(same.clip, pos, end) ? same : this.fresh.find((n) => sameFootage(n.clip, old.clip) && covers(n.clip, pos, end));
    if (target) return { t: target.start + Math.max(0, Math.min(target.duration, localOf(target.clip, pos))), removed: false };
    if (same) {
      // Trimmed away: at the clip's new edge on the side the point fell off.
      const head = same.clip.freeze === null ? (same.clip.reverse ? pos > same.clip.end - EPS : pos < same.clip.start + EPS) : pos < EPS;
      const edgePos = head ? sourcePos(same.clip, 0) : sourcePos(same.clip, same.duration);
      // The footage resumes at the clip's new start (head) or the next clip (tail).
      const keptFrom = head ? old.start + localOf(old.clip, edgePos) : prev.clips[i + 1]?.start;
      return { t: head ? same.start : same.start + same.duration, removed: true, keptFrom };
    }
    // Deleted: where the clip was - the start of the next clip that stays.
    for (let j = i + 1; j < prev.clips.length; j++) {
      const n = this.nextById.get(prev.clips[j].clip.id);
      if (n) return { t: n.start, removed: true, keptFrom: prev.clips[j].start };
    }
    for (let j = i - 1; j >= 0; j--) {
      const n = this.nextById.get(prev.clips[j].clip.id);
      if (n) return { t: n.start + n.duration, removed: true };
    }
    return { t: 0, removed: true };
  }
}

interface Span {
  start: number;
  end: number;
  /** Plays its own media (audio, video layer). */
  media: boolean;
}

/** Where a layer goes; null = it's gone, `cut` = seconds lost at its start. */
function place(m: ClipMap, it: Span): { start: number; end: number; cut: number } | null {
  const attached = m.attached(it.start, it.end);
  if (m.reorder && !attached) return { start: it.start, end: it.end, cut: 0 };
  const a = m.map(it.start);
  const b = m.map(it.end, true);
  const cut = a.removed ? Math.max(0, Math.min(it.end - it.start, (a.keptFrom ?? it.end) - it.start)) : 0;
  let start = a.t;
  let end: number;
  if (it.media) {
    // Its media keeps playing at its own pace: the length only shrinks by
    // footage removed under it (attached) or at its start.
    end = start + (it.end - it.start) - cut;
    if (attached && b.removed) end = Math.min(end, b.t);
  } else {
    end = b.t;
  }
  if (end < start) [start, end] = [end, start];
  return end - start >= MIN_ITEM ? { start, end, cut } : null;
}

const round = (t: number) => Math.round(t * 1e6) / 1e6;
const unchanged = (p: { start: number; end: number; cut: number }, s: number, e: number) =>
  Math.abs(p.start - s) < EPS && Math.abs(p.end - e) < EPS && p.cut < EPS;

function followOverlay(m: ClipMap, o: Overlay): Overlay | null {
  if (o.locked) return o;
  const p = place(m, { start: o.start, end: o.end, media: o.kind === "video" });
  if (!p) return null;
  if (unchanged(p, o.start, o.end)) return o;
  const next: Overlay = { ...o, start: round(p.start), end: round(p.end) };
  if (o.kind === "video") (next as typeof o).offset = round(o.offset + p.cut);
  if (o.words) {
    // Word timings are from the layer's start: each word is placed again.
    const words = o.words
      .map((w) => {
        const s = m.map(o.start + w.start).t - p.start;
        const e = m.map(o.start + w.end, true).t - p.start;
        return { start: round(Math.max(0, s)), end: round(Math.min(p.end - p.start, e)) };
      })
      .filter((w) => w.end > w.start);
    next.words = words.length === o.words.length ? words : undefined;
  }
  return next;
}

function followAudio(m: ClipMap, a: AudioClip): AudioClip | null {
  const p = place(m, { start: a.start, end: a.start + a.duration, media: true });
  if (!p) return null;
  let next: AudioClip = a;
  if (!unchanged(p, a.start, a.start + a.duration)) {
    next = { ...a, start: round(p.start), duration: round(p.end - p.start), offset: round(a.offset + p.cut) };
  }
  if (a.duck) {
    const regions = a.duck.regions
      .map(([s, e]) => place(m, { start: s, end: e, media: false }))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map((r): [number, number] => [round(r.start), round(r.end)]);
    const same = regions.length === a.duck.regions.length && regions.every(([s, e], i) => s === a.duck!.regions[i][0] && e === a.duck!.regions[i][1]);
    if (!same) next = { ...next, duck: { ...a.duck, regions } };
  }
  return next;
}

function followPlain<T extends { start: number; end: number; locked?: boolean }>(m: ClipMap, it: T): T | null {
  if (it.locked) return it;
  const p = place(m, { start: it.start, end: it.end, media: false });
  if (!p) return null;
  return unchanged(p, it.start, it.end) ? it : { ...it, start: round(p.start), end: round(p.end) };
}

function keep<T>(before: T[], after: (T | null)[]): T[] {
  const out = after.filter((x): x is T => x !== null);
  return out.length === before.length && out.every((x, i) => x === before[i]) ? before : out;
}

/** `next` (whose clips changed) with every layer of `prev` moved the way
 * the clips moved. `prevLay` and `nextLay` are their layouts. */
export function followClips(prev: Project, next: Project, prevLay: Layout, nextLay: Layout): Project {
  // Same clips at the same times (a look change, a slip, a retimed
  // keyframe): nothing moves.
  if (sameTiming(prevLay, nextLay)) return next;
  const m = new ClipMap(prevLay, nextLay);
  const markers = (prev.markers ?? []).map((mk): Marker => {
    const t = m.reorder && !m.attached(mk.t, mk.t) ? mk.t : round(m.map(mk.t).t);
    return t === mk.t ? mk : { ...mk, t };
  });
  const chapters: Chapter[] = [];
  for (const ch of prev.chapters ?? []) {
    const t = m.reorder && !m.attached(ch.t, ch.t) ? ch.t : round(m.map(ch.t).t);
    if (!chapters.some((x) => Math.abs(x.t - t) < 0.5)) chapters.push(t === ch.t ? ch : { ...ch, t });
  }
  const transcript = prev.transcript && {
    ...prev.transcript,
    total: Math.abs(prev.transcript.total - prevLay.total) < 1e-3 ? nextLay.total : prev.transcript.total,
    words: keep(
      prev.transcript.words,
      prev.transcript.words.map((w) => followPlain(m, w))
    ),
  };
  return {
    ...next,
    overlays: keep(prev.overlays, prev.overlays.map((o) => followOverlay(m, o))),
    audio: keep(prev.audio, prev.audio.map((a) => followAudio(m, a))),
    effects: keep(prev.effects, prev.effects.map((e) => followPlain(m, e))),
    masks: prev.masks && keep(prev.masks, prev.masks.map((x) => followPlain(m, x))),
    suggestions: prev.suggestions && keep(prev.suggestions, prev.suggestions.map((s) => followPlain(m, s))),
    chapters: prev.chapters && (chapters.length === prev.chapters.length && chapters.every((c, i) => c === prev.chapters![i]) ? prev.chapters : chapters),
    markers: prev.markers && (markers.every((x, i) => x === prev.markers![i]) ? prev.markers : markers),
    ...(transcript ? { transcript } : {}),
  };
}

/** Whether two layouts have the same clips at the same timeline times. */
function sameTiming(a: Layout, b: Layout): boolean {
  return (
    a.clips.length === b.clips.length &&
    a.clips.every((c, i) => {
      const d = b.clips[i];
      return c.clip.id === d.clip.id && Math.abs(c.start - d.start) < 1e-9 && Math.abs(c.duration - d.duration) < 1e-9;
    })
  );
}

/** Whether an edit from `prev` to `next` changed only the clips, so the
 * layers should follow (an edit that moved layers itself - a ripple cut,
 * an insert - already placed them). */
export function onlyClipsChanged(prev: Project, next: Project): boolean {
  return (
    prev.clips !== next.clips &&
    prev.overlays === next.overlays &&
    prev.audio === next.audio &&
    prev.effects === next.effects &&
    prev.masks === next.masks &&
    prev.suggestions === next.suggestions &&
    prev.chapters === next.chapters &&
    prev.markers === next.markers &&
    prev.transcript === next.transcript
  );
}
