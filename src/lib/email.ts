/** Minimal transactional email via Resend's REST API (https://resend.com/docs/api-reference/emails/send-email),
 * called with fetch so there's no SDK dependency. Same "no-op until
 * configured" pattern as the rest of this project's optional integrations:
 * without RESEND_API_KEY it logs and returns false instead of throwing, so
 * a missing key never breaks the request that triggered the email.
 */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendEmail({
  to,
  subject,
  text,
  html,
  replyTo,
}: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.warn(`[email] RESEND_API_KEY not set - skipped "${subject}"`);
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // onboarding@resend.dev works without verifying a domain, but only
        // delivers to the Resend account owner's own address - fine for
        // admin notifications. Set EMAIL_FROM once a domain is verified.
        from: process.env.EMAIL_FROM || "WipeClip <onboarding@resend.dev>",
        to: [to],
        subject,
        text,
        html,
        reply_to: replyTo,
      }),
    });
    if (!res.ok) {
      console.error(`[email] Resend responded ${res.status}: ${await res.text().catch(() => "")}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email] send failed", err);
    return false;
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
