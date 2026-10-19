// Run with: npm run desktop:test:js
import assert from "node:assert/strict";
import { test } from "node:test";
import { preflight, withCors } from "../../src/lib/cors.ts";

const req = (origin?: string) => new Request("https://www.wipeclip.co/api/export", { headers: origin ? { origin } : {} });

test("desktop origins get CORS headers", () => {
  for (const origin of ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"]) {
    const res = withCors(req(origin), new Response("{}"));
    assert.equal(res.headers.get("access-control-allow-origin"), origin);
    assert.match(res.headers.get("access-control-allow-headers") ?? "", /Authorization/);
    assert.equal(res.headers.get("access-control-allow-credentials"), null);
  }
});

test("other origins and same-origin requests are left alone", () => {
  for (const origin of ["https://evil.example", "http://localhost:3100", "null", undefined]) {
    const res = withCors(req(origin), new Response("{}"));
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  }
});

test("preflight only succeeds for desktop origins", () => {
  assert.equal(preflight(req("tauri://localhost")).status, 204);
  assert.equal(preflight(req("https://evil.example")).status, 403);
});

test("DESKTOP_DEV_ORIGINS adds the dev server origin", () => {
  process.env.DESKTOP_DEV_ORIGINS = "http://localhost:3100";
  try {
    assert.equal(preflight(req("http://localhost:3100")).status, 204);
  } finally {
    delete process.env.DESKTOP_DEV_ORIGINS;
  }
});
