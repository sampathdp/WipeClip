// Run with: npm run desktop:test:js
import assert from "node:assert/strict";
import { test } from "node:test";
import { curveFn, curveTables, DEFAULT_CURVES } from "../../src/lib/editor/curves.ts";
import { parseCube, resampleLut, sampleLut } from "../../src/lib/editor/lut.ts";

const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test("curves pass through their points and stay monotone", () => {
  const f = curveFn([
    [0, 0],
    [0.25, 0.4],
    [0.75, 0.6],
    [1, 1],
  ]);
  near(f(0.25), 0.4);
  near(f(0.75), 0.6);
  let prev = -1;
  for (let i = 0; i <= 100; i++) {
    const v = f(i / 100);
    assert.ok(v >= prev - 1e-9, "never falls");
    prev = v;
  }
  // Identity curves give identity tables.
  for (const t of curveTables(DEFAULT_CURVES)) t.forEach((v, i) => near(v, i / (t.length - 1)));
});

test("a .cube LUT parses and samples trilinearly", () => {
  const lines = ["TITLE \"swap\"", "LUT_3D_SIZE 2"];
  for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) lines.push(`${b} ${g} ${r}`);
  const lut = parseCube(lines.join("\n"));
  assert.equal(lut.size, 2);
  const [r, g, b] = sampleLut(lut, 0.8, 0.3, 0.1);
  near(r, 0.1);
  near(g, 0.3);
  near(b, 0.8);
  assert.equal(resampleLut(lut, 5).size, 2, "never upsampled");
  assert.throws(() => parseCube("LUT_3D_SIZE 3\n0 0 0"));
});
