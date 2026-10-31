/** Launch mode: growing reach before earning.
 *
 * Every account gets a TRIAL_DAYS Pro trial counted from signup (accounts
 * from before the trial existed count from TRIAL_START, so they get one
 * too). The trial is read on the fly from profiles.created_at - see
 * accessPlan in src/lib/plan.ts - so it needs no column or scheduled job.
 *
 * While PAYMENTS_ENABLED is off, checkout is closed, the pricing page
 * shows the plans as "coming soon", and the free plan keeps nearly every
 * premium tool: only CREDIT_TOOLS (src/lib/entitlements.ts) stay held
 * back, and an export that uses them costs EXPORT_CREDIT_COST credits
 * instead of needing a paid plan. Set NEXT_PUBLIC_PAYMENTS_ENABLED=true to
 * open payments and bring back the paid-plan rules.
 */
export const PAYMENTS_ENABLED = process.env.NEXT_PUBLIC_PAYMENTS_ENABLED === "true";

export const TRIAL_DAYS = 30;

/** When the trial started; older accounts count their 30 days from here. */
export const TRIAL_START = "2026-11-01T00:00:00Z";

/** Credits an export spends when it uses a credit tool on the free plan. */
export const EXPORT_CREDIT_COST = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When the account's Pro trial ends (or ended). */
export function trialEndsAt(createdAt: string | null | undefined): Date {
  const created = createdAt ? new Date(createdAt).getTime() : 0;
  return new Date(Math.max(created, new Date(TRIAL_START).getTime()) + TRIAL_DAYS * DAY_MS);
}

export function inTrial(createdAt: string | null | undefined): boolean {
  return trialEndsAt(createdAt).getTime() > Date.now();
}
