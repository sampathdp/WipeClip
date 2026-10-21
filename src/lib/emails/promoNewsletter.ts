// The "% off Starter and Pro" newsletter, sent by scripts/send-newsletter.ts.
// Plain inline-styled tables and a single small brand image
// (public/email-icon.png, a PNG because many mail clients drop SVG and
// WebP) next to the name in text, so the header still reads right when
// images are blocked. Text-heavy with a matching plain-text part is what
// spam filters trust most. Kept free of "@/" imports so the script
// can load it with plain Node.

export type PromoNewsletterInput = {
  siteUrl: string;
  /** Visible unsubscribe link (the /unsubscribe page). */
  unsubscribeUrl: string;
  /** /pricing?promo=CODE - carries the code to checkout. */
  offerUrl: string;
  percent: number;
  /** e.g. "November 4, 2026" */
  endsOn: string;
  name: string | null;
  starter: { price: string; credits: number };
  pro: { price: string; credits: number };
  /** Whether the yearly passes are discounted too (the promotion's plans). */
  yearly: boolean;
  /** The code, also typeable on the pricing page. */
  code: string;
  /** Whether only accounts created before the promotion can use it. */
  existingOnly: boolean;
};

const COMPANY = "Codeplay Studios";
const ADDRESS = "115/A Gagabada Road, Hirana, Panadura, Sri Lanka";
const SUPPORT = "support@wipeclip.co";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function promoNewsletterSubject(i: Pick<PromoNewsletterInput, "percent" | "endsOn">): string {
  return `${i.percent}% off Starter and Pro, until ${i.endsOn}`;
}

