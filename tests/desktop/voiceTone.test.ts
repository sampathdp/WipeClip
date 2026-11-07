// Run with: npm run desktop:test:js
// Track tone (src/lib/editor/voiceTone.ts): the settings, and the preview's
// processing checked against ffmpeg running the export's chains
// (tests/fixtures/tone-chains.json, built by editor.py tone_chain).
// The ffmpeg checks run when an ffmpeg binary is found (FFMPEG, the
// engine's bundled copy, or PATH); otherwise they're skipped.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  BUTTERWORTH_Q_DB,
  DYNAMICS_SOURCE,
  NEUTRAL_TONE,
  TONE_BASS_HZ,
  TONE_LOW_CUT_HZ,
  TONE_MID_HZ,
  TONE_MID_Q,
  TONE_PRESETS,
  TONE_TREBLE_HZ,
  compressorFor,
  editTone,
  presetTone,
  toneActive,
  toneKey,
  toneWire,
  type ToneWire,
} from "../../src/lib/editor/voiceTone.ts";
import { mixKey } from "../../src/lib/editor/mix.ts";
import type { AudioClip, Project, TonePreset } from "../../src/lib/editor/types.ts";

const RATE = 48000;
const FIXTURE = JSON.parse(readFileSync(new URL("../fixtures/tone-chains.json", import.meta.url), "utf8")) as {
  cases: { name: string; preset?: TonePreset; wire: ToneWire; chain: string }[];
};

function findFfmpeg(): string | null {
  if (process.env.FFMPEG && existsSync(process.env.FFMPEG)) return process.env.FFMPEG;
  const dir = join(import.meta.dirname, "../../backend/.venv/Lib/site-packages/imageio_ffmpeg/binaries");
  if (existsSync(dir)) {
    const exe = readdirSync(dir).find((f) => f.startsWith("ffmpeg"));
    if (exe) return join(dir, exe);
  }
  const probe = spawnSync("ffmpeg", ["-version"]);
  return probe.status === 0 ? "ffmpeg" : null;
}
const FFMPEG = findFfmpeg();

