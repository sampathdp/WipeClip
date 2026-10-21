import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { clientIp } from "./clientIp";

/** Distributed when UPSTASH_REDIS_REST_URL/TOKEN are configured (each
 * distinct `limit`+`windowMs` pair gets its own Ratelimit instance, cached
 * below); otherwise falls back to the previous in-memory fixed-window
 * counter, same "no-op until configured" pattern as the rest of this
 * project's optional integrations. The in-memory path is NOT distributed -
 * each serverless instance has its own memory, so it only caps abuse
 * per-instance rather than globally across a deployment. Good enough to
 * blunt casual hammering of a route without a hard dependency on Upstash
 * for local dev.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

// Prevents unbounded growth from unique keys (e.g. spoofed IPs) that never
// come back to get cleaned up on their own expiry check.
const MAX_TRACKED_KEYS = 50_000;

function checkRateLimitInMemory(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_TRACKED_KEYS) buckets.clear();
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (existing.count >= limit) return false;
  existing.count += 1;
  return true;
}

function isUpstashConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

let redis: Redis | null = null;
const limiters = new Map<string, Ratelimit>();

function getLimiter(limit: number, windowMs: number): Ratelimit {
  const cacheKey = `${limit}:${windowMs}`;
  const existing = limiters.get(cacheKey);
  if (existing) return existing;

  if (!redis) redis = Redis.fromEnv();
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.fixedWindow(limit, `${windowMs} ms`),
    prefix: "wipeclip-ratelimit",
  });
  limiters.set(cacheKey, limiter);
  return limiter;
}

export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  if (!isUpstashConfigured()) {
    return checkRateLimitInMemory(key, limit, windowMs);
  }
  const { success } = await getLimiter(limit, windowMs).limit(key);
  return success;
}

export function rateLimitKeyFor(request: Request, userId?: string): string {
  if (userId) return `user:${userId}`;
  return `ip:${clientIp(request.headers) ?? "unknown"}`;
}