export function renderPromoNewsletter(i: PromoNewsletterInput): { subject: string; html: string; text: string } {
  const subject = promoNewsletterSubject(i);
  const greeting = i.name ? `Hi ${i.name.split(" ")[0]},` : "Hi there,";
  const preheader = `A thank-you for being with us: ${i.percent}% off a Starter or Pro pass until ${i.endsOn}. No subscription, no auto-renewal.`;

  const terms = [
    `${i.percent}% off the list price of one Starter or Pro pass (${i.yearly ? "30 days or 1 year" : "30 days"}), once per account.`,
    `${i.existingOnly ? "For accounts created before this email was sent. " : ""}Buy by ${i.endsOn} (end of day, UTC) while signed in to your account, using the button in this email or by entering code ${i.code} on the pricing page.`,
    "Passes are one-time payments with no automatic renewal. Taxes may apply depending on where you live and are shown at checkout.",
    "Cannot be combined with other offers, exchanged for cash or applied to past purchases.",
    "Our Terms of Service and Refund Policy apply. We may end this offer early only if it is misused.",
  ];

  const text = [
    greeting,
    "",
    `Thank you for using WipeClip. As a thank-you to everyone who already has an account, Starter and Pro passes are ${i.percent}% off until ${i.endsOn}.`,
    "",
    `Starter (was ${i.starter.price} for 30 days): Full HD exports, all premium transitions, filters and effects, ${i.starter.credits} AI credits.`,
    `Pro (was ${i.pro.price} for 30 days): everything in Starter, 4K Ultra HD exports and ${i.pro.credits} AI credits.`,
    "",
    `Claim your discount: ${i.offerUrl}`,
    "",
    `Your code: ${i.code} - the button applies it for you, or enter it on the pricing page.`,
    "",
    "Offer terms:",
    ...terms.map((t) => `- ${t}`),
    "",
    `Questions? Reply to this email or write to ${SUPPORT}.`,
    "",
    "The WipeClip team",
    "",
    "---",
    "You're receiving this because you have a WipeClip account. We send offers and product news only occasionally.",
    `Unsubscribe: ${i.unsubscribeUrl}`,
    `Privacy Policy: ${i.siteUrl}/privacy`,
    `WipeClip.co is a product of ${COMPANY}, ${ADDRESS}.`,
  ].join("\n");

  const plan = (name: string, price: string, lines: string[]) => `
              <td valign="top" width="50%" style="padding:6px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e4e7;border-radius:12px;">
                  <tr><td style="padding:18px;">
                    <p style="margin:0;font-size:16px;font-weight:700;color:#18181b;">${esc(name)}</p>
                    <p style="margin:6px 0 0;font-size:13px;color:#71717a;"><s>${esc(price)}</s> &nbsp;<strong style="color:#059669;">${i.percent}% off</strong></p>
                    <ul style="margin:12px 0 0;padding-left:18px;font-size:13px;line-height:20px;color:#3f3f46;">
                      ${lines.map((l) => `<li>${esc(l)}</li>`).join("")}
                    </ul>
                  </td></tr>
                </table>
              </td>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;">
        <tr><td style="padding:32px 32px 8px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="padding-right:12px;"><a href="${esc(i.siteUrl)}"><img src="${esc(i.siteUrl)}/email-icon.png" width="48" height="48" alt="WipeClip" style="display:block;border:0;border-radius:12px;"></a></td>
            <td style="font-size:20px;font-weight:800;color:#18181b;">WipeClip</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:16px 32px 0;font-size:15px;line-height:24px;color:#3f3f46;">
          <p style="margin:0 0 14px;">${esc(greeting)}</p>
          <p style="margin:0 0 14px;">Thank you for using WipeClip. As a thank-you to everyone who already has an account,
          <strong>Starter and Pro passes are ${i.percent}% off until ${esc(i.endsOn)}</strong>.</p>
          <p style="margin:0;">No subscription and no automatic renewal: you pay once and the pass is yours for its full period.</p>
        </td></tr>
        <tr><td style="padding:20px 26px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            ${plan("Starter", `${i.starter.price} / 30 days`, ["Full HD exports", "All premium transitions, filters and effects", `${i.starter.credits} AI credits`])}
            ${plan("Pro", `${i.pro.price} / 30 days`, ["Everything in Starter", "4K Ultra HD exports", `${i.pro.credits} AI credits`])}
          </tr></table>
        </td></tr>
        <tr><td align="center" style="padding:24px 32px 8px;">
          <a href="${esc(i.offerUrl)}" style="display:inline-block;background:#0891b2;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 28px;border-radius:999px;">Claim ${i.percent}% off</a>
          <p style="margin:12px 0 0;font-size:12px;color:#71717a;">Your code: <strong style="color:#18181b;letter-spacing:1px;">${esc(i.code)}</strong>. The button applies it for you, or enter it on the pricing page.${i.yearly ? " Yearly passes are included too." : ""}</p>
        </td></tr>
        <tr><td style="padding:20px 32px 0;">
          <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#3f3f46;">Offer terms</p>
          <ul style="margin:0;padding-left:18px;font-size:12px;line-height:18px;color:#71717a;">
            ${terms.map((t) => `<li>${esc(t)}</li>`).join("")}
          </ul>
        </td></tr>
        <tr><td style="padding:20px 32px 32px;font-size:14px;line-height:22px;color:#3f3f46;">
          <p style="margin:0;">Questions? Just reply to this email or write to <a href="mailto:${SUPPORT}" style="color:#0891b2;">${SUPPORT}</a>.</p>
          <p style="margin:14px 0 0;">The WipeClip team</p>
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
        <tr><td style="padding:20px 32px;font-size:12px;line-height:18px;color:#71717a;text-align:center;">
          <p style="margin:0;">You're receiving this because you have a WipeClip account. We send offers and product news only occasionally.</p>
          <p style="margin:8px 0 0;"><a href="${esc(i.unsubscribeUrl)}" style="color:#52525b;">Unsubscribe</a> &middot;
            <a href="${esc(i.siteUrl)}/privacy" style="color:#52525b;">Privacy Policy</a> &middot;
            <a href="${esc(i.siteUrl)}/terms" style="color:#52525b;">Terms</a> &middot;
            <a href="${esc(i.siteUrl)}/refund-policy" style="color:#52525b;">Refund Policy</a></p>
          <p style="margin:8px 0 0;">WipeClip.co is a product of ${COMPANY}, ${ADDRESS}.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}