/** Runs a mono 48 kHz signal through an ffmpeg filter chain. */
function ffmpeg(x: Float64Array, chain: string): Float64Array {
  const res = spawnSync(
    FFMPEG!,
    ["-hide_banner", "-loglevel", "error", "-f", "f64le", "-ar", String(RATE), "-ac", "1", "-i", "pipe:0", "-af", chain, "-f", "f64le", "-ar", String(RATE), "-ac", "1", "pipe:1"],
    { input: Buffer.from(x.buffer), maxBuffer: 1 << 28 }
  );
  assert.equal(res.status, 0, res.stderr.toString());
  const b = res.stdout;
  return new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

/** Web Audio's BiquadFilterNode, as the spec defines it (Audio EQ Cookbook). */
function biquad(x: Float64Array, type: "highpass" | "lowshelf" | "peaking" | "highshelf", f0: number, gain: number, q: number): Float64Array {
  const A = 10 ** (gain / 40);
  const w0 = (2 * Math.PI * f0) / RATE;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const aQ = sin / (2 * q);
  const aQdB = sin / (2 * 10 ** (q / 20));
  const aS = (sin / 2) * Math.sqrt(2); // S = 1
  const sq = 2 * aS * Math.sqrt(A);
  let c: number[];
  if (type === "highpass") c = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + aQdB, -2 * cos, 1 - aQdB];
  else if (type === "peaking") c = [1 + aQ * A, -2 * cos, 1 - aQ * A, 1 + aQ / A, -2 * cos, 1 - aQ / A];
  else if (type === "lowshelf")
    c = [A * (A + 1 - (A - 1) * cos + sq), 2 * A * (A - 1 - (A + 1) * cos), A * (A + 1 - (A - 1) * cos - sq), A + 1 + (A - 1) * cos + sq, -2 * (A - 1 + (A + 1) * cos), A + 1 + (A - 1) * cos - sq];
  else c = [A * (A + 1 + (A - 1) * cos + sq), -2 * A * (A - 1 + (A + 1) * cos), A * (A + 1 + (A - 1) * cos - sq), A + 1 - (A - 1) * cos + sq, 2 * (A - 1 - (A + 1) * cos), A + 1 - (A - 1) * cos - sq];
  const [b0, b1, b2, a0, a1, a2] = c;
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/** The preview's processing of one mono track: biquads, then the worklet's code. */
const { Dynamics } = new Function(`${DYNAMICS_SOURCE}; return { Dynamics };`)() as {
  Dynamics: new (o: { deEss: number; comp: ToneWire["comp"] }, rate: number, channels: number) => { process(chs: Float64Array[], n: number): void };
};
function preview(x: Float64Array, w: ToneWire): Float64Array {
  let y = x;
  if (w.lowCut) y = biquad(y, "highpass", TONE_LOW_CUT_HZ, 0, BUTTERWORTH_Q_DB);
  if (w.bass) y = biquad(y, "lowshelf", TONE_BASS_HZ, w.bass, 1);
  if (w.mid) y = biquad(y, "peaking", TONE_MID_HZ, w.mid, TONE_MID_Q);
  if (w.treble) y = biquad(y, "highshelf", TONE_TREBLE_HZ, w.treble, 1);
  if (w.deEss > 0 || w.comp) {
    y = Float64Array.from(y);
    const d = new Dynamics({ deEss: w.deEss, comp: w.comp }, RATE, 1);
    // In 128-frame blocks, as an AudioWorklet runs.
    for (let i = 0; i < y.length; i += 128) {
      const block = y.subarray(i, Math.min(y.length, i + 128));
      d.process([block], block.length);
    }
  }
  return y;
}

/** A test voice: harmonic "vowels" alternating loud and quiet, sibilant
 * hiss bursts, and 40 Hz rumble under all of it. */
function testSignal(seconds = 3): Float64Array {
  const n = seconds * RATE;
  const x = new Float64Array(n);
  let seed = 42;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 31 - 1);
  let hp = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const seg = Math.floor(t / 0.25);
    const level = seg % 2 ? 0.08 : 0.5;
    let v = 0;
    for (let h = 1; h <= 20; h++) v += Math.sin(2 * Math.PI * 130 * h * t) / h;
    x[i] = level * 0.4 * v + 0.05 * Math.sin(2 * Math.PI * 40 * t);
    // "s": high-passed noise, 80 ms every 0.75 s.
    const r = rand();
    hp = 0.9 * (hp + r - prev);
    prev = r;
    if (t % 0.75 > 0.6 && t % 0.75 < 0.68) x[i] += 0.3 * hp;
  }
  return x;
}

const rmsDb = (x: Float64Array, a = 0, b = x.length) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return 10 * Math.log10(s / Math.max(1, b - a) + 1e-20);
};
/** Largest difference, in dB below the signal's peak. */
function errorDb(a: Float64Array, b: Float64Array): number {
  assert.ok(Math.abs(a.length - b.length) <= 1, `${a.length} vs ${b.length} samples`);
  const n = Math.min(a.length, b.length);
  let err = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    err = Math.max(err, Math.abs(a[i] - b[i]));
    peak = Math.max(peak, Math.abs(b[i]));
  }
  return 20 * Math.log10(err / peak + 1e-20);
}

test("the preview's EQ, de-esser and compressor match ffmpeg running the export's chain", { skip: !FFMPEG && "no ffmpeg" }, () => {
  const x = testSignal();
  for (const c of FIXTURE.cases) {
    const e = errorDb(preview(x, c.wire), ffmpeg(x, c.chain));
    // -80 dB below the peak is far under hearing; the chain rounds its
    // linear threshold and makeup to 6 decimals.
    if (process.env.TONE_REPORT) console.log(`${c.name}: ${e.toFixed(1)} dB`);
    assert.ok(e < -80, `${c.name}: differs by ${e.toFixed(1)} dB`);
  }
});

test("the presets' numbers are the ones pinned for the export", () => {
  for (const c of FIXTURE.cases.filter((c) => c.preset)) assert.deepEqual(toneWire(presetTone(c.preset!)), c.wire, c.name);
  assert.equal(FIXTURE.cases.filter((c) => c.preset).length, Object.keys(TONE_PRESETS).length, "every preset is pinned");
});

