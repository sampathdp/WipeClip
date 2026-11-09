import notes from "../../desktop/release-notes.json";

export type Release = { version: string; date: string; notes: string[] };

/** Desktop app releases, newest first. The same file the app shows after an
 * update (desktop/release-notes.json), so the site never drifts from it. */
export const RELEASES: Release[] = notes.releases;

export const LATEST_RELEASE: Release = RELEASES[0];

export type SpotlightNote = { version: string; headline?: string; text: string; kind: "new" | "fixed" | "other" };

/** The homepage "What's new" cards: every note of the latest release, topped
 * up from earlier releases when it has fewer than `min` (a small bug-fix
 * release), at most `max`. A note "Headline: rest" is split at the colon. */
export function spotlightNotes(min = 4, max = 6): SpotlightNote[] {
  const out: SpotlightNote[] = [];
  for (const r of RELEASES) {
    if (out.length >= min) break;
    for (const note of r.notes) {
      const colon = note.indexOf(": ");
      const split = colon > 0 && colon <= 60;
      const rest = split ? note.slice(colon + 2) : note;
      out.push({
        version: r.version,
        headline: split ? note.slice(0, colon) : undefined,
        text: split ? rest.charAt(0).toUpperCase() + rest.slice(1) : note,
        kind: note.startsWith("Fixed") ? "fixed" : note.startsWith("New") ? "new" : "other",
      });
    }
  }
  return out.slice(0, max);
}
