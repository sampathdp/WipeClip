// Run with: npm run desktop:test:js
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canExportAt,
  dubSeconds,
  featuresAboveTier,
  planFeaturesUsed,
  PREMIUM,
  premiumFeaturesUsed,
  TIER_LIMITS,
  tierForDub,
  tierForFeatures,
  tierForResolution,
  type PremiumCheckable,
} from "../../src/lib/entitlements.ts";

const clip = (extra: object = {}) => ({ transition: null, look: { filter: "original" }, ...extra });
const base = (extra: Partial<PremiumCheckable> = {}): PremiumCheckable => ({ clips: [clip()], effects: [], ...extra });

test("everyday editing is free", () => {
  const p = base({
    clips: [clip({ transition: { type: "wipeleft" } }), clip()],
    effects: [{ type: "vignette" }, { type: "letterbox" }],
    overlays: [{ maskStyle: { shape: "circle", invert: false }, textAnim: "typewriter" }],
    format: "mp4",
    quality: "standard",
    fps: 60,
    fpsChosen: false, // a recording's own rate, not a choice
  });
  assert.deepEqual(premiumFeaturesUsed(p), []);
});

test("pro tools are found in the export payload", () => {
  const p = base({
    clips: [clip({ ramp: [1, 2], stabilize: 50, look: { filter: "original", lut: { intensity: 80 }, curve: [[0, 1]] }, maskStyle: { shape: "linear", invert: false } })],
    overlays: [{ blend: "screen" }, { key: { color: "#00ff00" } }, { keyed: true }, { textAnim: "karaoke" }, { customFont: true }, { matte: { mode: "image" } }],
    audio: [{ duck: { amount: 0.5, regions: [] } }, { voice: "robot" }],
    format: "gif",
    quality: "max",
    fps: 60,
    fpsChosen: true,
  });
  const used = premiumFeaturesUsed(p);
  for (const name of Object.values(PREMIUM).filter((n) => n !== PREMIUM.audioOnly)) assert.ok(used.includes(name), `missing ${name}`);
});

test("pro tools are found in the editor's own project", () => {
  const used = premiumFeaturesUsed(
    base({
      clips: [clip({ look: { filter: "original", curves: { rgb: [[0, 0], [0.5, 0.7], [1, 1]] } }, mask: { shape: "circle", invert: true } })],
      overlays: [{ text: { anim: "karaoke", font: "src:font_1" } }],
    })
  );
  assert.deepEqual(new Set(used), new Set([PREMIUM.curves, PREMIUM.maskShape, PREMIUM.karaoke, PREMIUM.customFont]));
});

test("each premium tool needs its own plan", () => {
  const p = base({
    clips: [clip({ transition: { type: "zoomin" } }), clip({ ramp: [1, 2] })],
    overlays: [{ textAnim: "karaoke" }, { customFont: true }],
  });
  const tiers = Object.fromEntries(planFeaturesUsed(p).map((f) => [f.name, f.tier]));
  assert.equal(tiers[PREMIUM.karaoke], "lite");
  assert.equal(tiers[PREMIUM.speedCurve], "starter");
  assert.equal(tiers[PREMIUM.customFont], "pro");
  assert.deepEqual(featuresAboveTier(p, "pro"), []);
  assert.deepEqual(new Set(featuresAboveTier(p, "starter").map((f) => f.name)), new Set([PREMIUM.customFont]));
  assert.equal(tierForFeatures(featuresAboveTier(p, "free")), "pro");
  assert.equal(tierForFeatures(featuresAboveTier(base({ overlays: [{ textAnim: "karaoke" }] }), "free")), "lite");
});

test("a blurred webcam background is free; removing or replacing it is Lite", () => {
  assert.deepEqual(premiumFeaturesUsed(base({ overlays: [{ matte: { mode: "blur" } }] })), []);
  for (const mode of ["remove", "image", "video"]) {
    assert.deepEqual(planFeaturesUsed(base({ overlays: [{ matte: { mode } }] })), [{ name: PREMIUM.webcamBackground, tier: "lite" }]);
  }
});

test("voice translation length follows the plan, however the voice is split", () => {
  const voice = (duration: number, extra: object = {}) => ({ dub: true, duration, ...extra });
  assert.equal(tierForDub(0), "free");
  assert.equal(tierForDub(60), "free");
  assert.equal(tierForDub(61), "lite");
  assert.equal(tierForDub(10 * 60), "lite");
  assert.equal(tierForDub(10 * 60 + 1), "starter");
  assert.equal(tierForDub(31 * 60), "pro");
  assert.deepEqual(premiumFeaturesUsed(base({ audio: [voice(45)] })), []);
  // Three 40 s parts are two minutes of translated voice.
  assert.deepEqual(planFeaturesUsed(base({ audio: [voice(40), voice(40), voice(40)] })), [{ name: "Voice translation of 2 min", tier: "lite" }]);
  // Muted parts don't play, and tracks that aren't translated don't count.
  assert.equal(dubSeconds({ audio: [voice(300, { muted: true }), { duration: 300 }, voice(30)] }), 30);
});

test("the desktop app exports higher than the website", () => {
  assert.equal(canExportAt("free", "1080p", true), true);
  assert.equal(canExportAt("free", "1080p"), false);
  assert.equal(canExportAt("free", "4k", true), false);
  assert.equal(tierForResolution("1080p", true), "free");
  assert.equal(tierForResolution("1080p"), "lite");
  assert.equal(tierForResolution("4k", true), "pro");
  assert.equal(TIER_LIMITS.free.compactExport, true);
});
