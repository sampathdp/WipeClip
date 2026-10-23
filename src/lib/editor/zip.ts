/** Minimal ZIP container, "stored" (uncompressed) entries only - for
 * project files (projectFile.ts). Videos don't compress, and stored entries
 * let a reader hand out each entry as a slice of the original Blob, so
 * opening a project file never copies its videos into memory.
 *
 * Limits: no ZIP64 (every entry and the whole file under 4 GiB, fewer than
 * 65 535 entries), no encryption, no compression on read. Any ZIP tool can
 * open what this writes.
 */

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const UTF8_NAMES = 0x0800;
const MAX_32 = 0xffffffff;

export class ZipError extends Error {}

let crcTable: Uint32Array | null = null;
function table(): Uint32Array {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

/** CRC-32 of a Blob, read in chunks (a video isn't loaded whole). */
export async function crc32(blob: Blob): Promise<number> {
  const t = table();
  let c = 0xffffffff;
  const chunk = 8 << 20;
  for (let at = 0; at < blob.size; at += chunk) {
    const bytes = new Uint8Array(await blob.slice(at, at + chunk).arrayBuffer());
    for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export interface ZipEntry {
  name: string;
  data: Blob;
}

/** A ZIP of `entries`. The Blob references the entries' data rather than
 * copying it. */
export async function buildZip(entries: ZipEntry[], now = new Date()): Promise<Blob> {
  if (entries.length >= 0xffff) throw new ZipError("Too many files for one project file.");
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(now);
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const size = e.data.size;
    if (size > MAX_32 || offset > MAX_32) throw new ZipError("This project is too large to save as one file (4 GB limit).");
    const crc = await crc32(e.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, LOCAL, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, UTF8_NAMES, true);
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, name, e.data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, CENTRAL, true);
    cd.setUint16(4, 20, true); // made by
    cd.setUint16(6, 20, true); // needed
    cd.setUint16(8, UTF8_NAMES, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    const rec = new Uint8Array(46 + name.length);
    rec.set(new Uint8Array(cd.buffer), 0);
    rec.set(name, 46);
    central.push(rec);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  if (offset + cdSize > MAX_32) throw new ZipError("This project is too large to save as one file (4 GB limit).");
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, END, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
}

/** The entries of a ZIP made of stored entries, each a slice of `zip`
 * (nothing is copied). CRCs aren't checked here; callers that parse an
 * entry check what they read. */
export async function readZip(zip: Blob): Promise<Map<string, Blob>> {
  const tailSize = Math.min(zip.size, 22 + 0xffff);
  const tail = new DataView(await zip.slice(zip.size - tailSize).arrayBuffer());
  let endAt = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === END) {
      endAt = i;
      break;
    }
  }
  if (endAt < 0) throw new ZipError("Not a project file.");
  const count = tail.getUint16(endAt + 10, true);
  const cdSize = tail.getUint32(endAt + 12, true);
  const cdOffset = tail.getUint32(endAt + 16, true);
  if (cdOffset + cdSize > zip.size) throw new ZipError("The project file is incomplete.");
  const cd = new DataView(await zip.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const dec = new TextDecoder();
  const out = new Map<string, Blob>();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== CENTRAL) throw new ZipError("The project file is damaged.");
    const method = cd.getUint16(p + 10, true);
    const compressed = cd.getUint32(p + 20, true);
    const size = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    const localAt = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (method !== 0 || compressed !== size) throw new ZipError("The project file uses compression, which WipeClip doesn't read. Save it again from WipeClip.");
    const local = new DataView(await zip.slice(localAt, localAt + 30).arrayBuffer());
    if (local.byteLength < 30 || local.getUint32(0, true) !== LOCAL) throw new ZipError("The project file is damaged.");
    const dataAt = localAt + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    if (dataAt + size > zip.size) throw new ZipError("The project file is incomplete.");
    out.set(name, zip.slice(dataAt, dataAt + size));
  }
  return out;
}
