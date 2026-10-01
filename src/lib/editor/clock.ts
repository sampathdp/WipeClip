import { useSyncExternalStore } from "react";

/** Playhead time as a tiny external store. The preview engine updates it
 * every animation frame; only the components that actually show time
 * (playhead, time readout, sticker overlay) subscribe, so playback doesn't
 * re-render the whole editor 60 times a second.
 */
export interface Clock {
  get: () => number;
  set: (t: number) => void;
  subscribe: (fn: () => void) => () => void;
}

export function createClock(): Clock {
  let time = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => time,
    set: (t) => {
      if (t === time) return;
      time = t;
      listeners.forEach((fn) => fn());
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function useClockTime(clock: Clock): number {
  return useSyncExternalStore(clock.subscribe, clock.get, () => 0);
}
