// Run with: npm run desktop:test:js
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNotices } from "../../desktop/scripts/notices.mjs";

test("notices cover the UI packages and Rust crates, with licence texts", () => {
  const text = buildNotices({ engine: false });
  assert.match(text, /^ {2}react \S+ \(MIT\)$/m);
  assert.match(text, /^ {2}@supabase\/supabase-js \S+ \(MIT\)$/m);
  assert.match(text, /^ {2}tauri \S+ \(Apache-2\.0 OR MIT\)$/m);
  assert.match(text, /Applies to: .*\breact \S+/);
  assert.match(text, /Permission is hereby granted, free of charge/);
});

test("notices leave out build tools and Node-only packages", () => {
  const text = buildNotices({ engine: false });
  assert.doesNotMatch(text, /^ {2}(typescript|eslint|tailwindcss|@tauri-apps\/cli|sharp|onnxruntime-node) /m);
  assert.doesNotMatch(text, /^ {2}tauri-build /m);
});
