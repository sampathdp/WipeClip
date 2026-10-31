/** Modifier names for shortcut hints: "Cmd"/"Option" on a Mac (the desktop
 * app or a browser), "Ctrl"/"Alt" elsewhere. Only the wording changes; the
 * editor's key handlers already accept either (ctrlKey || metaKey).
 */
import { useSyncExternalStore } from "react";

const isMac = (): boolean => typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.userAgent);

/** For messages built at run time (after a click). */
export const modKey = (): "Cmd" | "Ctrl" => (isMac() ? "Cmd" : "Ctrl");
export const altKey = (): "Option" | "Alt" => (isMac() ? "Option" : "Alt");

const subscribe = () => () => {};

/** For rendered text: "Ctrl"/"Alt" in the prerendered HTML and during
 * hydration (so the two match), the real names right after. */
export function useShortcutKeys(): { mod: "Cmd" | "Ctrl"; alt: "Option" | "Alt" } {
  const mac = useSyncExternalStore(subscribe, isMac, () => false);
  return mac ? { mod: "Cmd", alt: "Option" } : { mod: "Ctrl", alt: "Alt" };
}
