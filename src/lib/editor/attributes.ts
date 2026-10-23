import type { Clip, Overlay } from "./types";

/** "Copy / paste attributes": a clip's or layer's look and settings, taken
 * from one and applied to others - never what it shows or when. */

export type ClipAttributes = Pick<Clip, "look" | "transform" | "speed" | "volume"> & Partial<Pick<Clip, "mask" | "stabilize" | "ramp">>;

export function clipAttributes(c: Clip): ClipAttributes {
  return { look: c.look, transform: c.transform, speed: c.speed, volume: c.volume, mask: c.mask, stabilize: c.stabilize, ramp: c.ramp };
}

/** Applied to a clip. Keyframes (tied to the source's moments) and speed
 * curves on freeze/reversed clips don't carry over. */
export function pasteClipAttributes(c: Clip, a: ClipAttributes): Clip {
  return {
    ...c,
    look: a.look,
    transform: a.transform,
    volume: a.volume,
    mask: a.mask,
    stabilize: c.freeze === null ? a.stabilize : c.stabilize,
    speed: c.freeze === null ? a.speed : c.speed,
    ramp: c.freeze === null && !c.reverse ? a.ramp : c.ramp,
    keyframes: undefined,
  };
}

export type LayerAttributes = Pick<Overlay, "opacity" | "rotation" | "animIn" | "animOut"> &
  Partial<Pick<Overlay, "blend" | "mask" | "keyframes" | "key">> & { text?: Extract<Overlay, { kind: "text" }>["text"] };

export function layerAttributes(o: Overlay): LayerAttributes {
  return {
    opacity: o.opacity,
    rotation: o.rotation,
    animIn: o.animIn,
    animOut: o.animOut,
    blend: o.blend,
    mask: o.mask,
    keyframes: o.keyframes,
    key: o.key,
    ...(o.kind === "text" ? { text: o.text } : {}),
  };
}

/** Applied to a layer: text style goes only to text (keeping its words);
 * chroma key only to images and videos. */
export function pasteLayerAttributes(o: Overlay, a: LayerAttributes): Overlay {
  const { text, key, ...rest } = a;
  const next = { ...o, ...rest } as Overlay;
  if (next.kind === "text" && text) next.text = { ...text, content: next.text.content };
  if (next.kind === "image" || next.kind === "video") next.key = key;
  // Keyframes are relative to a layer's start but can't outlast it.
  if (next.keyframes) next.keyframes = next.keyframes.filter((k) => k.t <= next.end - next.start + 1e-3);
  return next;
}
