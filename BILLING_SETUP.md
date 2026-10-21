# Billing setup (Supabase + Payments.lk + Paddle)

Everything is wired in code with placeholder env vars. Nothing works until
these are filled in with real values.

## 1. Supabase

1. Create a project at supabase.com.
2. Project Settings -> API: copy the Project URL and `anon` `public` key
   into `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   Copy the `service_role` `secret` key into `SUPABASE_SERVICE_ROLE_KEY`
   (server-only - never expose this to the browser or commit it).
3. Authentication -> Providers: Email should be on by default. Under
   Authentication -> URL Configuration, add your site URL and
   `<site>/auth/callback` as a redirect URL (add `http://localhost:3000/**`
   too for local dev).
4. SQL Editor -> New query: paste and run `supabase/schema.sql` in full.
   This creates `profiles`, `credit_transactions`,
   `processed_webhook_events`, the credit RPC functions, and RLS policies.

That's it for Supabase - signing in with a new email (any provider) auto-
creates a `profiles` row with 2 free credits via the `on_auth_user_created`
trigger.

### Google sign-in

The sign-in page's "Continue with Google" button needs a Google OAuth
client, then a couple minutes wiring it into Supabase:

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   -> Create Credentials -> OAuth client ID -> Web application.
2. Authorized redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`
   (Supabase's own callback, not this app's - find the exact URL on the
   Supabase provider settings page below, it's shown there).
3. Copy the generated Client ID and Client Secret.
4. Supabase dashboard -> Authentication -> Providers -> Google: paste them
   in and enable the provider.

No separate env vars needed in this app - Supabase holds the Google
credentials and this app just calls `signInWithOAuth({ provider: "google" })`.

## 2. Payments.lk (sandbox first)

Guide: https://payments.lk/developers/guide. Payments.lk is Payable's
startup brand; it charges in Sri Lankan rupees only and uses a hosted
checkout, so card details never touch this app.

1. Apply at https://payments.lk/apply - the dashboard opens straight away
   and sandbox keys work before approval.
2. Dashboard -> Developers -> **Create sandbox secret key**. It starts
   `sk_test_`. Put it in `PAYMENTS_LK_SECRET_KEY` (server-only).
3. Dashboard -> Developers -> add a webhook endpoint:
   `https://<your-domain>/api/webhooks/payments-lk`. Copy its signing
   secret (`whsec_...`) into `PAYMENTS_LK_WEBHOOK_SECRET`. The handler acts
   on `payment.succeeded`, `payment.failed` and `checkout.expired`.
   Before you have a public URL, point sandbox events at the test inbox on
   the Developers page, or tunnel localhost with `ngrok`.
4. Re-run `supabase/schema.sql` - it adds the `payment_orders` table,
   `profiles.plan_expires_at`, and the new `grant_paid_credits` signature.
   Everything in it is safe to re-run.
5. Test: sign in, open `/pricing`, buy any plan. On the sandbox checkout
   use a test card from the Developers page - expiry **01/39 approves**,
   **05/39 declines**. No money moves. The webhook should credit the
   account and set `payment_orders.status = 'paid'`.
6. Go live once approved: create a live key (`sk_live_`) and a live webhook
   endpoint with its own secret, and swap both env vars. Nothing else
   changes.

Prices: the amount charged is `amountCents` (whole cents of LKR) in
`PLANS` in `src/lib/credits.ts`; `priceLabel` is display only. The
credits granted come from the same `PLANS` entry, recorded on the order
row when checkout starts.

