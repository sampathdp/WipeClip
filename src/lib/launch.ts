/** The free Pro trial: every account gets TRIAL_DAYS of Pro counted from
 * signup (accounts from before the trial existed count from TRIAL_START, so
 * they get one too). Read on the fly from profiles.created_at - see
 * accessPlan in src/lib/plan.ts - so it needs no column or scheduled job.
 * Paid plans can be bought at any time, during the trial or after it.
 */
export const TRIAL_DAYS = 30;

/** When the trial started; older accounts count their 30 days from here. */
export const TRIAL_START = "2026-11-01T00:00:00Z";

const DAY_MS = 24 * 60 * 60 * 1000;

/** When the account's Pro trial ends (or ended). */
export function trialEndsAt(createdAt: string | null | undefined): Date {
  const created = createdAt ? new Date(createdAt).getTime() : 0;
  return new Date(Math.max(created, new Date(TRIAL_START).getTime()) + TRIAL_DAYS * DAY_MS);
}

export function inTrial(createdAt: string | null | undefined): boolean {
  return trialEndsAt(createdAt).getTime() > Date.now();
}
