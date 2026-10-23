// Run with: npm run desktop:test:js
import assert from "node:assert/strict";
import { test } from "node:test";
import { PREMIUM, premiumFeaturesUsed, type PremiumCheckable } from "../../src/lib/entitlements.ts";

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
    overlays: [{ blend: "screen" }, { key: { color: "#00ff00" } }, { keyed: true }, { textAnim: "karaoke" }, { customFont: true }],
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
