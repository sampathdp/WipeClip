import type { NextRequest } from "next/server";
import { getSecretKey } from "./paymentsLk";
import { paddleEnvironment } from "./paddle";

export type Gateway = "payments_lk" | "paddle";

/** The visitor's country, ISO 3166 alpha-2, from the edge's geo header
 * (Vercel, or Cloudflare when it proxies the site). CHECKOUT_COUNTRY
 * overrides it, for testing either checkout locally where neither header
 * is set. */
export function visitorCountry(request: NextRequest): string | null {
  const country =
    process.env.CHECKOUT_COUNTRY?.trim() ||
    request.headers.get("x-vercel-ip-country") ||
    request.headers.get("cf-ipcountry");
  return country ? country.toUpperCase() : null;
}

/** Which checkout a visitor gets, decided server side only. Sri Lanka pays
 * in LKR through Payments.lk; everyone else goes through Paddle, which is
 * merchant of record and handles their sales tax. Until Paddle is
 * configured, everyone stays on Payments.lk as before. */
export function gatewayFor(request: NextRequest): Gateway | null {
  const paddleReady = paddleEnvironment() !== null;
  const paymentsLkReady = Boolean(getSecretKey());
  if (visitorCountry(request) === "LK" || !paddleReady) return paymentsLkReady ? "payments_lk" : null;
  return "paddle";
}
