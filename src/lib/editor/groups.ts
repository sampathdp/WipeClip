/** Groups: items that are picked, moved, copied and deleted together
 * (Ctrl+G / Ctrl+Shift+G). A group is a list of item keys (multiSelect.ts:
 * "clip:<id>", "overlay:<id>", ...); clicking any member picks them all.
 * Clips in a group are reordered as one block. Members that no longer
 * exist are ignored, and a group with fewer than two left is dropped.
 *
 * Pure - see tests/desktop/groups.test.ts. */
import { existingKeys } from "./multiSelect.ts";
import { newId } from "./timeline.ts";
import type { Group, Project } from "./types.ts";

export type { Group };

/** Colors for the stripe marking a group's items (by group order). */
export const GROUP_COLORS = ["#f472b6", "#a78bfa", "#34d399", "#fbbf24", "#60a5fa", "#f87171"];

/** The project's groups with only members that still exist (and at least two). */
export function liveGroups(p: Project): Group[] {
  return (p.groups ?? []).map((g) => ({ ...g, keys: existingKeys(p, g.keys) })).filter((g) => g.keys.length >= 2);
}

/** Groups `keys` (taking them out of any group they were in). */
export function makeGroup(p: Project, keys: string[]): { groups: Group[]; group: Group } | null {
  const members = [...new Set(existingKeys(p, keys))];
  if (members.length < 2) return null;
  const group: Group = { id: newId("grp"), keys: members };
  const others = liveGroups(p)
    .map((g) => ({ ...g, keys: g.keys.filter((k) => !members.includes(k)) }))
    .filter((g) => g.keys.length >= 2);
  return { groups: [...others, group], group };
}

/** Ungroups every group holding any of `keys`; how many were. */
export function ungroup(p: Project, keys: string[]): { groups: Group[]; count: number } {
  const all = liveGroups(p);
  const kept = all.filter((g) => !g.keys.some((k) => keys.includes(k)));
  return { groups: kept, count: all.length - kept.length };
}

export function groupOf(p: Project, key: string | null): Group | null {
  if (!key) return null;
  return liveGroups(p).find((g) => g.keys.includes(key)) ?? null;
}

/** Group colors by item key, for the timeline. */
export function groupColors(p: Project): Map<string, string> {
  const out = new Map<string, string>();
  liveGroups(p).forEach((g, i) => g.keys.forEach((k) => out.set(k, GROUP_COLORS[i % GROUP_COLORS.length])));
  return out;
}

/** Moves the clip at `from` to `to` (an index among the *other* clips, as
 * the timeline's drag gives it). When it's in a group with other clips,
 * the group's clips move together, in their order, to where it was
 * dropped; the drop target is the first other clip at or after `to` that
 * isn't one of them. */
export function moveClipWithGroup(p: Project, from: number, to: number): Project {
  const dragged = p.clips[from];
  if (!dragged) return p;
  const g = groupOf(p, `clip:${dragged.id}`);
  const block = new Set(g ? g.keys.filter((k) => k.startsWith("clip:")).map((k) => k.slice(5)) : [dragged.id]);
  const others = p.clips.filter((c) => c.id !== dragged.id);
  const anchor = others.slice(Math.max(0, to)).find((c) => !block.has(c.id)) ?? null;
  const moving = p.clips.filter((c) => block.has(c.id));
  const rest = p.clips.filter((c) => !block.has(c.id));
  const at = anchor ? rest.indexOf(anchor) : rest.length;
  const clips = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  return clips.every((c, i) => c === p.clips[i]) ? p : { ...p, clips };
}
