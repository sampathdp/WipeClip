import notes from "../../desktop/release-notes.json";

export type Release = { version: string; date: string; notes: string[] };

/** Desktop app releases, newest first. The same file the app shows after an
 * update (desktop/release-notes.json), so the site never drifts from it. */
export const RELEASES: Release[] = notes.releases;

export const LATEST_RELEASE: Release = RELEASES[0];
