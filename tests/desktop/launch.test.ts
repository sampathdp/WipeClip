// Run with: npm run desktop:test:js
import assert from "node:assert/strict";
import { test } from "node:test";
import { TRIAL_DAYS, TRIAL_START, trialEndsAt } from "../../src/lib/launch.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

test("the trial runs 30 days from signup", () => {
  const created = "2027-01-10T12:00:00Z";
  assert.equal(trialEndsAt(created).getTime(), new Date(created).getTime() + TRIAL_DAYS * DAY_MS);
});

test("accounts from before the trial count it from its start", () => {
  const start = new Date(TRIAL_START).getTime();
  assert.equal(trialEndsAt("2026-01-01T00:00:00Z").getTime(), start + TRIAL_DAYS * DAY_MS);
  assert.equal(trialEndsAt(null).getTime(), start + TRIAL_DAYS * DAY_MS);
});
