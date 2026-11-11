// Magnetic audio parts (MasterAudio.magnetic): the parts cut from one file
// sit back to back, like the clips on the video row. Deleting or trimming a
// part slides the ones after it; dragging a part past another swaps them.
import type { AudioClip, Project } from "./types.ts";

const EPS = 1e-6;

/** `next` with each file's parts packed back to back, in timeline order,
 * from where that file's first part started in `prev` (so deleting the
 * first part slides the rest to its place). Returns `next` itself when
 * nothing moves. */
export function packAudio(prev: Project, next: Project): Project {
  const groups = new Map<string, AudioClip[]>();
  for (const a of next.audio) {
    const g = groups.get(a.sourceId);
    if (g) g.push(a);
    else groups.set(a.sourceId, [a]);
  }
  const moved = new Map<string, number>();
  for (const [sourceId, parts] of groups) {
    const before = prev.audio.filter((a) => a.sourceId === sourceId);
    let at = Math.min(...(before.length ? before : parts).map((a) => a.start));
    // Stable: parts starting together keep their order.
    const ordered = parts.map((a, i) => ({ a, i })).sort((x, y) => x.a.start - y.a.start || x.i - y.i);
    for (const { a } of ordered) {
      if (Math.abs(a.start - at) > EPS) moved.set(a.id, at);
      at += a.duration;
    }
  }
  if (!moved.size) return next;
  return { ...next, audio: next.audio.map((a) => (moved.has(a.id) ? { ...a, start: moved.get(a.id)! } : a)) };
}

/** Packs only when magnetic is on. */
export function withMagnet(prev: Project, next: Project): Project {
  return next !== prev && next.master?.magnetic ? packAudio(prev, next) : next;
}
