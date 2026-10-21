import { createHmac, timingSafeEqual } from "crypto";

// Signed unsubscribe links for marketing email. The token is an HMAC of the
// account id, so a link only ever unsubscribes the account it was sent to
// and works without signing in. It never expires: an unsubscribe link has to
// keep working long after the email was sent. Kept free of "@/" imports so
// scripts/send-newsletter.ts can load it with plain Node.

function secret(): string {
  const value = process.env.EMAIL_UNSUBSCRIBE_SECRET?.trim();
  if (!value || value.length < 32) {
    throw new Error("EMAIL_UNSUBSCRIBE_SECRET must be set (at least 32 characters).");
  }
  return value;
}

export function unsubscribeToken(userId: string): string {
  return createHmac("sha256", secret()).update(`unsubscribe:${userId}`).digest("base64url");
}

export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  return timingSafeEqual(Buffer.from(unsubscribeToken(userId)), Buffer.from(token));
}

/** The visible link: a page that confirms and lets the reader undo it. */
export function unsubscribePageUrl(siteUrl: string, userId: string): string {
  return `${siteUrl}/unsubscribe?u=${userId}&t=${unsubscribeToken(userId)}`;
}

/** The List-Unsubscribe header target: mail clients POST to it directly
 * (RFC 8058 one-click), which Gmail and Yahoo require of bulk senders. */
export function unsubscribeApiUrl(siteUrl: string, userId: string): string {
  return `${siteUrl}/api/unsubscribe?u=${userId}&t=${unsubscribeToken(userId)}`;
}
