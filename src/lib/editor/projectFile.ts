/** Project files (.wipeclip): a whole project - edits and every file it
 * uses - in one file, to move it to another computer or keep a copy
 * outside the app. A plain ZIP (zip.ts) of stored entries:
 *
 *   project.json                  ProjectFileManifest below
 *   media/<source id>/<file name> each source file, unchanged
 *   media/<source id>.recording.json   recording details, if any
 *
 * Opening one treats it as untrusted input: the manifest is checked for
 * shape, every referenced source must be present, and media types are
 * limited to video, audio and images. Exports and AI cleanup re-check the
 * videos on the server as they do for any project.
 */
import { newId } from "./timeline.ts";
import { migrateProject, type MediaSource, type Project } from "./types.ts";
import { buildZip, readZip, ZipError } from "./zip.ts";
import { sourceFile, sourceName, sourceType } from "./sourceFile.ts";

export const PROJECT_FILE_EXT = "wipeclip";
const FORMAT = "wipeclip-project";
/** Bumped when a reader of the previous version couldn't open the file. */
export const PROJECT_FILE_VERSION = 1;
const MAX_MANIFEST_BYTES = 50 << 20;
const MAX_RECORDING_BYTES = 200 << 20;
const MEDIA_TYPE = /^(video|audio|image)\/[\w.+-]+$/;
const KINDS = new Set<MediaSource["kind"]>(["original", "cleaned", "audio", "image", "layer", "take"]);

export class ProjectFileError extends Error {}

interface SourceEntry {
  id: string;
  kind: MediaSource["kind"];
  name: string;
  type: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  path: string;
  recording?: string;
}

interface ProjectFileManifest {
  format: typeof FORMAT;
  version: number;
  name: string;
  createdAt: number;
  savedAt: number;
  project: Project;
  sources: SourceEntry[];
}

/** File name for a project's file: its name, made safe for every OS. */
export function projectFileName(name: string): string {
  const safe = name.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 120);
  return `${safe || "project"}.${PROJECT_FILE_EXT}`;
}

const mediaPath = (s: MediaSource) => `media/${s.id}/${sourceName(s).replace(/[\u0000-\u001f/\\]+/g, "_") || "file"}`;

/** Source ids the project refers to, so a file can't open with a clip or
 * layer pointing at nothing. */
export function referencedSources(p: Project): Set<string> {
  const ids = new Set<string>();
  for (const c of p.clips) ids.add(c.sourceId);
  for (const o of p.overlays) if ("sourceId" in o && typeof o.sourceId === "string") ids.add(o.sourceId);
  for (const a of p.audio) ids.add(a.sourceId);
  if (p.canvas.background.type === "image") ids.add(p.canvas.background.sourceId);
  for (const z of p.zooms ?? []) if (z.sourceId) ids.add(z.sourceId);
  for (const m of p.masks ?? []) if (m.sourceId) ids.add(m.sourceId);
  return ids;
}

/** The project with every source id replaced through `map`. Opened files
 * get fresh ids, so opening the same file twice gives two independent
 * projects that never share stored files. */
export function remapSources(p: Project, map: Map<string, string>): Project {
  const to = (id: string) => map.get(id) ?? id;
  return {
    ...p,
    clips: p.clips.map((c) => ({ ...c, sourceId: to(c.sourceId) })),
    overlays: p.overlays.map((o) => ("sourceId" in o && typeof o.sourceId === "string" ? { ...o, sourceId: to(o.sourceId) } : o)),
    audio: p.audio.map((a) => ({ ...a, sourceId: to(a.sourceId) })),
    canvas: p.canvas.background.type === "image" ? { ...p.canvas, background: { ...p.canvas.background, sourceId: to(p.canvas.background.sourceId) } } : p.canvas,
    zooms: p.zooms?.map((z) => (z.sourceId ? { ...z, sourceId: to(z.sourceId) } : z)),
    masks: p.masks?.map((m) => (m.sourceId ? { ...m, sourceId: to(m.sourceId) } : m)),
  };
}

