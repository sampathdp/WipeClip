/** Built-in sticker library. Every sticker is rasterized in the browser to
 * one PNG (rasterizeSticker) and that same PNG is used both for the preview
 * overlay and as the image the export composites - so what the user places
 * is pixel-for-pixel what ends up in the video, including emoji, which
 * otherwise render differently per OS font.
 *
 * To add stickers: append to STICKERS. `svg` stickers need an explicit
 * width/height on the root <svg> (it sets the aspect ratio); `emoji`
 * stickers are a single Unicode emoji.
 */

export type StickerCategory =
  | "emoji"
  | "reactions"
  | "arrows"
  | "shapes"
  | "social"
  | "labels"
  | "decorative";

export const STICKER_CATEGORIES: { key: StickerCategory; label: string }[] = [
  { key: "emoji", label: "Emoji" },
  { key: "reactions", label: "Reactions" },
  { key: "arrows", label: "Arrows" },
  { key: "shapes", label: "Shapes" },
  { key: "social", label: "Social" },
  { key: "labels", label: "Labels" },
  { key: "decorative", label: "Decorative" },
];

export type StickerDef =
  | { id: string; category: StickerCategory; label: string; kind: "emoji"; char: string }
  | { id: string; category: StickerCategory; label: string; kind: "svg"; svg: string };

const FONT = "font-family='Arial Black, Arial, Helvetica, sans-serif' font-weight='900'";

function pill(text: string, bg: string, fg = "#fff", width = 360): string {
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='120' viewBox='0 0 ${width} 120'><rect x='6' y='6' width='${width - 12}' height='108' rx='54' fill='${bg}' stroke='#fff' stroke-width='6'/><text x='${width / 2}' y='78' text-anchor='middle' font-size='52' ${FONT} fill='${fg}'>${text}</text></svg>`;
}

function tag(text: string, bg: string, fg = "#fff", width = 300): string {
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='120' viewBox='0 0 ${width} 120'><rect x='6' y='6' width='${width - 12}' height='108' rx='18' fill='${bg}' stroke='#fff' stroke-width='6'/><text x='${width / 2}' y='80' text-anchor='middle' font-size='56' ${FONT} fill='${fg}'>${text}</text></svg>`;
}

function bubble(text: string, bg: string, fg = "#fff"): string {
  return `<svg xmlns='http://www.w3.org/2000/svg' width='360' height='260' viewBox='0 0 360 260'><path d='M40 10h280a30 30 0 0 1 30 30v130a30 30 0 0 1-30 30H150l-70 50 12-50H40a30 30 0 0 1-30-30V40a30 30 0 0 1 30-30z' fill='${bg}' stroke='#fff' stroke-width='8' stroke-linejoin='round'/><text x='180' y='130' text-anchor='middle' font-size='72' ${FONT} fill='${fg}'>${text}</text></svg>`;
}

function arrow(path: string, color: string, w = 300, h = 200): string {
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'><path d='${path}' fill='none' stroke='#fff' stroke-width='34' stroke-linecap='round' stroke-linejoin='round'/><path d='${path}' fill='none' stroke='${color}' stroke-width='20' stroke-linecap='round' stroke-linejoin='round'/></svg>`;
}

