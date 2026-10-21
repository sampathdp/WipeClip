import { createHmac, timingSafeEqual } from "crypto";
import type { PlanKey } from "./credits";

// Minimal Paddle Billing REST client (https://developer.paddle.com/api-reference).
// Plain fetch, like src/lib/paymentsLk.ts. The keys pick the environment:
// PADDLE_ENVIRONMENT picks the environment (sandbox-api.paddle.com or
// api.paddle.com) and must agree with the keys: `pdl_sdbx_` / `test_` are
// sandbox, `pdl_live_` / `live_` are live. Going live is swapping env vars
// (environment, keys, webhook secret, price IDs) - no code changes.

/** Rejects a webhook whose timestamp is further than this from now (replay guard). */
const WEBHOOK_TOLERANCE_SECONDS = 300;

/** How long the fetched Paddle webhook IP list is trusted before refetching. */
const IP_LIST_TTL_MS = 60 * 60 * 1000;

export type PaddleEnvironment = "sandbox" | "production";

export interface PaddleTransaction {
  id: string;
  status: "draft" | "ready" | "billed" | "paid" | "completed" | "canceled" | "past_due";
  customer_id: string | null;
  currency_code?: string;
  details?: { totals?: { grand_total?: string } } | null;
  custom_data: Record<string, unknown> | null;
  items: { price?: { id: string } | null; price_id?: string; quantity: number }[];
}

/** The data of an adjustment.created / adjustment.updated event. */
export interface PaddleAdjustment {
  id: string;
  action: "refund" | "chargeback" | "chargeback_reverse" | "chargeback_warning" | "credit" | "credit_reverse";
  type?: "full" | "partial";
  status: "pending_approval" | "approved" | "rejected" | "reversed";
  transaction_id: string;
  currency_code?: string;
  totals?: { total?: string } | null;
}

export interface PaddleEvent {
  event_id: string;
  event_type: string;
  occurred_at: string;
  data: PaddleTransaction & Record<string, unknown>;
}

export class PaddleError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
  }
}

// Trimmed: a value pasted into Vercel with a trailing space or newline
// would otherwise be rejected as malformed.
const env = (name: string) => process.env[name]?.trim() || undefined;

export function getApiKey(): string | undefined {
  return env("PADDLE_API_KEY");
}

export function getClientToken(): string | undefined {
  return env("PADDLE_CLIENT_TOKEN");
}

export function getWebhookSecret(): string | undefined {
  return env("PADDLE_WEBHOOK_SECRET");
}

function apiKeyEnvironment(apiKey: string): PaddleEnvironment {
  return apiKey.startsWith("pdl_sdbx_") ? "sandbox" : "production";
}

function clientTokenEnvironment(token: string): PaddleEnvironment {
  return token.startsWith("test_") ? "sandbox" : "production";
}

/** The environment Paddle runs in, or null if Paddle isn't configured (no
 * keys at all - everyone gets Payments.lk). PADDLE_ENVIRONMENT must name it
 * explicitly and match both key prefixes: once any key is set, a missing or
 * mismatched value throws instead of guessing, so the site can never run
 * against the wrong Paddle account. */
export function paddleEnvironment(): PaddleEnvironment | null {
  const apiKey = getApiKey();
  const token = getClientToken();
  if (!apiKey && !token) return null;
  const declared = env("PADDLE_ENVIRONMENT");
  if (declared !== "sandbox" && declared !== "production") {
    throw new Error(`PADDLE_ENVIRONMENT must be "sandbox" or "production" (got ${declared ? `"${declared}"` : "nothing"}).`);
  }
  if (!apiKey || !token || !getWebhookSecret()) {
    throw new Error("Paddle is half configured: set PADDLE_API_KEY, PADDLE_CLIENT_TOKEN and PADDLE_WEBHOOK_SECRET together.");
  }
  if (apiKeyEnvironment(apiKey) !== declared || clientTokenEnvironment(token) !== declared) {
    throw new Error(`PADDLE_ENVIRONMENT is ${declared} but PADDLE_API_KEY or PADDLE_CLIENT_TOKEN belongs to the other environment.`);
  }
  return declared;
}

