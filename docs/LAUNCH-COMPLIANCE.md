# Launch security and compliance checklist

Steps outside the code that the launch depends on. The code side is done:
upload tickets on the backend, refund/chargeback revocation, admin two-step
sign-in, security headers, and the policy pages.

## Before deploying

- [ ] Re-run `supabase/schema.sql` in the Supabase SQL editor (adds
      `revoke_paid_credits` and row-level security on `processed_webhook_events`).
- [ ] Supabase -> Authentication -> Multi-Factor: TOTP enabled (it is by default).
- [ ] Vercel: `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` set. Without
      them rate limits and single-use job tickets only hold per server instance.
- [ ] Vercel and GitHub: the same `INTERNAL_API_SECRET` in both.
- [ ] Deploy the website and the backend together: the new backend refuses the
      old site's upload calls (no upload ticket).
- [ ] Paddle -> Notifications: the webhook destination also has
      `adjustment.created` and `adjustment.updated`.
- [ ] Google Cloud: the upload bucket has the 1-day delete lifecycle rule
      (`gcloud storage buckets describe gs://wipeclip-uploads --format="default(lifecycle_config)"`).
- [ ] First admin sign-in after deploy: scan the QR code with an authenticator app.

## Legal

- [ ] Register a DMCA designated agent with the US Copyright Office
      (dmca.copyright.gov, about $6, renew every 3 years), then add the agent's
      name, postal address and phone to `/dmca`. Safe harbour depends on the
      registration, not only the page.
- [ ] Keep a takedown log (date, complainant, content, action, account) and act
      on repeat infringers, as `/dmca` section 4 promises.
- [ ] Child sexual abuse material: the explicit-content screen in
      `backend/app/pipeline/moderation.py` is not CSAM detection. Apply for a
      hash-matching service (for example PhotoDNA or Safer) and wire it in as a
      `MODERATION_PROVIDER`. Until then, have a written process: preserve, do
      not share, report to NCMEC (CyberTipline) and Sri Lanka Police / CERT|CC,
      suspend the account.
- [ ] Sign the data processing agreements (usually click-through in each
      dashboard): Supabase, Vercel, Google Cloud, Upstash, the email provider,
      Sentry (if enabled), AWS (if `MODERATION_PROVIDER=aws`).
- [ ] Sri Lanka Personal Data Protection Act No. 9 of 2022: check whether
      registration with the Data Protection Authority or a named data
      protection officer is required for this business.
- [ ] GDPR: if marketing to EU users, consider an EU Article 27 representative.
- [ ] Have a lawyer review the Terms (liability cap, governing law, the
      registered business name "Codeplay Studios").
- [ ] Desktop app: confirm every bundled AI model's licence allows commercial use.

## Desktop releases

- [ ] macOS: add the Apple signing secrets to GitHub (the workflow already
      signs and notarizes when they exist).
- [ ] Windows: buy a code-signing certificate (since 2023 these are on a
      hardware token or a cloud signing service) and wire it into
      `.github/workflows/desktop.yml`. Unsigned installers get the SmartScreen
      "unknown publisher" warning.

## If an admin authenticator is lost

Set `ADMIN_MFA_DISABLED=true` in Vercel, sign in, remove the old factor in
Supabase (Authentication -> Users -> the account -> MFA factors), remove the
variable again, and sign in to enroll a new authenticator.
