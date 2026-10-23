import { sourceTimeAt, type LaidOutClip } from "./timeline";
import { sourceToLocal } from "./speed";
import type { Clip, Keyframe, KeyframeEase, Overlay, VideoTransform } from "./types";

/** Keyframe animation of position, scale, rotation and opacity.
 *
 * Every keyframe holds all the animated values (like a snapshot); between
 * two keyframes each value moves along the first one's ease, before the
 * first and after the last it holds. Overlays keep keyframe times relative
 * to their start (moving a layer moves its animation); clips keep them in
 * source seconds (trims, splits and moves keep each keyframe on the same
 * moment of the video, like focus zooms) - except freeze frames, whose
 * source time stands still: theirs are seconds from the clip's start. `scale` multiplies an overlay's
 * size and replaces a clip's transform.scale; clips ignore `opacity`.
 *
 * The export evaluates the same curves (editor.py keyframe_expr), so the
 * ease formulas here and there must match.
 */

export type KeyValues = Pick<Keyframe, "x" | "y" | "scale" | "rotation" | "opacity">;

/** Keyframes closer than this are the same keyframe. */
export const KEYFRAME_SNAP = 1 / 60;

export const EASE_LABELS: Record<KeyframeEase, string> = {
  linear: "Linear",
  smooth: "Ease in & out",
  in: "Ease in",
  out: "Ease out",
};

export function ease(kind: KeyframeEase, u: number): number {
  switch (kind) {
    case "smooth":
      return u * u * (3 - 2 * u);
    case "in":
      return u * u;
    case "out":
      return u * (2 - u);
    default:
      return u;
  }
}

/** Values at `t` (in the keyframes' own time base). */
export function sampleKeyframes(kfs: Keyframe[], t: number): KeyValues {
  const first = kfs[0];
  if (t <= first.t || kfs.length === 1) return pick(first);
  for (let i = 1; i < kfs.length; i++) {
    const b = kfs[i];
    if (t < b.t) {
      const a = kfs[i - 1];
      const e = ease(a.ease, (t - a.t) / Math.max(1e-6, b.t - a.t));
      const lerp = (p: number, q: number) => p + (q - p) * e;
      return { x: lerp(a.x, b.x), y: lerp(a.y, b.y), scale: lerp(a.scale, b.scale), rotation: lerp(a.rotation, b.rotation), opacity: lerp(a.opacity, b.opacity) };
    }
  }
  return pick(kfs[kfs.length - 1]);
}

function pick(k: Keyframe): KeyValues {
  return { x: k.x, y: k.y, scale: k.scale, rotation: k.rotation, opacity: k.opacity };
}

/** Sets the keyframe at `t` to `values` (replacing one within
 * KEYFRAME_SNAP), keeping the list sorted. */
export function upsertKeyframe(kfs: Keyframe[], t: number, values: KeyValues, easeKind?: KeyframeEase): Keyframe[] {
  const at = kfs.findIndex((k) => Math.abs(k.t - t) < KEYFRAME_SNAP);
  if (at >= 0) return kfs.map((k, i) => (i === at ? { ...k, ...values, ...(easeKind ? { ease: easeKind } : {}) } : k));
  return [...kfs, { t, ...values, ease: easeKind ?? "smooth" }].sort((a, b) => a.t - b.t);
}

export function keyframeAt(kfs: Keyframe[] | undefined, t: number): Keyframe | undefined {
  return kfs?.find((k) => Math.abs(k.t - t) < KEYFRAME_SNAP);
}

// --- overlays -----------------------------------------------------------------

/** An overlay's animated values at timeline time `t`. */
export function overlayValues(o: Overlay, t: number): KeyValues {
  if (o.keyframes?.length) return sampleKeyframes(o.keyframes, t - o.start);
  return { x: o.x, y: o.y, scale: 1, rotation: o.rotation, opacity: o.opacity };
}

/** Turns an edit of an animated overlay into a keyframe at timeline time
 * `t`: position, rotation, opacity and size changes go into the keyframe
 * instead of the base values. A size (width, or text size) is read as the
 * size wanted on screen, so it becomes scale = size / base size. Overlays
 * without keyframes get the patch as it is. */
export function animateOverlayPatch(o: Overlay, patch: Partial<Overlay>, t: number): Partial<Overlay> {
  if (!o.keyframes?.length) return patch;
  const { x, y, rotation, opacity, width, ...rest } = patch;
  let scale: number | undefined;
  if (width !== undefined && o.width > 0 && width !== o.width) scale = width / o.width;
  const text = (patch as { text?: { size: number } }).text;
  if (o.kind === "text" && text && text.size !== o.text.size) {
    scale = text.size / o.text.size;
    (rest as { text?: unknown }).text = { ...text, size: o.text.size };
  }
  if (x === undefined && y === undefined && rotation === undefined && opacity === undefined && scale === undefined) return patch;
  const cur = overlayValues(o, t);
  const values: KeyValues = {
    x: x ?? cur.x,
    y: y ?? cur.y,
    rotation: rotation ?? cur.rotation,
    opacity: opacity ?? cur.opacity,
    scale: Math.max(0.02, scale ?? cur.scale),
  };
  return { ...rest, keyframes: upsertKeyframe(o.keyframes, t - o.start, values) } as Partial<Overlay>;
}

/** Adds a keyframe holding the overlay's current values at `t` (the first
 * one starts the animation from the base values). */
export function addOverlayKeyframe(o: Overlay, t: number): Keyframe[] {
  return upsertKeyframe(o.keyframes ?? [], t - o.start, overlayValues(o, t));
}

// --- clips ------------------------------------------------------------------------

/** A clip's keyframe time at timeline time `t`. */
export function clipKeyTime(c: LaidOutClip, t: number): number {
  return c.clip.freeze !== null ? t - c.start : sourceTimeAt(c, t);
}

/** Seconds from the clip's start on the timeline at which keyframe time
 * `k` plays - the export's clip-local time. */
export function clipKeyTimeToLocal(clip: Clip, k: number): number {
  if (clip.freeze !== null) return k;
  return clip.reverse ? (clip.end - k) / (clip.speed || 1) : sourceToLocal(clip, k - clip.start);
}

/** A clip's transform at source time `s`. */
export function clipTransformAt(clip: Clip, s: number): VideoTransform {
  if (!clip.keyframes?.length) return clip.transform;
  const v = sampleKeyframes(clip.keyframes, s);
  return { x: v.x, y: v.y, scale: v.scale, rotation: v.rotation };
}

export function animateClipPatch(clip: Clip, patch: Partial<Clip>, s: number): Partial<Clip> {
  if (!clip.keyframes?.length || !patch.transform) return patch;
  const { transform, ...rest } = patch;
  const cur = clipTransformAt(clip, s);
  const next = { ...cur, ...diff(clip.transform, transform) };
  return { ...rest, keyframes: upsertKeyframe(clip.keyframes, s, { ...next, opacity: 1 }) };
}

/** The fields of `b` that differ from `a` - the panel sends the whole
 * transform with one value changed. */
function diff(a: VideoTransform, b: VideoTransform): Partial<VideoTransform> {
  const out: Partial<VideoTransform> = {};
  (Object.keys(b) as (keyof VideoTransform)[]).forEach((k) => {
    if (b[k] !== a[k]) out[k] = b[k];
  });
  return out;
}

export function addClipKeyframe(clip: Clip, s: number): Keyframe[] {
  return upsertKeyframe(clip.keyframes ?? [], s, { ...clipTransformAt(clip, s), opacity: 1 });
}
