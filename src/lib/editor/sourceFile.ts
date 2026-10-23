/** What every source has, whether its bytes are in memory (`file`) or it
 * stays on disk (`disk`, desktop app). Code that needs the bytes asks
 * sourceFile(), which reads a disk source only then. */
import { readDiskFile } from "../platform/media.ts";
import type { MediaSource } from "./types.ts";

export const sourceName = (s: MediaSource): string => s.file?.name ?? s.disk?.name ?? "";
export const sourceSize = (s: MediaSource): number => s.file?.size ?? s.disk?.size ?? 0;
export const sourceType = (s: MediaSource): string => s.file?.type ?? s.disk?.type ?? "";

const read = new WeakMap<MediaSource, Promise<File>>();

/** The source's contents. A disk source is read once per source object;
 * a failed read is retried next time. */
export function sourceFile(s: MediaSource): Promise<File> {
  if (s.file) return Promise.resolve(s.file);
  if (!s.disk) return Promise.reject(new Error("This source has no file."));
  let p = read.get(s);
  if (!p) {
    p = readDiskFile(s.disk);
    read.set(s, p);
    p.catch(() => read.delete(s));
  }
  return p;
}

/** What to hand the tools API (toolsApi.ts MediaInput): the disk file when
 * the source stays on disk, so the local engine can read it by path. */
export function sourceInput(s: MediaSource): File | NonNullable<MediaSource["disk"]> {
  if (s.disk) return s.disk;
  if (s.file) return s.file;
  throw new Error("This source has no file.");
}
