// Sends the promotion newsletter from the command line - the same thing the
// admin panel's Newsletter page does (src/lib/newsletter.ts). See docs/NEWSLETTER.md.
//
//   npm run newsletter -- --campaign=promo-2026-10                    dry run: counts and writes a preview
//   npm run newsletter -- --campaign=promo-2026-10 --test=you@x.com   sends one copy to that account
//   npm run newsletter -- --campaign=promo-2026-10 --send --limit=200 real send, first 200 recipients
//
// Sends are recorded in the newsletter_sends table, so a rerun with the same
// --campaign skips everyone already sent, from here or from the admin panel.

import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { currentPromo } from "../src/lib/promo.ts";
import {
  eligibleRecipients,
  newsletterConfig,
  newsletterMessage,
  sendCampaign,
  sendResendBatch,
  sentIds,
} from "../src/lib/newsletter.ts";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=", 2);
    return [k, v ?? "true"] as const;
  })
);
const campaign = args.get("campaign");
const send = args.get("send") === "true";
const testTo = args.get("test")?.toLowerCase();
const limit = args.has("limit") ? Number(args.get("limit")) : Infinity;

if (!campaign || !/^[a-z0-9-]{3,60}$/.test(campaign)) {
  throw new Error("Pass --campaign=<name> (lowercase letters, digits and dashes), e.g. --campaign=promo-2026-10.");
}
const config = newsletterConfig();
if ("error" in config) throw new Error(config.error);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const promo = await currentPromo(admin);
if (!promo) throw new Error("No live promotion: turn one on at /admin/promotion.");

const all = await eligibleRecipients(admin, promo);
if (testTo) {
  const me = all.find((r) => r.email === testTo);
  if (!me) throw new Error(`${testTo} is not a confirmed, subscribed account eligible for this promotion.`);
  const msg = newsletterMessage(config, promo, campaign, me);
  await sendResendBatch(config.apiKey, [{ ...msg, subject: `[TEST] ${msg.subject}` }], `${campaign}-test-${Date.now()}`);
  console.log(`Test sent to ${testTo}.`);
  process.exit(0);
}

const done = await sentIds(admin, campaign);
const pending = all.filter((r) => !done.has(r.id)).slice(0, limit);
console.log(`${all.length} eligible, ${done.size} already sent, ${pending.length} in this run.`);

if (!send) {
  if (pending[0]) {
    mkdirSync("newsletter-logs", { recursive: true });
    writeFileSync(`newsletter-logs/${campaign}-preview.html`, newsletterMessage(config, promo, campaign, pending[0]).html);
  }
  console.log(`Dry run - nothing sent. Preview: newsletter-logs/${campaign}-preview.html. Add --send to send.`);
  process.exit(0);
}

await sendCampaign(admin, config, promo, campaign, pending, (n) => console.log(`Sent ${n} / ${pending.length}`));
console.log("Done.");
