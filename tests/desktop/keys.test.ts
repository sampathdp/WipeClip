// Run with: npm run desktop:test:js
import assert from "node:assert/strict";
import { test } from "node:test";
import { altKey, modKey } from "../../src/lib/platform/keys.ts";

function withUserAgent(ua: string, fn: () => void) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { userAgent: ua }, configurable: true });
  try {
    fn();
  } finally {
    if (saved) Object.defineProperty(globalThis, "navigator", saved);
  }
}

test("shortcut hints name Cmd/Option on a Mac, Ctrl/Alt elsewhere", () => {
  withUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)", () => {
    assert.equal(modKey(), "Cmd");
    assert.equal(altKey(), "Option");
  });
  withUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/141.0", () => {
    assert.equal(modKey(), "Ctrl");
    assert.equal(altKey(), "Alt");
  });
});
