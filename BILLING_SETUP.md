# Billing setup (Supabase + Lemon Squeezy)

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

## 2. Lemon Squeezy

1. Create a store if you don't have one.
2. Products -> New product, one each for **Starter** ($8.99/mo, 60
   credits/mo - subscription variant), **Pro** ($23.99/mo, 200
   credits/mo - subscription), **Pay-as-you-go** ($5.99, 30 credits -
   one-time variant), **Creator** ($2.99, 15 credits - one-time variant,
   sized for a single social-media upload session). Numbers are the
   directional ones from the pricing-strategy doc; change the price on the
   product itself, not in this codebase - the credit amount granted comes
   from `PLANS` in `src/lib/credits.ts`, not from Lemon Squeezy, so keep
   them in sync if you change either.
3. Each product's variant page has its numeric ID in the URL - put those in
   `LEMONSQUEEZY_VARIANT_STARTER` / `_PRO` / `_PAYG` / `_CREATOR`.
4. Settings -> General: your Store ID goes in `LEMONSQUEEZY_STORE_ID`.
5. Settings -> API: create an API key for `LEMONSQUEEZY_API_KEY`.
6. Settings -> Webhooks -> Add webhook: URL is
   `https://<your-domain>/api/webhooks/lemonsqueezy`, events to send:
   `order_created`, `subscription_payment_success`,
   `subscription_cancelled`, `subscription_expired`. Copy the signing
   secret into `LEMONSQUEEZY_WEBHOOK_SECRET`.

Webhooks need a public HTTPS URL, so this step only works once the app is
deployed (or tunneled with something like `ngrok` for local testing).

## How a purchase actually grants credits

`/pricing` -> `POST /api/checkout` (creates a Lemon Squeezy checkout via
their API, embedding `custom_data: { user_id, plan, credits }`) -> user
pays on Lemon Squeezy's hosted page -> LS calls
`POST /api/webhooks/lemonsqueezy` -> signature verified -> reads
`meta.custom_data` straight back out (no separate variant/plan lookup
needed) -> `grant_paid_credits` RPC, deduped by event id so a retried
webhook can't double-grant.

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