function apiBase(environment: PaddleEnvironment): string {
  return environment === "sandbox" ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
}

/** The Paddle price for a plan, from PADDLE_PRICE_<PLAN> (e.g.
 * PADDLE_PRICE_STARTER_YEARLY). Sandbox and live price IDs differ, so they
 * live in env vars next to the keys they belong to. */
export function priceIdFor(plan: PlanKey): string | undefined {
  return env(`PADDLE_PRICE_${plan.toUpperCase()}`);
}

async function request<T>(path: string, init: { method: string; body?: unknown }): Promise<T> {
  const apiKey = getApiKey();
  const environment = paddleEnvironment();
  if (!apiKey || !environment) throw new PaddleError("Paddle is not configured.", 501);

  const res = await fetch(`${apiBase(environment)}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Paddle-Version": "1",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = json?.error;
    throw new PaddleError(
      [
        err?.detail ?? `Paddle request failed with ${res.status}.`,
        ...(Array.isArray(err?.errors)
          ? err.errors.map((f: { field?: string; message?: string }) => `${f.field}: ${f.message}`)
          : []),
      ].join(" "),
      res.status,
      err?.code
    );
  }
  return json.data as T;
}

/** Creates a draft transaction for one price, which Paddle.js then opens in
 * its overlay checkout. custom_data comes back on every webhook for it.
 * discountId (dsc_...) applies a promotion; Paddle refuses the transaction
 * if that discount is expired or not restricted to include this price. */
export function createTransaction(params: {
  priceId: string;
  customData: Record<string, string>;
  customerId?: string | null;
  discountId?: string;
}): Promise<PaddleTransaction> {
  return request<PaddleTransaction>("/transactions", {
    method: "POST",
    body: {
      items: [{ price_id: params.priceId, quantity: 1 }],
      custom_data: params.customData,
      ...(params.customerId ? { customer_id: params.customerId } : {}),
      ...(params.discountId ? { discount_id: params.discountId } : {}),
    },
  });
}

/** Creates or updates the Paddle discount behind the promotion
 * (/admin/promotion), so Paddle's percent, prices and expiry always match
 * promo_settings. enabled_for_checkout is off: the server applies it by id
 * after checking the code is used once per account, and nobody can type it
 * into Paddle's checkout (which can only cap total redemptions, not per
 * customer). An inactive promotion archives it. Returns the discount id (dsc_...). */
export async function syncPromoDiscount(params: {
  id: string | null;
  percent: number;
  priceIds: string[];
  expiresAt: Date;
  description: string;
  active: boolean;
}): Promise<string | null> {
  if (!params.active) {
    // Only the status: the expiry may already be in the past, which Paddle refuses.
    if (params.id) await request(`/discounts/${params.id}`, { method: "PATCH", body: { status: "archived" } });
    return params.id;
  }
  const body = {
    description: params.description.slice(0, 500),
    type: "percentage",
    amount: String(params.percent),
    enabled_for_checkout: false,
    recur: false,
    restrict_to: params.priceIds,
    expires_at: params.expiresAt.toISOString(),
  };
  if (!params.id) return (await request<{ id: string }>("/discounts", { method: "POST", body })).id;
  await request(`/discounts/${params.id}`, { method: "PATCH", body: { ...body, status: "active" } });
  return params.id;
}

/** Price IDs on a transaction - Paddle sends the nested price object, older
 * payloads a flat price_id. */
export function transactionPriceIds(txn: PaddleTransaction): string[] {
  return txn.items.map((i) => i.price?.id ?? i.price_id).filter((id): id is string => Boolean(id));
}

/**
 * Verifies the Paddle-Signature header (`ts=<unix seconds>;h1=<hex
 * HMAC-SHA256 of "<ts>:<raw body>">`, with more than one h1 while a secret
 * is being rotated) and returns the parsed event. Must be given the raw
 * body exactly as received - re-serialised JSON won't match.
 */
export function constructWebhookEvent(
  rawBody: string,
  header: string | null,
  secret: string
): { event: PaddleEvent } | { error: string } {
  if (!header) return { error: "Paddle-Signature header is missing." };
  if (header.length > 1000) return { error: "Paddle-Signature header is too long." };

  let timestamp: number | undefined;
  const candidates: string[] = [];
  for (const part of header.split(";")) {
    const [key, value] = part.trim().split("=", 2);
    if (key === "ts" && value && /^[0-9]{1,12}$/.test(value)) timestamp = Number(value);
    if (key === "h1" && value && /^[0-9a-f]{64}$/.test(value)) candidates.push(value);
  }
  if (timestamp === undefined || candidates.length === 0) {
    return { error: "Paddle-Signature header is not in the ts=...;h1=... form." };
  }
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
    return { error: "Webhook timestamp is outside the tolerance (clock skew or replay)." };
  }

  const expected = createHmac("sha256", secret).update(`${timestamp}:${rawBody}`, "utf8").digest();
  if (!candidates.some((c) => timingSafeEqual(expected, Buffer.from(c, "hex")))) {
    return { error: "No signature matches - PADDLE_WEBHOOK_SECRET is not this destination's secret key." };
  }

  try {
    const event = JSON.parse(rawBody);
    if (typeof event?.event_id !== "string" || typeof event.event_type !== "string" || !event.data) {
      return { error: "Body is not a Paddle event." };
    }
    return { event: event as PaddleEvent };
  } catch {
    return { error: "Body is not JSON." };
  }
}

let ipCache: { environment: PaddleEnvironment; cidrs: string[]; fetchedAt: number } | null = null;

/** Paddle's current webhook source IPs, from its /ips endpoint (the source
 * of truth - the list can change, so it's never hard-coded). Cached for an
 * hour; on a failed refetch the last good list is kept rather than
 * rejecting every delivery. Returns null if no list has ever been fetched. */
async function paddleWebhookCidrs(environment: PaddleEnvironment): Promise<string[] | null> {
  if (ipCache && ipCache.environment === environment && Date.now() - ipCache.fetchedAt < IP_LIST_TTL_MS) {
    return ipCache.cidrs;
  }
  try {
    const res = await fetch(`${apiBase(environment)}/ips`, { cache: "no-store" });
    const json = await res.json();
    const cidrs = json?.data?.ipv4_cidrs;
    if (!res.ok || !Array.isArray(cidrs) || cidrs.length === 0) throw new Error(`HTTP ${res.status}`);
    ipCache = { environment, cidrs, fetchedAt: Date.now() };
    return cidrs;
  } catch (e) {
    console.error("Could not fetch Paddle webhook IPs", e);
    return ipCache?.environment === environment ? ipCache.cidrs : null;
  }
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^[0-9]{1,3}$/.test(p) || Number(p) > 255) return null;
    n = n * 256 + Number(p);
  }
  return n;
}

function inCidr(ip: number, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const baseInt = ipv4ToInt(base);
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  if (baseInt === null || !(bits >= 0 && bits <= 32)) return false;
  const size = 2 ** (32 - bits);
  return Math.floor(ip / size) === Math.floor(baseInt / size);
}

/** Whether a webhook came from one of Paddle's published IPs. Defence in
 * depth on top of the signature check, which stays the real proof. */
export async function isPaddleWebhookIp(ip: string | null, environment: PaddleEnvironment): Promise<boolean> {
  const ipInt = ip ? ipv4ToInt(ip.replace(/^::ffff:/, "")) : null;
  if (ipInt === null) return false;
  const cidrs = await paddleWebhookCidrs(environment);
  return Boolean(cidrs?.some((c) => inCidr(ipInt, c)));
}
