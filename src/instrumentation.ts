import * as Sentry from "@sentry/nextjs";

// Server + edge runtime counterpart to instrumentation-client.ts - same
// inert-until-configured contract (enabled only when SENTRY_DSN is set).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      enabled: Boolean(process.env.SENTRY_DSN),
      tracesSampleRate: 0.1,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