function shape(body: string, w = 240, h = 240): string {
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${body}</svg>`;
}

const EMOJI: [string, string][] = [
  ["grin", "😀"], ["joy", "😂"], ["love", "😍"], ["cool", "😎"], ["mindblown", "🤯"], ["cry", "😭"],
  ["party", "🥳"], ["fire", "🔥"], ["thumbsup", "👍"], ["clap", "👏"], ["raise", "🙌"], ["hundred", "💯"],
  ["heart", "❤️"], ["star", "⭐"], ["sparkles", "✨"], ["tada", "🎉"], ["eyes", "👀"], ["bulb", "💡"],
  ["think", "🤔"], ["scream", "😱"], ["wink", "😉"], ["skull", "💀"], ["rocket", "🚀"], ["point", "👉"],
  ["check", "✅"], ["cross", "❌"], ["warning", "⚠️"], ["pin", "📌"], ["money", "💰"], ["alarm", "⏰"],
];

export const STICKERS: StickerDef[] = [
  ...EMOJI.map(([id, char]) => ({ id: `emoji-${id}`, category: "emoji" as const, label: id, kind: "emoji" as const, char })),

  { id: "react-wow", category: "reactions", label: "Wow", kind: "svg", svg: bubble("WOW!", "#7c5cff") },
  { id: "react-lol", category: "reactions", label: "LOL", kind: "svg", svg: bubble("LOL", "#f59e0b") },
  { id: "react-omg", category: "reactions", label: "OMG", kind: "svg", svg: bubble("OMG", "#ef4444") },
  { id: "react-yes", category: "reactions", label: "Yes", kind: "svg", svg: bubble("YES!", "#10b981") },
  { id: "react-nope", category: "reactions", label: "Nope", kind: "svg", svg: bubble("NOPE", "#111827") },
  { id: "react-hmm", category: "reactions", label: "Hmm", kind: "svg", svg: bubble("HMM…", "#0ea5e9") },
  { id: "react-oops", category: "reactions", label: "Oops", kind: "svg", svg: bubble("OOPS", "#ec4899") },
  { id: "react-nice", category: "reactions", label: "Nice", kind: "svg", svg: bubble("NICE!", "#22c55e") },
  { id: "react-boom", category: "reactions", label: "Boom", kind: "svg", svg: bubble("BOOM", "#f97316") },
  { id: "react-wait", category: "reactions", label: "Wait", kind: "svg", svg: bubble("WAIT…", "#6366f1") },

  { id: "arrow-right", category: "arrows", label: "Arrow right", kind: "svg", svg: arrow("M30 100h220M180 40l70 60-70 60", "#facc15") },
  { id: "arrow-down", category: "arrows", label: "Arrow down", kind: "svg", svg: arrow("M100 30v220M40 180l60 70 60-70", "#ef4444", 200, 300) },
  { id: "arrow-curve", category: "arrows", label: "Curved arrow", kind: "svg", svg: arrow("M30 170C60 60 170 40 250 90M200 40l52 52-70 22", "#22d3ee") },
  { id: "arrow-scribble", category: "arrows", label: "Hand-drawn arrow", kind: "svg", svg: arrow("M30 60c40 10 60 60 100 60s70-60 120-20M205 70l45 30-50 25", "#ffffff") },
  { id: "arrow-left", category: "arrows", label: "Arrow left", kind: "svg", svg: arrow("M270 100H50M120 40l-70 60 70 60", "#facc15") },
  { id: "arrow-up", category: "arrows", label: "Arrow up", kind: "svg", svg: arrow("M100 270V50M40 120l60-70 60 70", "#22c55e", 200, 300) },
  { id: "arrow-both", category: "arrows", label: "Two-way arrow", kind: "svg", svg: arrow("M40 100h260M100 40l-60 60 60 60M240 40l60 60-60 60", "#ffffff", 340, 200) },
  { id: "arrow-loop", category: "arrows", label: "Loop arrow", kind: "svg", svg: arrow("M190 60a80 80 0 1 0 40 70M180 20l14 44-46 10", "#f472b6", 280, 260) },
  { id: "arrow-chevrons", category: "arrows", label: "Chevrons", kind: "svg", svg: arrow("M40 40l60 60-60 60M140 40l60 60-60 60", "#a78bfa", 260, 200) },

  { id: "shape-circle", category: "shapes", label: "Circle highlight", kind: "svg", svg: shape("<ellipse cx='120' cy='120' rx='100' ry='100' fill='none' stroke='#ef4444' stroke-width='16'/>") },
  { id: "shape-box", category: "shapes", label: "Box highlight", kind: "svg", svg: shape("<rect x='14' y='14' width='292' height='172' rx='14' fill='none' stroke='#facc15' stroke-width='16'/>", 320, 200) },
  { id: "shape-star", category: "shapes", label: "Star", kind: "svg", svg: shape("<path d='M120 16l30 66 72 8-54 49 15 71-63-36-63 36 15-71-54-49 72-8z' fill='#facc15' stroke='#fff' stroke-width='8' stroke-linejoin='round'/>") },
  { id: "shape-heart", category: "shapes", label: "Heart", kind: "svg", svg: shape("<path d='M120 210S20 150 20 84c0-34 26-60 58-60 20 0 34 10 42 24 8-14 22-24 42-24 32 0 58 26 58 60 0 66-100 126-100 126z' fill='#ef4444' stroke='#fff' stroke-width='8'/>") },
  { id: "shape-burst", category: "shapes", label: "Burst", kind: "svg", svg: shape("<path d='M120 8l22 44 46-18-10 48 48 10-38 32 32 38-50 4 4 50-44-24-26 42-20-46-46 18 12-48-48-12 40-30-30-40 50-2-2-50 42 26z' fill='#f97316' stroke='#fff' stroke-width='6' stroke-linejoin='round'/>") },
  { id: "shape-check", category: "shapes", label: "Check mark", kind: "svg", svg: shape("<circle cx='120' cy='120' r='108' fill='#22c55e' stroke='#fff' stroke-width='10'/><path d='M66 124l36 36 74-80' fill='none' stroke='#fff' stroke-width='24' stroke-linecap='round' stroke-linejoin='round'/>") },
  { id: "shape-cross", category: "shapes", label: "Cross mark", kind: "svg", svg: shape("<circle cx='120' cy='120' r='108' fill='#ef4444' stroke='#fff' stroke-width='10'/><path d='M80 80l80 80M160 80l-80 80' fill='none' stroke='#fff' stroke-width='24' stroke-linecap='round'/>") },
  { id: "shape-question", category: "shapes", label: "Question", kind: "svg", svg: shape(`<circle cx='120' cy='120' r='108' fill='#7c5cff' stroke='#fff' stroke-width='10'/><text x='120' y='166' text-anchor='middle' font-size='140' ${FONT} fill='#fff'>?</text>`) },
  { id: "shape-alert", category: "shapes", label: "Alert", kind: "svg", svg: shape(`<path d='M120 16l108 196H12z' fill='#facc15' stroke='#fff' stroke-width='10' stroke-linejoin='round'/><text x='120' y='196' text-anchor='middle' font-size='130' ${FONT} fill='#111827'>!</text>`) },
  { id: "shape-underline-box", category: "shapes", label: "Rounded frame", kind: "svg", svg: shape("<rect x='14' y='14' width='292' height='172' rx='60' fill='none' stroke='#22d3ee' stroke-width='16' stroke-dasharray='34 20' stroke-linecap='round'/>", 320, 200) },
  { id: "shape-dot", category: "shapes", label: "Dot", kind: "svg", svg: shape("<circle cx='120' cy='120' r='90' fill='#22d3ee' stroke='#fff' stroke-width='12'/>") },

  { id: "social-subscribe", category: "social", label: "Subscribe", kind: "svg", svg: pill("SUBSCRIBE", "#ef0000", "#fff", 420) },
  { id: "social-follow", category: "social", label: "Follow", kind: "svg", svg: pill("+ FOLLOW", "#7c5cff") },
  { id: "social-like", category: "social", label: "Like", kind: "svg", svg: shape("<circle cx='120' cy='120' r='108' fill='#2563eb' stroke='#fff' stroke-width='10'/><path d='M70 112h28v70H70zM108 180h62c10 0 16-6 18-14l12-50c2-10-6-18-16-18h-40l6-28c2-12-6-24-18-24l-24 50z' fill='#fff'/>") },
  { id: "social-bell", category: "social", label: "Bell", kind: "svg", svg: shape("<circle cx='120' cy='120' r='108' fill='#facc15' stroke='#fff' stroke-width='10'/><path d='M120 52c-30 0-50 22-50 52v34l-14 22h128l-14-22v-34c0-30-20-52-50-52zM102 170a18 18 0 0 0 36 0' fill='#111827'/>") },
  { id: "social-linkinbio", category: "social", label: "Link in bio", kind: "svg", svg: pill("LINK IN BIO", "#111827", "#fff", 440) },
  { id: "social-share", category: "social", label: "Share", kind: "svg", svg: pill("SHARE", "#10b981") },
  { id: "social-comment", category: "social", label: "Comment", kind: "svg", svg: pill("COMMENT", "#0ea5e9", "#fff", 400) },
  { id: "social-save", category: "social", label: "Save this", kind: "svg", svg: pill("SAVE THIS", "#f59e0b", "#111827", 420) },
  { id: "social-newvideo", category: "social", label: "New video", kind: "svg", svg: pill("NEW VIDEO", "#ef4444", "#fff", 420) },
  { id: "social-watch", category: "social", label: "Watch till the end", kind: "svg", svg: pill("WATCH TILL END", "#111827", "#facc15", 560) },

  { id: "label-new", category: "labels", label: "New", kind: "svg", svg: tag("NEW", "#22c55e") },
  { id: "label-sale", category: "labels", label: "Sale", kind: "svg", svg: tag("SALE", "#ef4444") },
  { id: "label-live", category: "labels", label: "Live", kind: "svg", svg: `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='120' viewBox='0 0 300 120'><rect x='6' y='6' width='288' height='108' rx='18' fill='#dc2626' stroke='#fff' stroke-width='6'/><circle cx='66' cy='60' r='18' fill='#fff'/><text x='178' y='80' text-anchor='middle' font-size='56' ${FONT} fill='#fff'>LIVE</text></svg>` },
  { id: "label-tip", category: "labels", label: "Tip", kind: "svg", svg: tag("TIP", "#0ea5e9") },
  { id: "label-step1", category: "labels", label: "Step 1", kind: "svg", svg: tag("STEP 1", "#7c5cff", "#fff", 340) },
  { id: "label-before", category: "labels", label: "Before", kind: "svg", svg: tag("BEFORE", "#374151", "#fff", 360) },
  { id: "label-after", category: "labels", label: "After", kind: "svg", svg: tag("AFTER", "#10b981", "#fff", 340) },
  { id: "label-hot", category: "labels", label: "Hot", kind: "svg", svg: tag("HOT", "#f97316") },
  { id: "label-free", category: "labels", label: "Free", kind: "svg", svg: tag("FREE", "#22c55e") },
  { id: "label-bonus", category: "labels", label: "Bonus", kind: "svg", svg: tag("BONUS", "#a855f7", "#fff", 340) },
  { id: "label-protip", category: "labels", label: "Pro tip", kind: "svg", svg: tag("PRO TIP", "#facc15", "#111827", 380) },
  { id: "label-warning", category: "labels", label: "Warning", kind: "svg", svg: tag("WARNING", "#ef4444", "#fff", 420) },
  { id: "label-done", category: "labels", label: "Done", kind: "svg", svg: tag("DONE ✓", "#10b981", "#fff", 360) },

  { id: "deco-sparkle", category: "decorative", label: "Sparkle", kind: "svg", svg: shape("<path d='M120 10c10 60 50 100 110 110-60 10-100 50-110 110-10-60-50-100-110-110 60-10 100-50 110-110z' fill='#fde047' stroke='#fff' stroke-width='6' stroke-linejoin='round'/>") },
  { id: "deco-sparkles", category: "decorative", label: "Sparkles", kind: "svg", svg: shape("<path d='M90 30c6 36 30 60 66 66-36 6-60 30-66 66-6-36-30-60-66-66 36-6 60-30 66-66zM180 130c4 22 18 36 40 40-22 4-36 18-40 40-4-22-18-36-40-40 22-4 36-18 40-40z' fill='#fff' stroke='#a78bfa' stroke-width='6' stroke-linejoin='round'/>") },
  { id: "deco-underline", category: "decorative", label: "Underline", kind: "svg", svg: arrow("M20 70c60-30 140-30 260-10M40 110c80-20 160-20 220-6", "#f43f5e", 300, 140) },
  { id: "deco-confetti", category: "decorative", label: "Confetti", kind: "svg", svg: shape("<rect x='30' y='40' width='22' height='40' rx='4' fill='#f43f5e' transform='rotate(-20 41 60)'/><rect x='160' y='30' width='22' height='40' rx='4' fill='#22d3ee' transform='rotate(25 171 50)'/><rect x='100' y='150' width='22' height='40' rx='4' fill='#facc15' transform='rotate(-35 111 170)'/><circle cx='190' cy='150' r='14' fill='#a78bfa'/><circle cx='60' cy='170' r='12' fill='#10b981'/><circle cx='110' cy='70' r='10' fill='#f97316'/><path d='M140 100l20 10-20 10z' fill='#7c5cff'/>") },
  { id: "deco-bolt", category: "decorative", label: "Lightning", kind: "svg", svg: shape("<path d='M140 10L40 140h70l-20 90 110-140h-72z' fill='#facc15' stroke='#fff' stroke-width='10' stroke-linejoin='round'/>") },
  { id: "deco-wave", category: "decorative", label: "Wavy line", kind: "svg", svg: arrow("M20 70c30-40 60-40 90 0s60 40 90 0 60-40 90 0", "#22d3ee", 320, 140) },
  { id: "deco-circle-scribble", category: "decorative", label: "Scribble circle", kind: "svg", svg: arrow("M210 60C170 20 60 20 34 90c-24 64 50 120 130 104 70-14 100-80 60-130-20-24-60-34-90-30", "#f43f5e", 280, 240) },
  { id: "deco-stars", category: "decorative", label: "Stars", kind: "svg", svg: shape("<path d='M70 30l14 30 32 4-24 22 6 32-28-16-28 16 6-32-24-22 32-4zM170 110l18 38 42 5-31 29 8 41-37-21-37 21 8-41-31-29 42-5z' fill='#facc15' stroke='#fff' stroke-width='6' stroke-linejoin='round'/>") },
  { id: "deco-crown", category: "decorative", label: "Crown", kind: "svg", svg: shape("<path d='M30 180l-10-110 60 50 40-80 40 80 60-50-10 110z' fill='#facc15' stroke='#fff' stroke-width='8' stroke-linejoin='round'/><circle cx='120' cy='40' r='12' fill='#fff'/>", 240, 200) },
];

const BY_ID = new Map(STICKERS.map((s) => [s.id, s]));

export function getStickerDef(id: string): StickerDef | undefined {
  return BY_ID.get(id);
}

export function stickerThumbSrc(def: StickerDef): string | null {
  return def.kind === "svg" ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(def.svg)}` : null;
}