test("what each part does to the test voice", () => {
  const x = testSignal();
  const only = (patch: Partial<ToneWire>): ToneWire => ({ lowCut: false, bass: 0, mid: 0, treble: 0, deEss: 0, comp: null, ...patch });
  // Low cut: the 40 Hz rumble drops by about 10 dB (2-pole at 80 Hz).
  const rumble = (y: Float64Array) => {
    let re = 0, im = 0;
    for (let i = 0; i < y.length; i++) {
      re += y[i] * Math.cos((2 * Math.PI * 40 * i) / RATE);
      im += y[i] * Math.sin((2 * Math.PI * 40 * i) / RATE);
    }
    return 10 * Math.log10(re * re + im * im);
  };
  const cut = rumble(x) - rumble(preview(x, only({ lowCut: true })));
  assert.ok(cut > 9 && cut < 15, `rumble down ${cut.toFixed(1)} dB`);
  // Compressor: loud and quiet parts move closer together.
  const spread = (y: Float64Array) => rmsDb(y, 0.05 * RATE, 0.25 * RATE) - rmsDb(y, 0.3 * RATE, 0.5 * RATE);
  const before = spread(x);
  const after = spread(preview(x, only({ comp: compressorFor(0.75) })));
  assert.ok(before - after > 3, `loud/quiet spread ${before.toFixed(1)} -> ${after.toFixed(1)} dB`);
  // De-esser: the hiss bursts get quieter, the vowels barely change.
  const ess = (y: Float64Array) => rmsDb(y, 0.61 * RATE, 0.67 * RATE);
  const vowel = (y: Float64Array) => rmsDb(y, 0.05 * RATE, 0.2 * RATE);
  const de = preview(x, only({ deEss: 0.6 }));
  assert.ok(ess(x) - ess(de) > 1, `"s" down ${(ess(x) - ess(de)).toFixed(2)} dB`);
  assert.ok(Math.abs(vowel(x) - vowel(de)) < 0.5, `vowel changed ${(vowel(x) - vowel(de)).toFixed(2)} dB`);
});

test("settings: neutral is off, a manual change leaves the preset, numbers are clamped", () => {
  assert.equal(toneActive(undefined), false);
  assert.equal(toneActive(NEUTRAL_TONE), false);
  assert.equal(toneWire(NEUTRAL_TONE), null);
  assert.equal(toneKey(null), "");
  const clear = presetTone("clear");
  assert.equal(clear.preset, "clear");
  const edited = editTone(clear, { bass: 2 });
  assert.equal(edited.preset, undefined);
  assert.equal(edited.treble, clear.treble);
  assert.deepEqual(editTone(undefined, { lowCut: true }), { ...NEUTRAL_TONE, lowCut: true });
  const wild = toneWire({ ...NEUTRAL_TONE, bass: 40, mid: -99, treble: Number.NaN, compress: 3, deEss: -1 })!;
  assert.deepEqual([wild.bass, wild.mid, wild.treble, wild.deEss], [12, -12, 0, 0]);
  assert.deepEqual(wild.comp, compressorFor(1));
});

test("compressor amounts stay inside what the export accepts", () => {
  assert.equal(compressorFor(0), null);
  for (const a of [0.01, 0.25, 0.5, 0.75, 1]) {
    const c = compressorFor(a)!;
    assert.ok(c.threshold <= -12 && c.threshold >= -30, `threshold ${c.threshold}`);
    assert.ok(c.ratio >= 1.5 && c.ratio <= 4);
    assert.ok(c.makeup >= 0 && c.makeup <= 12);
  }
  assert.ok(compressorFor(1)!.makeup > compressorFor(0.25)!.makeup);
});

test("a tone change marks the loudness measurement out of date; no tone keeps old keys", () => {
  const track = { id: "a", sourceId: "s", label: "", start: 0, offset: 0, duration: 5, volume: 1, fadeIn: 0, fadeOut: 0, muted: false } as AudioClip;
  const p = (a: AudioClip) => ({ clips: [], audio: [a], overlays: [] }) as unknown as Project;
  const plain = mixKey(p(track));
  assert.equal(mixKey(p({ ...track, tone: NEUTRAL_TONE })), plain, "a neutral tone changes nothing");
  const toned = mixKey(p({ ...track, tone: presetTone("clear") }));
  assert.notEqual(toned, plain);
  assert.notEqual(mixKey(p({ ...track, tone: presetTone("warm") })), toned);
});
