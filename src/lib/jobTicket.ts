import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Redis } from "@upstash/redis";

/** Signed, single-use permission for one heavy backend job.
 *
 * Video uploads are too big to pass through a Vercel function (~4.5 MB body
 * limit) and jobs run longer than its time limit, so the browser sends them
 * straight to the backend. Our routes still decide everything billing- and
 * plan-related (credits, resolution, branding, quality), and put it in a
 * ticket signed with INTERNAL_API_SECRET; the backend only acts on what a
 * valid ticket says (see backend/app/tickets.py). Before running the job the
 * backend claims the ticket through /api/internal/ticket, so one ticket can
 * never run two jobs, and a failed paid job is refunded the same way.
 *
 * Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload)).
 */

export interface ExportTicket {
  kind: "export";
  resolution: string;
  branding: boolean;
  compact: boolean;
  /** sha256 hex of the exact project JSON string that was checked. */
  projectHash: string;
  /** For the desktop app's own engine; the cloud backend refuses it. */
  local?: boolean;
}

export interface ProcessTicket {
  kind: "process";
  resolution: string;
  quality: "standard" | "pro";
  /** Who to refund if the job fails; null for anonymous (free) previews. */
  userId: string | null;
  cost: number;
  /** Longest video (seconds, after any range cut) this ticket paid for; the
   * backend refuses a longer one. Unset on local tickets, where only the
   * backend's own ceiling applies. */
  maxSeconds?: number;
  /** Runs on the desktop app's own engine, so it costs no credits (cost 0)
   * and the cloud backend refuses it (backend/app/tickets.py). */
  local?: boolean;
}

/** Permission to upload one video to the backend and probe it (see
 * /api/upload-ticket). Without it, /api/video/upload-url and
 * /api/video/probe would be open to anyone who finds the backend's URL. */
export interface UploadTicket {
  kind: "upload";
  /** The largest file the backend may sign an upload URL for. */
  maxBytes: number;
}

export type TicketBody = ExportTicket | ProcessTicket | UploadTicket;
export type Ticket = TicketBody & { id: string; exp: number };

// Long enough for a slow upload of a big video: the backend verifies the
// ticket only after the whole request body has arrived.
const TICKET_TTL_MS = 60 * 60 * 1000;
// Upload tickets cover a single file's upload and probe, asked for right
// before them, so they can be shorter lived.
const UPLOAD_TICKET_TTL_MS = 30 * 60 * 1000;

function secret(): string {
  // Unset in local dev - the backend skips the signature check then too,
  // same "no-op until configured" pattern as INTERNAL_API_SECRET elsewhere.
  return process.env.INTERNAL_API_SECRET ?? "";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function issueTicket(body: TicketBody): string {
  const ttl = body.kind === "upload" ? UPLOAD_TICKET_TTL_MS : TICKET_TTL_MS;
  const ticket: Ticket = { ...body, id: randomUUID(), exp: Date.now() + ttl };
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** The ticket's contents if the signature is valid (expiry not checked:
 * a refund for a job that started before expiry must still work). */
export function readTicket(token: string): Ticket | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Ticket;
  } catch {
    return null;
  }
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// --- once-only markers (claim / refund) -------------------------------------

const used = new Map<string, number>(); // in-memory fallback: per instance only, like rateLimit.ts
let redis: Redis | null = null;

/** True the first time it's called for `key`, false after that (for
 * TICKET_TTL_MS plus a margin). Distributed when Upstash is configured. */
export async function firstTime(key: string): Promise<boolean> {
  const ttlMs = TICKET_TTL_MS * 2;
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis ??= Redis.fromEnv();
    return (await redis.set(`wipeclip-ticket:${key}`, 1, { nx: true, px: ttlMs })) === "OK";
  }
  const now = Date.now();
  for (const [k, until] of used) if (until <= now) used.delete(k);
  if (used.has(key)) return false;
  used.set(key, now + ttlMs);
  return true;
}