export interface RasterSticker {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  /** Animated text: the PNG is a grid of states, width/height one cell
   * (textAnim.ts). */
  sprite?: { cols: number; rows: number; times: number[] };
}

const RASTER_SIZE = 512;
const cache = new Map<string, Promise<RasterSticker>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Sticker image failed to load"));
    img.src = src;
  });
}

/** Crops fully transparent borders so the selection box hugs the art. */
function trimToContent(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return canvas;
  const pad = 4;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const out = document.createElement("canvas");
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext("2d")!.drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

async function rasterize(def: StickerDef): Promise<RasterSticker> {
  const canvas = document.createElement("canvas");
  canvas.width = RASTER_SIZE;
  canvas.height = RASTER_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser");

  if (def.kind === "emoji") {
    ctx.font = `${Math.round(RASTER_SIZE * 0.8)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(def.char, RASTER_SIZE / 2, RASTER_SIZE / 2 + RASTER_SIZE * 0.04);
  } else {
    const img = await loadImage(stickerThumbSrc(def)!);
    const scale = Math.min(RASTER_SIZE / img.width, RASTER_SIZE / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (RASTER_SIZE - w) / 2, (RASTER_SIZE - h) / 2, w, h);
  }

  const trimmed = trimToContent(canvas);
  const blob = await new Promise<Blob>((resolve, reject) =>
    trimmed.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode sticker"))), "image/png")
  );
  return { blob, url: URL.createObjectURL(blob), width: trimmed.width, height: trimmed.height };
}

/** Cached per sticker id for the page's lifetime - the object URLs are
 * reused by every placed copy of the same sticker.
 */
export function rasterizeSticker(id: string): Promise<RasterSticker> {
  const existing = cache.get(id);
  if (existing) return existing;
  const def = getStickerDef(id);
  if (!def) return Promise.reject(new Error(`Unknown sticker: ${id}`));
  const p = rasterize(def);
  cache.set(id, p);
  p.catch(() => cache.delete(id));
  return p;
}
