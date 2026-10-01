import { useCallback, useReducer } from "react";
import type { Project } from "./types";

const MAX_HISTORY = 200;

interface HistoryState {
  past: Project[];
  present: Project;
  future: Project[];
  /** Snapshot taken when a drag started; see beginGesture(). */
  gestureBase: Project | null;
}

type Action =
  | { type: "apply"; fn: (p: Project) => Project; record: boolean }
  | { type: "begin" }
  | { type: "end" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; project: Project };

function reducer(state: HistoryState, action: Action): HistoryState {
  switch (action.type) {
    case "apply": {
      const next = action.fn(state.present);
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
        present: state.present,
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
export function useProjectHistory(initial: Project) {
  const [state, dispatch] = useReducer(reducer, {
    past: [],
    present: initial,
    future: [],
    gestureBase: null,
  });

  const apply = useCallback(
    (fn: (p: Project) => Project, record = true) => dispatch({ type: "apply", fn, record }),
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
