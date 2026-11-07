// Run with: npm run desktop:test:js
// The preview's seek rule (src/lib/editor/mediaSync.ts): an element that
// reached its end must still follow the playhead back.
import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldSeek, type MediaState } from "../../src/lib/editor/mediaSync.ts";

const el = (over: Partial<MediaState> = {}): MediaState => ({ readyState: 4, seeking: false, ended: false, duration: 28.27, currentTime: 5, ...over });

test("follows the playhead when off by more than the tolerance", () => {
  assert.equal(shouldSeek(el(), 9, 0.03), true);
  assert.equal(shouldSeek(el(), 5.02, 0.03), false);
  assert.equal(shouldSeek(el({ seeking: true }), 9, 0.03), false, "one seek at a time");
  assert.equal(shouldSeek(el({ readyState: 0 }), 9, 0.03), false, "nothing loaded yet");
});

test("an ended video is seeked back - the preview no longer freezes after the end", () => {
  // Dragged to the end (or played to it): the element is ended at its last frame.
  const atEnd = el({ ended: true, currentTime: 28.27 });
  assert.equal(shouldSeek(atEnd, 1.6, 0.03), true, "scrubbing back must seek (this froze the preview before)");
  assert.equal(shouldSeek(atEnd, 10, 0.5), true, "also while playing");
  // But not re-seeked at its end: that would loop.
  assert.equal(shouldSeek(atEnd, 28.3, 0.03), false);
  assert.equal(shouldSeek(atEnd, 28.25, 0.01), false);
});

test("freeze and reversed slots always follow", () => {
  assert.equal(shouldSeek(el({ ended: true, currentTime: 28.27 }), 28.0, 0.02, true), true);
});

test("an unknown duration doesn't block the seek", () => {
  assert.equal(shouldSeek(el({ ended: true, duration: NaN, currentTime: 3 }), 1, 0.03), true);
});
