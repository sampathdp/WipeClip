// Manual check of the errors the REAL WebView2 throws when the microphone
// or camera is refused or missing - the names src/lib/recorder/mediaErrors.ts
// turns into messages (unit-tested in tests/desktop/recorder.test.ts).
// Start the app with debugging and permission prompts denied:
//
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9223 --deny-permission-prompts'
//   npm run desktop:dev
//   node tests/desktop/manual/media-errors.mjs
//
// Then restart with '--remote-debugging-port=9223 --use-fake-ui-for-media-stream'
// (prompts accepted) and run it with --allowed: the missing-device case
// must still fail, the default devices must open (or report no device).
import { connect } from "./cdp.mjs";

const allowed = process.argv.includes("--allowed");
const b = await connect({ port: 9223 });
const MAPPED = ["NotAllowedError", "SecurityError", "NotFoundError", "OverconstrainedError", "NotReadableError", "AbortError", "NotSupportedError", "TypeError"];

const attempt = (constraints) =>
  b.evaluate(`navigator.mediaDevices.getUserMedia(${JSON.stringify(constraints)})
    .then((s) => { s.getTracks().forEach((t) => t.stop()); return "opened"; }, (e) => e.name)`);

// Device kinds are listed even before permission; a kind with no device
// fails with NotFoundError whatever the permission (the no-device path).
const kinds = await b.evaluate(`navigator.mediaDevices.enumerateDevices().then((d) => d.map((x) => x.kind))`);
console.log(`devices: ${[...new Set(kinds)].join(", ") || "none"}`);
const present = { microphone: kinds.includes("audioinput"), camera: kinds.includes("videoinput") };

const cases = [
  ["microphone", { audio: true }],
  ["camera", { video: true }],
  ["missing microphone", { audio: { deviceId: { exact: "no-such-device" } } }],
  ["missing camera", { video: { deviceId: { exact: "no-such-device" } } }],
];
let ok = true;
for (const [label, constraints] of cases) {
  const r = await attempt(constraints);
  const missing = label.startsWith("missing");
  const expected = missing ? ["NotFoundError", "OverconstrainedError"] : !present[label] ? ["NotFoundError"] : allowed ? ["opened"] : ["NotAllowedError"];
  const pass = expected.includes(r) && (r === "opened" || MAPPED.includes(r));
  ok &&= pass;
  console.log(`${pass ? "ok  " : "FAIL"} ${label}: ${r} (expected ${expected.join(" or ")})`);
}
b.close?.();
process.exit(ok ? 0 : 1);
