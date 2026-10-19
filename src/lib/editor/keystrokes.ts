/** Keyboard-shortcut indicators ("Ctrl+C") from recorded shortcut events.
 * Pure - see tests/desktop/tutorial.test.ts.
 *
 * The recorder only ever stores shortcut combinations and function keys -
 * typed text never reaches the recording (src-tauri/src/input/keys.rs) -
 * so there is no typed text to reconstruct here. Users can still hide
 * individual combos (e.g. a shortcut that reveals something private). The
 * indicators are ordinary text layers flagged `keystroke`, so they're
 * edited, styled, timed and exported like any other text.
 */
import type { Act } from "./insights.ts";
import type { Overlay, TextStyle } from "./types.ts";

export interface KeystrokeSettings {
  /** Seconds each indicator stays up. */
  duration: number;
  /** Combos never shown, e.g. "Ctrl+Shift+P". */
  hidden: string[];
  /** Vertical position, fraction of canvas height. */
  y: number;
  /** Text size, fraction of canvas height. */
  size: number;
  style: "dark" | "light" | "accent";
}

export const DEFAULT_KEYSTROKES: KeystrokeSettings = { duration: 1.2, hidden: [], y: 0.88, size: 0.045, style: "dark" };

/** Keycap look: bold, tight, on a solid rounded background. */
const KEY_TEXT: TextStyle = {
  content: "",
  font: "inter",
  size: 0.045,
  weight: 700,
  italic: false,
  color: "#ffffff",
  background: "#111827",
  backgroundOpacity: 0.85,
  strokeColor: "#000000",
  strokeWidth: 0,
  shadow: false,
  align: "center",
  letterSpacing: 0.02,
  lineHeight: 1.15,
};

const STYLES: Record<KeystrokeSettings["style"], Pick<TextStyle, "color" | "background" | "backgroundOpacity" | "strokeWidth">> = {
  dark: { color: "#ffffff", background: "#111827", backgroundOpacity: 0.85, strokeWidth: 0 },
  light: { color: "#111827", background: "#ffffff", backgroundOpacity: 0.9, strokeWidth: 0 },
  accent: { color: "#ffffff", background: "#7c3aed", backgroundOpacity: 0.9, strokeWidth: 0 },
};

/** "Ctrl+Shift+S" -> "Ctrl + Shift + S", and macOS names as symbols. */
export function displayCombo(combo: string, mac: boolean): string {
  const symbols: Record<string, string> = { Cmd: "⌘", Option: "⌥", Shift: "⇧", Ctrl: "⌃" };
  const parts = combo.split("+");
  return mac ? parts.map((p) => symbols[p] ?? p).join("") : parts.join(" + ");
}

export function keystrokeOverlays(acts: Act[], s: KeystrokeSettings, total: number, mac: boolean, ids: () => string): Overlay[] {
  const keys = acts.filter((a) => a.kind === "key" && a.label && !s.hidden.includes(a.label));
  const out: Overlay[] = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const prev = out[out.length - 1];
    const text = displayCombo(k.label!, mac);
    // The next shortcut replaces this one instead of stacking on top.
    if (prev && prev.start + 0.05 > k.t) continue;
    if (prev && prev.end > k.t) prev.end = k.t;
    const end = Math.min(total, k.t + s.duration);
    if (end - k.t < 0.2) continue;
    out.push({
      id: ids(),
      kind: "text",
      keystroke: true,
      start: k.t,
      end,
      x: 0.5,
      y: s.y,
      width: 0.3,
      rotation: 0,
      opacity: 1,
      animIn: "pop",
      animOut: "fade",
      hidden: false,
      locked: false,
      text: { ...KEY_TEXT, ...STYLES[s.style], content: text, size: s.size },
    });
  }
  return out;
}

/** Distinct combos in the recording with how often each was pressed. */
export function comboCounts(acts: Act[]): { combo: string; count: number }[] {
  const m = new Map<string, number>();
  for (const a of acts) if (a.kind === "key" && a.label) m.set(a.label, (m.get(a.label) ?? 0) + 1);
  return [...m.entries()].map(([combo, count]) => ({ combo, count })).sort((a, b) => b.count - a.count);
}
