// Run with: npm run desktop:test:js
// Per-pixel transitions in the preview (src/lib/editor/xfade.ts) against
// values read from real ffmpeg xfade renders (black -> white, 160x90).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { TRANSITION_LABELS } from "../../src/lib/editor/timeline.ts";
import { cropInside, maskPixels, softAlpha } from "../../src/lib/editor/xfade.ts";

const W = 160;
const H = 90;
const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) <= 0.06, `${what}: ${a.toFixed(3)} vs ${b}`);

test("soft sweeps match the export", () => {
  // [type, x, y, p, measured incoming share]
  const cases: [Parameters<typeof softAlpha>[0], number, number, number, number][] = [
    ["smoothleft", 144, 45, 0.25, 0.35],
    ["smoothleft", 80, 45, 0.5, 0.5],
    ["smoothleft", 16, 45, 0.75, 0.65],
    ["smoothup", 80, 81, 0.25, 0.35],
    ["vertopen", 80, 45, 0.25, 0.5],
    ["vertopen", 32, 45, 0.5, 0.35],
    ["horzopen", 80, 27, 0.5, 0.65],
    ["diagtl", 144, 45, 0.5, 0.42],
    ["diagtl", 0, 45, 0.75, 0.5],
    ["diagbr", 0, 45, 0.5, 0.48],
    ["radial", 112, 45, 0.5, 1],
    ["radial", 80, 9, 0.25, 1],
    ["radial", 32, 45, 0.5, 0],
  ];
  for (const [type, x, y, p, want] of cases) near(softAlpha(type, x, y, W, H, p), want, `${type} (${x},${y}) p=${p}`);
});

test("crops shrink to the center, then grow", () => {
  assert.ok(cropInside("circlecrop", 80, 45, W, H, 0.1));
  assert.ok(!cropInside("circlecrop", 16, 45, W, H, 0.1));
  assert.ok(cropInside("rectcrop", 32, 45, W, H, 0.1));
  assert.ok(!cropInside("rectcrop", 0, 45, W, H, 0.1));
  assert.ok(cropInside("rectcrop", 64, 45, W, H, 0.9));
});

test("mask pixels carry the alpha", () => {
  const px = maskPixels("smoothleft", 1, 8, 4);
  assert.equal(px.length, 8 * 4 * 4);
  assert.ok([...px].filter((_, i) => i % 4 === 3).every((a) => a === 255));
});

test("the preview and the export know the same transitions", () => {
  const py = readFileSync(new URL("../../backend/app/pipeline/editor.py", import.meta.url), "utf8");
  const block = py.slice(py.indexOf("TRANSITIONS: dict"), py.indexOf("}", py.indexOf("TRANSITIONS: dict")));
  const exported = [...block.matchAll(/^\s+"(\w+)":/gm)].map((m) => m[1]).sort();
  assert.deepEqual(Object.keys(TRANSITION_LABELS).sort(), exported);
});
