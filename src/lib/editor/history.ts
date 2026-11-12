import { useCallback, useLayoutEffect, useReducer, useRef } from "react";
import type { Project } from "./types";
import { withMagnet } from "./audioMagnet.ts";
import { onlyClipsChanged } from "./follow.ts";

/** Moves the layers of `prev` the way the clips moved in `next` (follow.ts). */
export type FollowFn = (prev: Project, next: Project) => Project;

const MAX_HISTORY = 200;

export interface HistoryState {
  past: Project[];
  present: Project;
  future: Project[];
  /** Snapshot taken when a drag started; see beginGesture(). */
  gestureBase: Project | null;
}

export type HistoryAction =
  | { type: "apply"; fn: (p: Project) => Project; record: boolean; follow?: FollowFn }
  | { type: "begin" }
  | { type: "end" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; project: Project };

/** Layers following the clips: an edit that changed only the clips gets
 * its layers moved by `follow`. Inside a drag each step is measured from
 * where the drag started, so trimming a clip shorter and back gives the
 * layers back too. */
function withFollow(state: HistoryState, raw: Project, follow?: FollowFn): Project {
  if (!follow || raw.linkLayers === false || !onlyClipsChanged(state.present, raw)) return raw;
  const base = state.gestureBase;
  if (!base) return follow(state.present, raw);
  return follow(base, {
    ...raw,
    overlays: base.overlays,
    audio: base.audio,
    effects: base.effects,
    masks: base.masks,
    suggestions: base.suggestions,
    chapters: base.chapters,
    markers: base.markers,
    transcript: base.transcript,
  });
}

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "apply": {
      // Magnetic audio (audioMagnet.ts): every edit keeps the parts packed;
      // a drag packs once, when it ends (each drag step is measured from
      // where the part was, so packing mid-drag would compound a trim).
      const raw = withFollow(state, action.fn(state.present), action.follow);
      const next = state.gestureBase ? raw : withMagnet(state.present, raw);
      if (next === state.present) return state;
      // Inside a gesture, intermediate drag positions replace the present
      // without history entries; end() records the whole drag as one step.
      if (!action.record || state.gestureBase) return { ...state, present: next };
      return {
        ...state,
        past: [...state.past, state.present].slice(-MAX_HISTORY),
        present: next,
        future: [],
      };
    }
    case "begin":
      return state.gestureBase ? state : { ...state, gestureBase: state.present };
    case "end": {
      const base = state.gestureBase;
      if (!base) return state;
      if (base === state.present) return { ...state, gestureBase: null };
      return {
        past: [...state.past, base].slice(-MAX_HISTORY),
        present: withMagnet(base, state.present),
        future: [],
        gestureBase: null,
      };
    }
    case "undo": {
      if (state.past.length === 0 || state.gestureBase) return state;
      const prev = state.past[state.past.length - 1];
      return { ...state, past: state.past.slice(0, -1), present: prev, future: [state.present, ...state.future] };
    }
    case "redo": {
      if (state.future.length === 0 || state.gestureBase) return state;
      const [next, ...rest] = state.future;
      return { ...state, past: [...state.past, state.present], present: next, future: rest };
    }
    case "reset":
      return { past: [], present: action.project, future: [], gestureBase: null };
  }
}

/** Undo/redo over the Project. Every editor operation goes through
 * `apply`; a drag (trim handle, sticker move/resize/rotate, timing bar)
 * brackets its many intermediate updates with beginGesture/endGesture so
 * one drag is one undo step.
 */
export function useProjectHistory(initial: Project, follow?: FollowFn) {
  const followRef = useRef(follow);
  useLayoutEffect(() => {
    followRef.current = follow;
  });
  const [state, dispatch] = useReducer(historyReducer, {
    past: [],
    present: initial,
    future: [],
    gestureBase: null,
  });

  const apply = useCallback(
    (fn: (p: Project) => Project, record = true) => dispatch({ type: "apply", fn, record, follow: followRef.current }),
    []
  );
  const beginGesture = useCallback(() => dispatch({ type: "begin" }), []);
  const endGesture = useCallback(() => dispatch({ type: "end" }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const reset = useCallback((project: Project) => dispatch({ type: "reset", project }), []);

  return {
    project: state.present,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    apply,
    beginGesture,
    endGesture,
    undo,
    redo,
    reset,
  };
}
