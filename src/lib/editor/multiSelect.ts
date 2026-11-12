/** Several timeline items selected at once: picked by Shift/Ctrl-click, a
 * drag box or Select all, then moved, nudged, deleted, copied or
 * duplicated together. Items are named by keys ("clip:<id>",
 * "overlay:<id>", "audio:<id>", "effect:<id>", "mask:<id>"). Locked layers
 * can be picked but are never moved or deleted.
 *
 * Pure - see tests/desktop/multiSelect.test.ts. */
import type { FollowFn } from "./history.ts";
import { newId } from "./timeline.ts";
import type { AudioClip, EffectClip, Overlay, PrivacyMask, Project, Selection } from "./types.ts";

export type PickKind = "clip" | "overlay" | "audio" | "effect" | "mask";
const KINDS = new Set<string>(["clip", "overlay", "audio", "effect", "mask"]);

export function selKey(s: Selection): string | null {
  return s && KINDS.has(s.kind) ? `${s.kind}:${(s as { id: string }).id}` : null;
}

export function keySelection(key: string): Selection {
  const i = key.indexOf(":");
  const kind = key.slice(0, i);
  const id = key.slice(i + 1);
  return KINDS.has(kind) ? ({ kind, id } as Selection) : null;
}

function split(keys: Iterable<string>): Record<PickKind, Set<string>> {
  const out: Record<PickKind, Set<string>> = { clip: new Set(), overlay: new Set(), audio: new Set(), effect: new Set(), mask: new Set() };
  for (const k of keys) {
    const s = keySelection(k);
    if (s) out[s.kind as PickKind].add((s as { id: string }).id);
  }
  return out;
}

/** Every item that can be picked: clips and every layer. */
export function allKeys(p: Project): string[] {
  return [
    ...p.clips.map((c) => `clip:${c.id}`),
    ...p.overlays.map((o) => `overlay:${o.id}`),
    ...p.audio.map((a) => `audio:${a.id}`),
    ...p.effects.map((e) => `effect:${e.id}`),
    ...(p.masks ?? []).map((m) => `mask:${m.id}`),
  ];
}

/** Picked keys still in the project. */
export function existingKeys(p: Project, keys: Iterable<string>): string[] {
  const all = new Set(allKeys(p));
  return [...keys].filter((k) => all.has(k));
}

/** Removes the picked items (one edit). Clips go first, so with linked
 * layers (`follow`) the layers on them go too and later ones move up; at
 * least one clip always stays. Locked layers stay. */
export function deleteKeys(p: Project, keys: Iterable<string>, follow?: FollowFn): { project: Project; lockedKept: number; clipKept: boolean } {
  const k = split(keys);
  let project = p;
  let clipKept = false;
  if (k.clip.size) {
    let clips = p.clips.filter((c) => !k.clip.has(c.id));
    if (clips.length === 0) {
      clips = [p.clips[0]];
      clipKept = true;
    }
    const next = { ...p, clips };
    project = follow && p.linkLayers !== false ? follow(p, next) : next;
  }
  const lockedKept = project.overlays.filter((o) => k.overlay.has(o.id) && o.locked).length;
  project = {
    ...project,
    overlays: project.overlays.filter((o) => !k.overlay.has(o.id) || o.locked),
    audio: project.audio.filter((a) => !k.audio.has(a.id)),
    effects: project.effects.filter((e) => !k.effect.has(e.id)),
    ...(project.masks ? { masks: project.masks.filter((m) => !k.mask.has(m.id)) } : {}),
  };
  return { project, lockedKept, clipKept };
}

interface Span {
  start: number;
  end: number;
}

/** Timeline spans of the picked layers that can move (clips and locked layers can't). */
function movable(p: Project, keys: Iterable<string>): Span[] {
  const k = split(keys);
  return [
    ...p.overlays.filter((o) => k.overlay.has(o.id) && !o.locked),
    ...p.audio.filter((a) => k.audio.has(a.id)).map((a) => ({ start: a.start, end: a.start + a.duration })),
    ...p.effects.filter((e) => k.effect.has(e.id)),
    ...(p.masks ?? []).filter((m) => k.mask.has(m.id)),
  ];
}

