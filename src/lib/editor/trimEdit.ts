/** Quick trims at the playhead and deleting without leaving a hole:
 *
 * - **Trim left (Q) / trim right (W)**: cut the clip or layer at the
 *   playhead and remove the part before or after it in one step. A clip
 *   trim pulls everything after it up (and, with linked layers, its layers
 *   go with the removed part); a layer keeps playing the same moment of its
 *   own media.
 * - **Delete and close the gap (Shift+Delete)**: removes layers and slides
 *   the later items on the same row back into the hole they leave.
 *
 * Pure - see tests/desktop/trimEdit.test.ts. */
import { MIN_CLIP_SECONDS, locate, splitAt, type Layout } from "./timeline.ts";
import { keySelection } from "./multiSelect.ts";
import type { AudioClip, EffectClip, Overlay, PrivacyMask, Project } from "./types.ts";

export type TrimSide = "left" | "right";

/** Removes the part of the clip under `t` before it ("left") or after it
 * ("right"). Null when `t` is at a clip's edge or in a transition. */
export function trimClipAt(p: Project, lay: Layout, t: number, side: TrimSide): { project: Project; removed: number } | null {
  const loc = locate(lay, t);
  const split = loc && !loc.incoming ? splitAt(p, lay, t) : null;
  if (!loc || !split) return null;
  // splitAt replaced the clip at `at` with its two parts.
  const at = loc.primary.index;
  const clips = [...split.clips];
  const gone = clips.splice(side === "left" ? at : at + 1, 1)[0];
  const laid = lay.clips[at];
  const removed = side === "left" ? t - laid.start : laid.start + laid.duration - t;
  // The kept left part takes over the outgoing transition the right part had.
  if (side === "right") clips[at] = { ...clips[at], transition: gone.transition };
  return { project: { ...p, clips }, removed };
}

type Timed = { start: number; end: number };

/** Words timed from a layer's start, after its start moved `cut` seconds
 * later and it became `len` long. */
function trimWords(words: { start: number; end: number }[] | undefined, cut: number, len: number) {
  if (!words) return words;
  const out = words
    .map((w) => ({ start: Math.max(0, w.start - cut), end: Math.min(len, w.end - cut) }))
    .filter((w) => w.end > w.start);
  return out.length === words.length ? out : undefined;
}

function trimSpan(start: number, end: number, t: number, side: TrimSide): Timed | null {
  if (t - start < MIN_CLIP_SECONDS || end - t < MIN_CLIP_SECONDS) return null;
  return side === "left" ? { start: t, end } : { start, end: t };
}

export function trimOverlayAt(o: Overlay, t: number, side: TrimSide): Overlay | null {
  if (o.locked) return null;
  const s = trimSpan(o.start, o.end, t, side);
  if (!s) return null;
  const cut = s.start - o.start;
  const next = { ...o, ...s, words: trimWords(o.words, cut, s.end - s.start) } as Overlay;
  if (next.kind === "video") next.offset = o.kind === "video" ? o.offset + cut : 0;
  if (!next.words) delete next.words;
  return next;
}

export function trimAudioAt(a: AudioClip, t: number, side: TrimSide): AudioClip | null {
  const s = trimSpan(a.start, a.start + a.duration, t, side);
  if (!s) return null;
  const cut = s.start - a.start;
  return { ...a, start: s.start, offset: a.offset + cut, duration: s.end - s.start, ...(side === "left" ? { fadeIn: 0 } : { fadeOut: 0 }) };
}

export function trimPlainAt<T extends EffectClip | PrivacyMask>(x: T, t: number, side: TrimSide): T | null {
  const s = trimSpan(x.start, x.end, t, side);
  return s ? { ...x, ...s } : null;
}

/** Trims every picked layer that the playhead is inside. */
export function trimLayersAt(p: Project, keys: Iterable<string>, t: number, side: TrimSide): { project: Project; count: number } {
  const ids = { overlay: new Set<string>(), audio: new Set<string>(), effect: new Set<string>(), mask: new Set<string>() };
  for (const k of keys) {
    const s = keySelection(k);
    if (s && s.kind in ids) ids[s.kind as keyof typeof ids].add((s as { id: string }).id);
  }
  let count = 0;
  const pick = <T>(x: T, hit: boolean, fn: (x: T) => T | null): T => {
    if (!hit) return x;
    const r = fn(x);
    if (r) count++;
    return r ?? x;
  };
  const project: Project = {
    ...p,
    overlays: p.overlays.map((o) => pick(o, ids.overlay.has(o.id), (x) => trimOverlayAt(x, t, side))),
    audio: p.audio.map((a) => pick(a, ids.audio.has(a.id), (x) => trimAudioAt(x, t, side))),
    effects: p.effects.map((e) => pick(e, ids.effect.has(e.id), (x) => trimPlainAt(x, t, side))),
    ...(p.masks ? { masks: p.masks.map((m) => pick(m, ids.mask.has(m.id), (x) => trimPlainAt(x, t, side))) } : {}),
  };
  return { project: count ? project : p, count };
}