Starter and Pro are **30-day passes**, not subscriptions: Payments.lk has
no subscription object (automatic renewals would need saved cards, which
require Payable's Advanced plan). Each purchase grants the credits and
sets `plan` + `plan_expires_at`; `src/lib/plan.ts` reads an expired pass
as `free`. Buying the same tier again early extends it by 30 days.

## 3. Paddle (international, sandbox first)

Sri Lankan visitors (by the edge's geo header, `x-vercel-ip-country` or
`cf-ipcountry`) keep paying through Payments.lk. Everyone else pays through
Paddle, which is Merchant of Record and handles their VAT/sales tax. The
choice is made server side in `src/lib/checkoutGateway.ts`; until Paddle's
keys are set, everyone gets Payments.lk. Set `CHECKOUT_COUNTRY=US` (or
`LK`) locally to test either path.

1. In a Paddle **sandbox** account, create one product per plan and a
   **one-time** USD price (no billing cycle) for each `PLANS` entry in
   `src/lib/credits.ts`, at its `usdCents`. Put each price ID (`pri_...`)
   in `PADDLE_PRICE_<PLAN>` (e.g. `PADDLE_PRICE_STARTER_YEARLY`).
2. Developer tools -> Authentication: create an API key
   (`pdl_sdbx_apikey_...`, needs transaction write) into `PADDLE_API_KEY`,
   and a client-side token (`test_...`) into `PADDLE_CLIENT_TOKEN`. Set
   `PADDLE_ENVIRONMENT=sandbox`; it is required once any Paddle key is set
   and must match both key prefixes, or the app errors instead of guessing.
3. Developer tools -> Notifications: add a destination for
   `https://<your-domain>/api/webhooks/paddle` with the
   `transaction.completed` event. Copy its secret key into
   `PADDLE_WEBHOOK_SECRET`.
4. The webhook only accepts deliveries from Paddle's published IPs,
   fetched from `https://sandbox-api.paddle.com/ips` or
   `https://api.paddle.com/ips` (cached for an hour, never hard-coded).
   Behind Cloudflare, set `PADDLE_WEBHOOK_IP_HEADER=cf-connecting-ip`.
5. Re-run `supabase/schema.sql` - it adds `payment_orders.provider`,
   `payment_orders.currency` and `profiles.paddle_customer_id`.
6. Checkout -> Checkout settings: set the default payment link to your
   pricing page (sandbox accepts localhost).
7. Test: with `CHECKOUT_COUNTRY=US`, sign in, open `/pricing`, buy a plan.
   The cards show Paddle's localized prices (`Paddle.PricePreview`), and
   Paddle's one-page overlay opens; pay with card `4242 4242 4242 4242`,
   any future expiry, CVC `100`. It redirects to `/welcome`. The webhook
   should credit the account, set the order to `paid` (recording the
   currency and total actually charged) and record
   `profiles.paddle_customer_id`.

Going live: once sandbox passes, create the same products and prices in
the live account and swap every `PADDLE_*` value for its live counterpart
(`PADDLE_ENVIRONMENT=production`, `pdl_live_apikey_...`, `live_...`, the
live destination's secret, live `pri_...` IDs) - no code changes. Country
price overrides added to a price in Paddle appear on `/pricing`
automatically. Live checkout also needs an approved
domain and a default payment link on that domain.

Paddle prices are one-time, matching the Payments.lk passes, so
`usdCents`, `priceLabel` and the Paddle catalog price must agree. Refunds
are issued in the Paddle dashboard; like Payments.lk refunds, they don't
yet remove the plan or credits automatically.

## How a purchase actually grants credits

`/pricing` -> `POST /api/checkout` (inserts a `payment_orders` row with
user, plan, credits and LKR amount, then creates a Payments.lk checkout
with `reference` = that row's id and `Idempotency-Key: order-<id>`) ->
user pays on the hosted checkout -> Payments.lk calls
`POST /api/webhooks/payments-lk` -> `Payments-Signature` verified
(HMAC-SHA256 of `<t>.<raw body>`, 5-minute tolerance) -> order looked up
by `reference` -> `grant_paid_credits` RPC, deduped by payment id so a
retried webhook can't double-grant. The browser's return to `successUrl`
never grants anything.

## Closing the direct-call bypass

`/api/process` (Next.js) is the only path that checks and spends credits
before handing the job to the FastAPI backend's `/api/video/process`. Left
alone, the backend endpoint would still be reachable directly by anyone who
has its URL, skipping credits entirely - the backend has open CORS and no
auth of its own.

Set `INTERNAL_API_SECRET` to the same random value in both `.env.local`
(frontend) and `backend/.env` (generate one with `openssl rand -hex 32`)
before relying on this for real revenue. With it set, the backend rejects
any `/api/video/process` call that doesn't carry the matching
`X-Internal-Process-Secret` header - which only `/api/process` sends. Left
unset (the default), both sides skip the check, which is fine for local
dev but means the bypass is open until you set it.