/** The picked layers moved together by `delta` seconds, held so none starts
 * before 0 or (with `total`) ends after the timeline. */
export function shiftKeys(p: Project, keys: Iterable<string>, delta: number, total?: number): Project {
  const spans = movable(p, keys);
  if (!spans.length) return p;
  let d = Math.max(delta, -Math.min(...spans.map((s) => s.start)));
  if (total !== undefined) d = Math.min(d, Math.max(0, total - Math.max(...spans.map((s) => s.end))));
  if (Math.abs(d) < 1e-9) return p;
  const k = split(keys);
  const r = (t: number) => Math.round((t + d) * 1e6) / 1e6;
  return {
    ...p,
    overlays: p.overlays.map((o) => (k.overlay.has(o.id) && !o.locked ? { ...o, start: r(o.start), end: r(o.end) } : o)),
    audio: p.audio.map((a) => (k.audio.has(a.id) ? { ...a, start: r(a.start) } : a)),
    effects: p.effects.map((e) => (k.effect.has(e.id) ? { ...e, start: r(e.start), end: r(e.end) } : e)),
    ...(p.masks ? { masks: p.masks.map((m) => (k.mask.has(m.id) ? { ...m, start: r(m.start), end: r(m.end) } : m)) } : {}),
  };
}

/** Copied layers, kept with their times so pasting keeps their spacing. */
export interface LayerCopy {
  overlays: Overlay[];
  audio: AudioClip[];
  effects: EffectClip[];
  masks: PrivacyMask[];
}

export function copyKeys(p: Project, keys: Iterable<string>): LayerCopy | null {
  const k = split(keys);
  const copy: LayerCopy = {
    overlays: p.overlays.filter((o) => k.overlay.has(o.id) && !o.caption),
    audio: p.audio.filter((a) => k.audio.has(a.id)),
    effects: p.effects.filter((e) => k.effect.has(e.id)),
    masks: (p.masks ?? []).filter((m) => k.mask.has(m.id)),
  };
  return copy.overlays.length + copy.audio.length + copy.effects.length + copy.masks.length ? copy : null;
}

/** Pastes a copy with its earliest item at `at` (spacing kept); returns the
 * new items' keys to pick them. */
export function pasteCopy(p: Project, copy: LayerCopy, at: number): { project: Project; keys: string[] } {
  const starts = [...copy.overlays, ...copy.effects, ...copy.masks].map((x) => x.start).concat(copy.audio.map((a) => a.start));
  const d = at - Math.min(...starts);
  const r = (t: number) => Math.max(0, Math.round((t + d) * 1e6) / 1e6);
  const overlays = copy.overlays.map((o) => ({ ...o, id: newId("ovl"), start: r(o.start), end: r(o.end), locked: false }));
  const audio = copy.audio.map((a) => ({ ...a, id: newId("aud"), start: r(a.start) }));
  const effects = copy.effects.map((e) => ({ ...e, id: newId("fx"), start: r(e.start), end: r(e.end) }));
  const masks = copy.masks.map((m) => ({ ...m, id: newId("mask"), start: r(m.start), end: r(m.end) }));
  return {
    project: {
      ...p,
      overlays: [...p.overlays, ...overlays],
      audio: [...p.audio, ...audio],
      effects: [...p.effects, ...effects],
      ...(masks.length ? { masks: [...(p.masks ?? []), ...masks] } : {}),
    },
    keys: [
      ...overlays.map((o) => `overlay:${o.id}`),
      ...audio.map((a) => `audio:${a.id}`),
      ...effects.map((e) => `effect:${e.id}`),
      ...masks.map((m) => `mask:${m.id}`),
    ],
  };
}

/** Latest end among the picked layers that can move (to duplicate right after them). */
export function keysEnd(p: Project, keys: Iterable<string>): number {
  const spans = movable(p, keys);
  return spans.length ? Math.max(...spans.map((s) => s.end)) : 0;
}
