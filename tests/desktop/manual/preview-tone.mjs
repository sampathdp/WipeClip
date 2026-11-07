// Track tone in a real browser: headless Chrome renders the test voice
// through src/lib/editor/voiceTone.ts connectTone (its BiquadFilterNodes and
// the voice-dynamics AudioWorklet) in an OfflineAudioContext at 48 kHz, and
// compares it with ffmpeg running the export's chains
// (tests/fixtures/tone-chains.json).
//
// Run from the repository root:  node tests/desktop/manual/preview-tone.mjs
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { ffmpegPath, launch } from "./cdp.mjs";

const RATE = 48000;
const SECONDS = 3;
const FF = ffmpegPath();
const { cases } = JSON.parse(readFileSync("tests/fixtures/tone-chains.json", "utf8"));
const source = stripTypeScriptTypes(readFileSync("src/lib/editor/voiceTone.ts", "utf8"));

/** Same test voice as tests/desktop/voiceTone.test.ts. */
function testSignal() {
  const n = SECONDS * RATE;
  const x = new Float64Array(n);
  let seed = 42;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 31 - 1);
  let hp = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const level = Math.floor(t / 0.25) % 2 ? 0.08 : 0.5;
    let v = 0;
    for (let h = 1; h <= 20; h++) v += Math.sin(2 * Math.PI * 130 * h * t) / h;
    x[i] = level * 0.4 * v + 0.05 * Math.sin(2 * Math.PI * 40 * t);
    const r = rand();
    hp = 0.9 * (hp + r - prev);
    prev = r;
    if (t % 0.75 > 0.6 && t % 0.75 < 0.68) x[i] += 0.3 * hp;
  }
  return x;
}

function ffmpeg(x, chain) {
  const res = spawnSync(FF, ["-hide_banner", "-loglevel", "error", "-f", "f64le", "-ar", `${RATE}`, "-ac", "1", "-i", "pipe:0", "-af", chain, "-f", "f64le", "pipe:1"], {
    input: Buffer.from(x.buffer),
    maxBuffer: 1 << 28,
  });
  if (res.status !== 0) throw new Error(res.stderr.toString());
  return new Float64Array(res.stdout.buffer.slice(res.stdout.byteOffset, res.stdout.byteOffset + res.stdout.byteLength));
}

const x = testSignal();
// AudioWorklet needs a secure context: localhost is one, about:blank isn't.
const server = createServer((_, res) => res.end("<!doctype html><title>tone</title>")).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const b = await launch({ port: 9341 });
let failed = 0;
try {
  await b.send("Page.navigate", { url: `http://localhost:${server.address().port}/` });
  for (let i = 0; i < 50 && !(await b.evaluate("document.readyState === 'complete' && isSecureContext")); i++) await new Promise((r) => setTimeout(r, 100));
  await b.evaluate(`(async () => {
    const url = URL.createObjectURL(new Blob([${JSON.stringify(source)}], { type: "text/javascript" }));
    window.tone = await import(url);
    return true;
  })()`);
  const input = Array.from(new Float32Array(x));
  for (const c of cases) {
    const out = await b.evaluate(`(async () => {
      const ctx = new OfflineAudioContext(1, ${x.length}, ${RATE});
      const buf = ctx.createBuffer(1, ${x.length}, ${RATE});
      buf.getChannelData(0).set(${JSON.stringify(input)});
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const t = await window.tone.connectTone(ctx, ${JSON.stringify(c.wire)}, src, 1);
      t.output.connect(ctx.destination);
      src.start();
      const r = await ctx.startRendering();
      return { dynamics: t.dynamics, samples: Array.from(r.getChannelData(0)) };
    })()`);
    const ref = ffmpeg(Float64Array.from(new Float32Array(x)), c.chain);
    let err = 0;
    let peak = 0;
    for (let i = 0; i < Math.min(ref.length, out.samples.length); i++) {
      err = Math.max(err, Math.abs(out.samples[i] - ref[i]));
      peak = Math.max(peak, Math.abs(ref[i]));
    }
    const db = 20 * Math.log10(err / peak + 1e-20);
    // Chrome filters in 32-bit floats; -60 dB below the peak is inaudible.
    const ok = out.dynamics && db < -60;
    if (!ok) failed++;
    console.log(`${ok ? "pass" : "FAIL"}  ${c.name.padEnd(16)} ${db.toFixed(1)} dB${out.dynamics ? "" : " (worklet didn't load)"}`);
  }
  if (b.errors.length) {
    failed++;
    console.log("page errors:", b.errors);
  }
} finally {
  await b.close();
  server.close();
}
console.log(failed ? `${failed} failed` : `${cases.length}/${cases.length}`);
process.exit(failed ? 1 : 0);
