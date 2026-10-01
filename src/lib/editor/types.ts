/** Browser editor project model. Non-destructive: the uploaded file is
 * never modified - the project only describes which source ranges play in
 * which order, what joins them, and what's drawn on top. The backend's
 * export (backend/app/pipeline/editor.py) renders exactly this model.
 */

export type TransitionType =
  | "fade"
  | "crossfade"
  | "dipblack"
  | "dipwhite"
  | "slideleft"
  | "slideright"
  | "zoom"
  | "blur";

export interface Transition {
  type: TransitionType;
  duration: number; // seconds
}

/** A playable range of one source. `start`/`end` are source time; where
 * the clip sits on the timeline is derived from clip order (see layout()).
 */
export interface Clip {
  id: string;
  sourceId: string;
  start: number;
  end: number;
  /** Transition into the *next* clip; ignored on the last clip. */
  transition: Transition | null;
}

export type StickerAnimIn = "none" | "fade" | "pop" | "slide";
export type StickerAnimOut = "none" | "fade" | "slide";

export interface Sticker {
  id: string;
  stickerId: string; // key into the sticker library (src/lib/editor/stickers.ts)
  start: number; // timeline seconds
  end: number;
  x: number; // center, fraction of canvas width
  y: number; // center, fraction of canvas height
  width: number; // fraction of canvas width (height follows the image's aspect)
  rotation: number; // degrees, clockwise
  animIn: StickerAnimIn;
  animOut: StickerAnimOut;
}

/** The undoable part of the editor state. */
export interface Project {
  clips: Clip[];
  stickers: Sticker[];
}

/** An imported or AI-cleaned video. Kept outside Project (and so outside
 * undo history) - sources are only ever added, so undoing an AI cleanup
 * just points the clip back at the original, which is still here.
 */
export interface MediaSource {
  id: string;
  kind: "original" | "cleaned";
  file: File;
  url: string; // object URL for preview
  duration: number;
  width: number; // display size, as the browser reports it
  height: number;
  fps: number;
  hasAudio: boolean;
}

export type Selection =
  | { kind: "clip"; id: string }
  | { kind: "transition"; clipId: string }
  | { kind: "sticker"; id: string }
  | null;
