import * as Sentry from "@sentry/nextjs";

// Scaffolded but inert: with NEXT_PUBLIC_SENTRY_DSN unset, `enabled: false`
// makes this a genuine no-op (no network calls, no behavior change) - same
// "no-op until configured" pattern as this project's other optional
// integrations (INTERNAL_API_SECRET, MODERATION_PROVIDER, REDIS_URL).
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  tracesSampleRate: 0.1,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
