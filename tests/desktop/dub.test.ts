// Run with: npm run desktop:test:js
// Voice translation's pure parts (src/lib/editor/dubPlan.ts): the transcript
// as sentences for translating, and the WAV files the result is kept as.
import assert from "node:assert/strict";
import { test } from "node:test";
import { dubReportMessage, dubSentences, encodePcm, type DubReport } from "../../src/lib/editor/dubPlan.ts";
import type { TranscriptWord } from "../../src/lib/editor/types.ts";

/** Words from "text@start" items, each 0.3 s long. */
function words(spec: string): TranscriptWord[] {
  return spec.split(" ").map((item) => {
    const [text, at] = item.split("@");
    return { text, start: Number(at), end: Number(at) + 0.3 };
  });
}

test("sentences end at punctuation, including the Devanagari full stop", () => {
  const s = dubSentences(words("අද@0 වාර්තා@0.4 වුනා.@0.8 ඒ@1.2 ලොව@1.6 नमस्ते।@2.0 next@2.4"));
  assert.deepEqual(
    s.map((x) => x.text),
    ["අද වාර්තා වුනා.", "ඒ ලොව नमस्ते।", "next"]
  );
  assert.deepEqual([s[0].start, s[0].end], [0, 1.1]);
});

test("a long pause ends a sentence without punctuation", () => {
  const s = dubSentences(words("one@0 two@0.4 three@1.6 four@2.0"));
  assert.deepEqual(
    s.map((x) => x.text),
    ["one two", "three four"]
  );
});

test("no sentence runs past 15 s", () => {
  const long = Array.from({ length: 80 }, (_, i) => `w${i}@${(i * 0.4).toFixed(1)}`).join(" ");
  const s = dubSentences(words(long));
  assert.ok(s.length > 1);
  assert.ok(s.every((x) => x.end - x.start <= 15.3), JSON.stringify(s.map((x) => x.end - x.start)));
  assert.equal(s.map((x) => x.text).join(" ").split(" ").length, 80);
});

test("no words, no sentences", () => {
  assert.deepEqual(dubSentences([]), []);
});

test("WAV: interleaved 16-bit channels with a matching header", async () => {
  const left = new Float32Array([0, 0.5, -1, 2]);
  const right = new Float32Array([1, -0.5, 0.25, -2]);
  const view = new DataView(await encodePcm([left, right], 44100).arrayBuffer());
  const text = (at: number, n: number) => String.fromCharCode(...Array.from({ length: n }, (_, i) => view.getUint8(at + i)));
  assert.equal(text(0, 4), "RIFF");
  assert.equal(text(8, 4), "WAVE");
  assert.equal(view.getUint16(22, true), 2); // channels
  assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getUint32(28, true), 44100 * 4); // bytes a second
  assert.equal(view.getUint32(40, true), 4 * 2 * 2); // data size
  const samples = Array.from({ length: 8 }, (_, i) => view.getInt16(44 + i * 2, true));
  assert.deepEqual(samples, [0, 32767, 16383, -16384, -32768, 8191, 32767, -32768]);
});

test("the engine's report becomes a short note, numbered from 1", () => {
  const base: DubReport = { sentences: 9, spoken: 9, empty: [], flagged: [], shortSpeech: [], spedUp: 0, overflowSeconds: 0, sampleSeconds: 9 };
  assert.equal(dubReportMessage(null), "");
  assert.equal(dubReportMessage(base), "");
  const note = dubReportMessage({ ...base, empty: [2], flagged: [{ index: 4, flags: ["number"] }], shortSpeech: [4, 6], overflowSeconds: 1.26, sampleSeconds: 2.1 });
  assert.match(note, /Sentence 3 couldn't be translated and stays silent\./);
  assert.match(note, /Check sentences 5, 7:/);
  assert.match(note, /last 1\.3 s of the translation runs past the end/);
  assert.match(note, /little clear speech/);
  const many = dubReportMessage({ ...base, flagged: [0, 1, 2, 3, 4, 5, 6].map((index) => ({ index, flags: ["short"] })) });
  assert.match(many, /1, 2, 3, 4, 5 and 2 more/);
});
