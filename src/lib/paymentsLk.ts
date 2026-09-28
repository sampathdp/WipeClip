import { createHmac, timingSafeEqual } from "crypto";

// Minimal Payments.lk REST client (https://payments.lk/developers/guide).
// Plain fetch rather than the @payments-lk/node SDK, which is only published
// as a tarball on payments.lk, not on npm. The same secret key format picks
// the environment: sk_test_ is the sandbox, sk_live_ is live - nothing else
// changes between the two.

const API_BASE = process.env.PAYMENTS_LK_API_BASE ?? "https://api.payments.lk";

/** Rejects a webhook whose timestamp is further than this from now (replay guard). */
const WEBHOOK_TOLERANCE_SECONDS = 300;

export type PaymentStatus =
  | "requires_payment_method"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled"
  | "partially_refunded"
  | "refunded"
  | "disputed";

export interface Payment {
  object: "payment";
  id: string;
  mode: "test" | "live";
  status: PaymentStatus;
  amountCents: number;
  currency: "LKR";
  reference: string | null;
  checkoutId: string | null;
}

export interface Checkout {
  object: "checkout";
  id: string;
  mode: "test" | "live";
  status: "open" | "processing" | "completed" | "expired" | "canceled";
  url: string;
  expiresAt: string;
  payment: Payment;
}

export interface PaymentsLkEvent {
  id: string;
  object: "event";
  type: string;
  mode: "test" | "live";
  created: string;
  data: Payment & Record<string, unknown>;
}

export interface CreateCheckoutParams {
  /** Whole cents of LKR, Rs. 10 (1000) to Rs. 1,000,000 (100000000). */
  amountCents: number;
  description: string;
  reference?: string;
  customer?: { name?: string; email?: string; phone?: string };
  successUrl?: string;
  cancelUrl?: string;
}

export class PaymentsLkError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly reason?: string,
    readonly traceId?: string
  ) {
    super(message);
  }
}

export function getSecretKey(): string | undefined {
  return process.env.PAYMENTS_LK_SECRET_KEY || undefined;
}

async function request<T>(path: string, init: { method: string; body?: unknown; idempotencyKey?: string }): Promise<T> {
  const secretKey = getSecretKey();
  if (!secretKey) throw new PaymentsLkError("PAYMENTS_LK_SECRET_KEY is not set.", 501);

  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new PaymentsLkError(
      json?.message ?? `Payments.lk request failed with ${res.status}.`,
      res.status,
      json?.code,
      json?.reason,
      json?.traceId
    );
  }
  return json as T;
}

export function createCheckout(params: CreateCheckoutParams, idempotencyKey: string): Promise<Checkout> {
  return request<Checkout>("/v1/checkouts", { method: "POST", body: params, idempotencyKey });
}

export function retrieveCheckout(id: string): Promise<Checkout> {
  return request<Checkout>(`/v1/checkouts/${encodeURIComponent(id)}`, { method: "GET" });
}

/**
 * Verifies the Payments-Signature header (`t=<unix seconds>,v1=<hex
 * HMAC-SHA256 of "<t>.<raw body>">`) and returns the parsed event, or null
 * if it isn't a genuine, fresh Payments.lk event. Must be given the raw
 * body exactly as received - re-serialised JSON won't match.
 */
export function constructWebhookEvent(rawBody: string, header: string | null, secret: string): PaymentsLkEvent | null {
  if (!header || header.length > 1000) return null;

  let timestamp: number | undefined;
  const candidates: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.trim().split("=", 2);
    if (key === "t" && value && /^[0-9]{1,12}$/.test(value)) timestamp = Number(value);
    if (key === "v1" && value && /^[0-9a-f]{64}$/.test(value)) candidates.push(value);
  }
  if (timestamp === undefined || candidates.length === 0) return null;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return null;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest();
  if (!candidates.some((c) => timingSafeEqual(expected, Buffer.from(c, "hex")))) return null;

  try {
    const event = JSON.parse(rawBody);
    if (event?.object !== "event" || typeof event.id !== "string" || typeof event.type !== "string") return null;
    return event as PaymentsLkEvent;
  } catch {
    return null;
  }
}
