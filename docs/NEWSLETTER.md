# Promotion newsletter

Sends the "% off Starter and Pro" email (`src/lib/emails/promoNewsletter.ts`) to existing
accounts with `scripts/send-newsletter.ts`, and applies the discount at checkout
(`src/lib/promo.ts`, `src/app/api/checkout/route.ts`).

## Pieces

| Piece | Where |
| --- | --- |
| Opt-out flag | `profiles.marketing_opt_out` / `marketing_opt_out_at` (`supabase/schema.sql`) |
| Signed unsubscribe links | `src/lib/unsubscribe.ts` (HMAC of the account id, never expires) |
| Unsubscribe page (with undo) | `/unsubscribe` (`src/app/unsubscribe/page.tsx`) |
| One-click unsubscribe (RFC 8058) | `POST /api/unsubscribe` (`List-Unsubscribe` header target) |
| Promotion settings | `/admin/promotion`, `promo_settings` table, `src/lib/promo.ts`, `POST /api/checkout` |
| Pricing banner and `?promo=` capture | `src/app/pricing/PricingClient.tsx` |
| Email (HTML + plain text) | `src/lib/emails/promoNewsletter.ts` |
| Sender | Admin panel `/admin/newsletter`, or `scripts/send-newsletter.ts` (`npm run newsletter`); shared code in `src/lib/newsletter.ts` |
| Send log | `newsletter_sends` table (one row per campaign and account) |

## One-time setup

1. **Database.** Run `supabase/schema.sql` again in the Supabase SQL editor. It is additive and
   adds the opt-out columns, `payment_orders.promo_code` and the `newsletter_sends` and
   `promo_settings` tables.
2. **Sending domain.** In Resend, add and verify a sending subdomain such as `mail.wipeclip.co`,
   so a bad campaign can never hurt the reputation of the main domain. Add every DNS record
   Resend shows:
   - SPF (`TXT` / `MX` on the bounce subdomain Resend names),
   - DKIM (`TXT` `resend._domainkey...`),
   - DMARC on the root domain, starting with monitoring only:
     `_dmarc.wipeclip.co  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@wipeclip.co; adkim=r; aspf=r"`.
     Move to `p=quarantine` after a few weeks of clean reports.
3. **Env** (Vercel and `.env.local`, see `.env.local.example`):
   - `EMAIL_FROM="WipeClip <hello@mail.wipeclip.co>"`: a real name on the verified domain, never a
     no-reply or `resend.dev` address.
   - `EMAIL_REPLY_TO=support@wipeclip.co`: replies must reach a person.
   - `EMAIL_UNSUBSCRIBE_SECRET`: 32+ random characters (`openssl rand -base64 48`). Never change it
     after a send, or links in emails already sent stop working.
4. **Promotion.** Open **/admin/promotion**: set the code, percent, plans, end date and the
   optional "accounts created before" cut-off (leave empty so any account can use it), tick
   *Promotion is on* and save. Each account can use the code once: customers enter it on the
   pricing page (or open the email link), and Paddle's own discount box is hidden.
   Saving creates or updates the matching Paddle discount automatically (same percent, plans and
   expiry, not typeable at checkout) and turning it off archives it. Changes apply to the next
   checkout with no redeploy. Try it in the Paddle sandbox first.

## Sending

Easiest: sign in with an account listed in `ADMIN_EMAILS` and open **/admin/newsletter** (admin
sign-in also asks for an authenticator-app code; the first sign-in sets one up with a QR code. If
the authenticator is lost, set `ADMIN_MFA_DISABLED=true`, sign in, then remove it again). It shows
the setup status and counts, sends a test to your own address, and sends to the next N accounts
(up to 500 per click; type SEND to confirm). The same from the command line:

```bash
npm run newsletter -- --campaign=promo-2026-10                       # dry run, writes newsletter-logs/promo-2026-10-preview.html
npm run newsletter -- --campaign=promo-2026-10 --test=you@example.com   # one copy to your own account
npm run newsletter -- --campaign=promo-2026-10 --send --limit=200       # first slice
npm run newsletter -- --campaign=promo-2026-10 --send                   # the rest
```

Before the real send:

- Send a test to a Gmail, an Outlook and a Yahoo address. In Gmail, *Show original* must say
  `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`, and Gmail must show its own *Unsubscribe* link next to
  the sender (that is the `List-Unsubscribe` header working).
- Click *Claim 50% off* while signed in (and, if you set a cut-off, on an account created before it), and
  check the checkout shows the discounted price. Then click *Unsubscribe* and check the account
  shows as unsubscribed and is skipped by the next dry run.
- Optionally paste the preview into mail-tester.com and aim for 9/10 or higher.

## Staying out of spam

- **Warm up.** A new sending domain should not send to everyone on day one. Send about 200 the
  first day, then roughly double each day. Sends of the same campaign, from the panel or the
  script, skip everyone already sent.
- **Only confirmed accounts** are sent to, and unsubscribed accounts never are.
- **Watch the complaint rate** in Google Postmaster Tools (add the domain) and in Resend. Gmail
  starts filtering above 0.3%; keep it under 0.1%. Stop sending if it climbs.
- **Bounces and complaints.** Resend suppresses hard-bounced and complained addresses for you.
  Don't re-import old lists or addresses that never signed up.
- **Content.** Keep the honest subject line, the plain-text part, the real reply-to address and
  the absence of image-only content and URL shorteners. Avoid ALL CAPS and "FREE!!!" subjects.

## Legal checklist (covered by the template and code)

- Sender identified (`WipeClip`, a product of Codeplay Studios) with a postal address (CAN-SPAM).
- Honest, non-misleading subject that matches the content.
- Says why the reader gets it (they have an account).
- Clear unsubscribe link in every email, one click, no sign-in, no fee; plus the one-click
  `List-Unsubscribe` header. Opt-outs take effect immediately (CAN-SPAM requires within 10
  business days) and the link never expires.
- Unsubscribing stops marketing only; account emails continue.
- Offer terms stated: who is eligible, end date, once per account, no auto-renewal, taxes, no
  stacking, Terms and Refund Policy apply.
- Privacy Policy (section 2) explains marketing email, its legal basis (legitimate interest in
  marketing similar products to existing customers, or consent where required) and how to opt out.
- EU/UK/Canada note: sending offers to existing customers without prior opt-in relies on the
  "soft opt-in" (existing customer, similar products, easy opt-out). If you have accounts in
  these regions that signed up without ever being told about marketing email, the safest choice
  is to exclude them or send them a consent request instead. Ask a lawyer if unsure.
