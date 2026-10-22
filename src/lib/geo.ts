import type { createServiceClient } from "@/lib/supabase/server";

/** The visitor's country, ISO 3166 alpha-2, from the edge's geo header
 * (Vercel, or Cloudflare when it proxies the site), for recording where an
 * account or order came from. Unlike visitorCountry in checkoutGateway.ts,
 * CHECKOUT_COUNTRY doesn't override it: a local test setting must not end
 * up in the stats. Cloudflare's XX (unknown) and T1 (Tor) count as none. */
export function edgeCountry(headers: Headers): string | null {
  const country = (headers.get("x-vercel-ip-country") || headers.get("cf-ipcountry") || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) && country !== "XX" && country !== "T1" ? country : null;
}

/** Stores the account's latest country (profiles.country) when it is known
 * and differs from `current`, the value already read - so the usual case,
 * same country as last time, costs no write. Never throws: a failed write
 * only means the stats miss one update. */
export async function rememberCountry(
  admin: ReturnType<typeof createServiceClient>,
  userId: string,
  country: string | null,
  current: string | null | undefined
): Promise<void> {
  if (!country || country === current) return;
  const { error } = await admin
    .from("profiles")
    .update({ country, country_updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) console.error("Could not record the account's country", error.message);
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

/** "Sri Lanka" for "LK"; "Unknown" for none. */
export function countryName(code: string | null | undefined): string {
  if (!code) return "Unknown";
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** The flag emoji for a two-letter code, or a globe for none. */
export function countryFlag(code: string | null | undefined): string {
  if (!code || !/^[A-Z]{2}$/.test(code)) return "🌐";
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