/** Which row a layer is on, for closing gaps. */
type Row = "text" | "elements" | "audio" | "effects" | "masks";

interface RowItem {
  row: Row;
  id: string;
  start: number;
  end: number;
  locked: boolean;
}

function rowItems(p: Project): RowItem[] {
  return [
    ...p.overlays.map((o) => ({ row: (o.kind === "text" ? "text" : "elements") as Row, id: `overlay:${o.id}`, start: o.start, end: o.end, locked: o.locked })),
    ...p.audio.map((a) => ({ row: "audio" as Row, id: `audio:${a.id}`, start: a.start, end: a.start + a.duration, locked: false })),
    ...p.effects.map((e) => ({ row: "effects" as Row, id: `effect:${e.id}`, start: e.start, end: e.end, locked: false })),
    ...(p.masks ?? []).map((m) => ({ row: "masks" as Row, id: `mask:${m.id}`, start: m.start, end: m.end, locked: false })),
  ];
}

/** Time on a row that only the deleted items covered, as sorted intervals. */
function freed(items: RowItem[], gone: Set<string>): [number, number][] {
  const union = (xs: RowItem[]) => {
    const out: [number, number][] = [];
    for (const x of [...xs].sort((a, b) => a.start - b.start)) {
      const last = out[out.length - 1];
      if (last && x.start <= last[1] + 1e-6) last[1] = Math.max(last[1], x.end);
      else out.push([x.start, x.end]);
    }
    return out;
  };
  const kept = union(items.filter((i) => !gone.has(i.id)));
  const out: [number, number][] = [];
  for (const [a, b] of union(items.filter((i) => gone.has(i.id)))) {
    let from = a;
    for (const [ka, kb] of kept) {
      if (kb <= from || ka >= b) continue;
      if (ka > from) out.push([from, ka]);
      from = Math.max(from, kb);
    }
    if (b > from + 1e-6) out.push([from, b]);
  }
  return out;
}

/** Deletes the picked layers (locked ones stay) and closes the holes they
 * leave: every later item on the same row moves back by the time that only
 * deleted items covered before it, so the row keeps its order with no new
 * overlaps. Clips in `keys` are ignored (deleting a clip already closes
 * its gap). */
export function deleteClosingGaps(p: Project, keys: Iterable<string>): { project: Project; deleted: number } {
  const all = rowItems(p);
  const gone = new Set([...keys].filter((k) => all.some((i) => i.id === k && !i.locked)));
  if (!gone.size) return { project: p, deleted: 0 };
  const shift = new Map<string, number>();
  for (const row of ["text", "elements", "audio", "effects", "masks"] as Row[]) {
    const items = all.filter((i) => i.row === row);
    const holes = freed(items, gone);
    for (const k of items) {
      if (gone.has(k.id) || k.locked) continue;
      const d = holes.filter(([, b]) => b <= k.start + 1e-6).reduce((sum, [a, b]) => sum + b - a, 0);
      if (d > 1e-6) shift.set(k.id, d);
    }
  }
  const r = (t: number) => Math.round(t * 1e6) / 1e6;
  const by = (key: string) => shift.get(key) ?? 0;
  return {
    deleted: gone.size,
    project: {
      ...p,
      overlays: p.overlays
        .filter((o) => !gone.has(`overlay:${o.id}`))
        .map((o) => (by(`overlay:${o.id}`) ? { ...o, start: r(o.start - by(`overlay:${o.id}`)), end: r(o.end - by(`overlay:${o.id}`)) } : o)),
      audio: p.audio.filter((a) => !gone.has(`audio:${a.id}`)).map((a) => (by(`audio:${a.id}`) ? { ...a, start: r(a.start - by(`audio:${a.id}`)) } : a)),
      effects: p.effects
        .filter((e) => !gone.has(`effect:${e.id}`))
        .map((e) => (by(`effect:${e.id}`) ? { ...e, start: r(e.start - by(`effect:${e.id}`)), end: r(e.end - by(`effect:${e.id}`)) } : e)),
      ...(p.masks
        ? {
            masks: p.masks
              .filter((m) => !gone.has(`mask:${m.id}`))
              .map((m) => (by(`mask:${m.id}`) ? { ...m, start: r(m.start - by(`mask:${m.id}`)), end: r(m.end - by(`mask:${m.id}`)) } : m)),
          }
        : {}),
    },
  };
}
