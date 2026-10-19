// Run with: npm run desktop:test:js
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const script = path.join(import.meta.dirname, "..", "..", "desktop", "scripts", "check-bundle.mjs");
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.c2lnbmF0dXJlc2lnbmF0dXJl`;

function scan(contents) {
  const dir = mkdtempSync(path.join(tmpdir(), "wipeclip-scan-"));
  try {
    writeFileSync(path.join(dir, "chunk.js"), contents);
    return spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("public anon key passes", () => {
  const res = scan(`const k="${jwt({ role: "anon", iss: "supabase", ref: "abcdefghij" })}";`);
  assert.equal(res.status, 0, res.stderr);
});

test("service_role key fails without printing it", () => {
  const key = jwt({ role: "service_role", iss: "supabase", ref: "abcdefghij" });
  const res = scan(`const k="${key}";`);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /service_role/);
  assert.ok(!res.stderr.includes(key));
});

test("payment and webhook secrets fail", () => {
  assert.equal(scan('x="sk_live_abcdefghijklmnop"').status, 1);
  assert.equal(scan('x="whsec_abcdefghijklmnop"').status, 1);
  assert.equal(scan('x="pdl_live_apikey_abcdefghijklmnop"').status, 1);
});