export async function createProjectFile(info: { name: string; createdAt: number }, project: Project, sources: MediaSource[]): Promise<Blob> {
  const used = referencedSources(project);
  // Only what the project uses: undo history (and so unused AI-cleaned
  // versions) isn't saved in the file.
  const kept = sources.filter((s) => used.has(s.id));
  // Sources that stay on disk are read here, to go into the file.
  const entries = await Promise.all(kept.map(async (s) => ({ name: mediaPath(s), data: (await sourceFile(s)) as Blob })));
  const sourceEntries: SourceEntry[] = kept.map((s) => {
    const entry: SourceEntry = {
      id: s.id,
      kind: s.kind,
      name: sourceName(s),
      type: sourceType(s),
      duration: s.duration,
      width: s.width,
      height: s.height,
      fps: s.fps,
      hasAudio: s.hasAudio,
      path: mediaPath(s),
    };
    if (s.recording) {
      entry.recording = `media/${s.id}.recording.json`;
      entries.push({ name: entry.recording, data: new Blob([JSON.stringify(s.recording)], { type: "application/json" }) });
    }
    return entry;
  });
  const manifest: ProjectFileManifest = {
    format: FORMAT,
    version: PROJECT_FILE_VERSION,
    name: info.name,
    createdAt: info.createdAt,
    savedAt: Date.now(),
    project,
    sources: sourceEntries,
  };
  entries.unshift({ name: "project.json", data: new Blob([JSON.stringify(manifest)], { type: "application/json" }) });
  return buildZip(entries);
}

export interface OpenedProjectFile {
  name: string;
  project: Project;
  sources: MediaSource[];
}

const num = (v: unknown, min = 0) => typeof v === "number" && Number.isFinite(v) && v >= min;

async function readJson(blob: Blob | undefined, max: number, what: string): Promise<unknown> {
  if (!blob) throw new ProjectFileError(`The project file is missing ${what}.`);
  if (blob.size > max) throw new ProjectFileError(`The project file's ${what} is too large.`);
  try {
    return JSON.parse(await blob.text());
  } catch {
    throw new ProjectFileError(`The project file's ${what} is damaged.`);
  }
}

/** Opens a .wipeclip file. Source files are slices of `file`, not copies.
 * Throws ProjectFileError with a message for the user. */
export async function readProjectFile(file: Blob): Promise<OpenedProjectFile> {
  let entries: Map<string, Blob>;
  try {
    entries = await readZip(file);
  } catch (e) {
    throw new ProjectFileError(e instanceof ZipError ? e.message : "This isn't a WipeClip project file.");
  }
  const m = (await readJson(entries.get("project.json"), MAX_MANIFEST_BYTES, "project details")) as Partial<ProjectFileManifest> | null;
  if (!m || m.format !== FORMAT) throw new ProjectFileError("This isn't a WipeClip project file.");
  if (!num(m.version, 1) || m.version! > PROJECT_FILE_VERSION) {
    throw new ProjectFileError("This project file was saved by a newer version of WipeClip. Update the app to open it.");
  }
  if (!Array.isArray(m.sources) || !m.project || !Array.isArray(m.project.clips) || m.project.clips.length === 0) {
    throw new ProjectFileError("The project file is damaged.");
  }
  let project: Project;
  try {
    project = migrateProject(m.project);
  } catch {
    throw new ProjectFileError("The project file is damaged.");
  }

  const sources: MediaSource[] = [];
  const ids = new Set<string>();
  try {
    for (const s of m.sources as Partial<SourceEntry>[]) {
      const ok =
        typeof s.id === "string" &&
        /^[\w-]{1,80}$/.test(s.id) &&
        !ids.has(s.id) &&
        KINDS.has(s.kind as MediaSource["kind"]) &&
        typeof s.name === "string" &&
        typeof s.type === "string" &&
        MEDIA_TYPE.test(s.type) &&
        typeof s.path === "string" &&
        num(s.duration) &&
        num(s.width) &&
        num(s.height) &&
        num(s.fps) &&
        typeof s.hasAudio === "boolean";
      if (!ok) throw new ProjectFileError("The project file is damaged.");
      const data = entries.get(s.path!);
      if (!data) throw new ProjectFileError(`The project file is missing "${s.name}".`);
      const f = new File([data], s.name!.slice(0, 255), { type: s.type });
      const src: MediaSource = {
        id: s.id!,
        kind: s.kind!,
        file: f,
        url: "",
        duration: s.duration!,
        width: s.width!,
        height: s.height!,
        fps: s.fps!,
        hasAudio: s.hasAudio!,
      };
      if (s.recording) {
        src.recording = (await readJson(entries.get(s.recording), MAX_RECORDING_BYTES, "recording details")) as MediaSource["recording"];
      }
      ids.add(src.id);
      sources.push(src);
    }
    for (const id of referencedSources(project)) {
      if (!ids.has(id)) throw new ProjectFileError("The project file is damaged: a clip's video is missing.");
    }
  } catch (e) {
    throw e instanceof ProjectFileError ? e : new ProjectFileError("The project file is damaged.");
  }
  const fresh = new Map(sources.map((s) => [s.id, newId("src")]));
  for (const s of sources) {
    s.id = fresh.get(s.id)!;
    s.url = URL.createObjectURL(s.file!);
  }
  const name = typeof m.name === "string" && m.name.trim() ? m.name.trim().slice(0, 120) : "Imported project";
  return { name, project: remapSources(project, fresh), sources };
}
