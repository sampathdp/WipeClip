// Run with: npm run desktop:test:js
// Hand edits to caption layers and the names hint (src/lib/editor/captionEdit.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyHint, editCaption, mergeCaptions, replaceInCaptions, wrap } from "../../src/lib/editor/captionEdit.ts";
import type { Overlay, TextStyle } from "../../src/lib/editor/types.ts";

type TextLayer = Extract<Overlay, { kind: "text" }>;

const style = (content: string): TextStyle => ({
  content,
  font: "inter",
  size: 0.05,
  weight: 700,
  italic: false,
  color: "#ffffff",
  background: "",
  backgroundOpacity: 0,
  strokeColor: "#000000",
  strokeWidth: 0,
  shadow: false,
  align: "center",
  letterSpacing: 0,
  lineHeight: 1.2,
});

function caption(id: string, start: number, end: number, content: string, words?: { start: number; end: number }[]): TextLayer {
  return {
    id,
    kind: "text",
    caption: true,
    start,
    end,
    x: 0.5,
    y: 0.82,
    width: 0.25,
    rotation: 0,
    opacity: 1,
    animIn: "none",
    animOut: "none",
    hidden: false,
    locked: false,
    text: style(content),
    ...(words ? { words } : {}),
  };
}

const w = (text: string, start = 0, end = 0.3) => ({ start, end, text });

test("hint fixes the case of a name", () => {
  assert.deepEqual(applyHint([w("kandy"), w("is"), w("nice.")], "Kandy").map((x) => x.text), ["Kandy", "is", "nice."]);
});

test("hint fixes a near miss and keeps punctuation", () => {
  assert.equal(applyHint([w("Rowen,")], "Ruwan")[0].text, "Rowen,"); // two letters off a 5-letter name: kept
  assert.equal(applyHint([w("Ruwen,")], "Ruwan")[0].text, "Ruwan,");
  assert.equal(applyHint([w("typscript")], "TypeScript")[0].text, "TypeScript");
});

test("hint leaves short and unrelated words alone", () => {
  assert.equal(applyHint([w("then")], "Theo")[0].text, "then"); // under 5 letters: exact match only
  assert.equal(applyHint([w("walking")], "talking")[0].text, "walking"); // different first letter
  assert.deepEqual(applyHint([w("hello")], ""), [w("hello")]);
});

test("editing text keeps word timings while the word count stays", () => {
  const c = caption("a", 1, 2, "HELLO WORLD", [
    { start: 0, end: 0.4 },
    { start: 0.5, end: 0.9 },
  ]);
  assert.deepEqual(editCaption(c, { text: "HELLO WORD" }).words, c.words);
  assert.equal(editCaption(c, { text: "HELLO BIG WORLD" }).words, undefined);
});

test("moving a caption's start keeps its words where they're spoken", () => {
  const c = caption("a", 1, 2, "HI THERE", [
    { start: 0, end: 0.4 },
    { start: 0.5, end: 0.9 },
  ]);
  const e = editCaption(c, { start: 0.8 });
  assert.equal(e.start, 0.8);
  assert.deepEqual(e.words, [
    { start: 0.2, end: 0.6 },
    { start: 0.7, end: 1.1 },
  ]);
});

test("a caption can't end before it starts", () => {
  const e = editCaption(caption("a", 1, 2, "X"), { end: 0.5 });
  assert.ok(e.end > e.start);
});

test("joining captions spans both and rewraps the text", () => {
  const a = caption("a", 1, 2, "one two", [
    { start: 0, end: 0.4 },
    { start: 0.5, end: 0.9 },
  ]);
  const b = caption("b", 2, 3, "three", [{ start: 0.1, end: 0.5 }]);
  const m = mergeCaptions(a, b, 36);
  assert.equal(m.id, "a");
  assert.equal(m.start, 1);
  assert.equal(m.end, 3);
  assert.equal(m.text.content, "one two three");
  assert.deepEqual(m.words?.[2], { start: 1.1, end: 1.5 });
});

test("replace changes whole words only and counts captions", () => {
  const overlays: Overlay[] = [caption("a", 0, 1, "teh cat"), caption("b", 1, 2, "tehran"), caption("c", 2, 3, "Teh end")];
  const res = replaceInCaptions(overlays, "teh", "the", false);
  assert.equal(res.changed, 2);
  const text = res.overlays.map((o) => (o.kind === "text" ? o.text.content : ""));
  assert.deepEqual(text, ["the cat", "tehran", "the end"]);
  assert.equal(replaceInCaptions(overlays, "teh", "the", true).changed, 1);
});

test("wrap breaks at spaces", () => {
  assert.equal(wrap("one two three four", 9), "one two\nthree\nfour");
});
