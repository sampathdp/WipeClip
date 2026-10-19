# Release readiness (Phase 4)

Status of the WipeClip desktop app (Windows and macOS) after a full build-and-test pass on 15–16 October 2026. Everything marked **verified** was run on a real machine; everything else is stated as not run.

## Summary

| | |
|---|---|
| Windows | **Built, installed and tested end to end** on Windows 11 Pro (10.0.26200, 1920×1080 at 125%): NSIS installer (6.68 MB), install, upgrade over an older build, uninstall, reinstall; record → edit → zoom → captions → masks → save/reopen → export in the installed app |
| macOS | **Not built or tested** (no Mac available). Config and CI workflow exist; see [macOS](#macos) |
| Automated tests | All green: JS 78/78, backend 14/14 (real ffmpeg renders), Rust 18/18, type checks, lint on desktop code |
| Release blockers | Five, listed [at the end](#remaining-release-blockers-prioritized) — mainly code signing, a macOS pass, deploying the backend fixes, and a production test with a real account |

## Bugs found and fixed in this pass

Found by running the installed app and inspecting the real exported files, not by reading code.

| # | Severity | Bug | Fix |
|---|---|---|---|
| 1 | Critical (privacy) | **Privacy masks and click highlights were never exported.** The API handed the export to its worker as JSON that listed only clips/overlays/audio/effects; `masks` and `pointer` were dropped, so a masked area appeared unblurred in the downloaded video although the preview covered it. Backend tests rendered the plan directly and missed it | `plan_to_json` / `plan_from_json` in `pipeline/editor.py` carry every field; `main.py` and `jobs.py` use them. Test `test_masks_survive_the_export_job` goes through the real job entry point |
| 2 | High | **Click rings were drawn from the start of the video until their click** (a step schedule held its first row's value before that row) | Each ring layer starts with a hidden row at 0 s. `test_pointer_ring_and_cursor` checks no ring before the click (fails without the fix) |
| 3 | High | **Screen recordings exported at ~15 fps.** Screen capture is variable frame rate (frames only when the screen changes); the server used the probed average (15.39 fps) instead of the 30 fps the recording and preview use, so zooms and rings stuttered | Client sends the capture rate for recordings (`fps` in the export spec); backend accepts it when 1–60. Older clients/backends unaffected (field ignored / optional). Verified: export is 30 fps |
| 4 | High (performance) | **Click rings made exports ~6× slower** (an 81 s video took 238 s to render). The ring sprite was resized every frame while growing, which made ffmpeg reconfigure the overlay each time (~0.5 s each) | Fixed-size sprite, growth done inside the opacity pass, and both the opacity pass and the overlay only run while a ring is visible. Same effects now render in 38 s (benchmark) |
| 5 | High (data loss) | **Saved projects silently expired after 7 days**, after which the next edit overwrote them | No expiry in the desktop app (website keeps 7 days) |
| 6 | High (data loss) | **Opening a video while a saved project was waiting replaced it without asking**; the landing page's Discard deleted it without asking | Confirmation before replacing an open or saved project (once — the recorder already asks about an open one); Discard asks |
| 7 | Medium | Projects that couldn't be restored (video not stored, unreadable record) silently vanished; failure to store a video for recovery was silent | Clear message on the landing page; a warning when a video can't be stored for recovery ("export before you close") |
| 8 | Medium | No project format version | Stored record carries `formatVersion` (1). Older records load as version 1; a record from a newer app is reported, never guessed at. Verified: a pre-versioning project opened after the upgrade |
| 9 | Low | Screenshot during recording could miss the manifest: `grabFrame()` can wait indefinitely on a still screen, and Stop didn't wait for a screenshot in progress | 1.5 s timeout with a fallback frame source; Stop waits (max 5 s) for screenshots in flight |
| 10 | Low | Desktop app said "Editing happens in your browser" and "Keep this tab open" | Desktop wording |
| 11 | Low (testing) | Release builds couldn't be pointed at a local stack for end-to-end testing | `WIPECLIP_LOCAL_TEST_BUILD=1` allows `http://localhost` APIs in a release build (prints a warning; never ship such a build) |

Earlier in this branch (Phases 2–3): edge-of-frame zoom framing in portrait/square fill, zoom editing and suggestion merging, per-source clipping detection, cancellable review analysis.

## Windows build and test results (verified)

Build: `npm run desktop:build` (Rust release in ~2.5–3.5 min, Next static export, secret scan, NSIS). Installer `src-tauri/target/release/bundle/nsis/WipeClip_0.1.0_x64-setup.exe`, 6.68 MB, per-user install to `%LOCALAPPDATA%\WipeClip` (no admin).

| Step | Result |
|---|---|
| Install (silent `/S`) | Exit 0; `wipeclip.exe` + `uninstall.exe`; Apps entry "WipeClip 0.1.0, WipeClip" |
| Startup | Window opens on `http://tauri.localhost/`; log "WipeClip 0.1.0 starting" |
| Record entire screen + system audio, real mouse clicks (only inside WipeClip's own window), marker, screenshot, pause/resume | Manifest `complete`; video 81.51 s, system audio 81.49 s, manifest 81.55 s (sync within 60 ms); pause excluded and no events recorded while paused; clicks at exactly x/1920, y/1080 on a 125% display; screenshot PNG listed |
| Open in editor | Clip + System audio track + Zoom track; Focus panel sees 4 clicks |
| Analyze and suggest zooms | 4 zooms, one per deliberate click; one stops at the pause cut, one is clipped to the end |
| Preview framing | Video crop matches the zoom window exactly (1.8× → 44.444% insets, edge clamping) |
| Edit zoom strength, Undo, Redo | 1.8× → 2.4× → 1.8× → 2.4× |
| Captions (local Whisper) | Asks before the 80 MB download; download ~25 s; 14.8 s of speech transcribed in ~60 s, 11 captions, word-perfect |
| SRT export via native Save dialog | File written with correct timings |
| Privacy mask (blur), arrow, insert recording screenshot | All on the timeline; screenshot placed at the moment it was taken |
| Save → close → reopen (also after upgrade and after uninstall + reinstall) | "Continue where you left off?" → everything restored, including click data |
| Native confirm dialogs (new project, replace project) | Correct text and buttons; Cancel keeps the project |
| Export (signed out → 720p free preview) | Valid MP4 (H.264 + AAC), 1280×720, **30 fps**, 81.50 s, decodes without errors. Zoom matches the expected crop (mean pixel difference 1.5 vs 19.9 unzoomed); mask blurred exactly 30–35 s inside its rectangle (detail 3.6 → 0.22) and nowhere else; click rings at each click and only then |
| Free export limit | Clear message "Free export limit reached for today. Sign in for more." |
| AI Cleanup dialog | Opens with region tool, resolutions and rights confirmation. A full cleanup was run through the API by `npm run dev:smoke` (probe, 2 s cleanup in 31 s, ticket replay refused, export) |
| Close window | Process exits cleanly (exit 0), no leftover WebView2 processes |
| Upgrade (install over older build) | Exit 0, exe replaced, saved project kept |
| Uninstall (silent) | Removes program files, Apps entry, Start-menu shortcut and the `wipeclip://` handler. **Keeps** app data (`%LOCALAPPDATA%\co.wipeclip.desktop`: saved project, logs, model cache, ~159 MB here) and all recordings in `Videos\WipeClip` |

Not tested on Windows: signed-in export and download (needs an account; signed-out preview tested instead), 1080p/4K export, multiple displays, display resolution change during recording, unplugging audio devices, crash recovery of an interrupted recording, webcam, region and window capture, Windows 10. These are on the manual checklist below.

## macOS

**Not built or tested in this pass.** What exists:

- `bundle.targets` includes `app` and `dmg`; minimum macOS 11.0; hardened runtime; entitlements for microphone and camera; usage strings in `src-tauri/Info.plist`.
- `.github/workflows/desktop.yml` builds on `macos-latest` (Apple Silicon) and signs/notarizes only when the Apple secrets are set; otherwise the build is unsigned and Gatekeeper blocks it.
- Screen Recording, Input Monitoring and Accessibility permissions are requested by the recorder at runtime (see [RECORDER.md](RECORDER.md)); none of this has been exercised on a Mac.

## Performance observations

Measured on this machine (12 threads), 81.5 s 1920×1080 screen recording exported at 1280×720/30 fps, export graph timed directly:

| | Before | After |
|---|---|---|
| Plain | 13.5 s | 13.5 s |
| + zoom camera | 24 s | 24 s |
| + click rings | 183 s | 24 s |
| + blur mask | 24 s | 24 s |
| All effects | 238 s | 38 s |
| In the app, all effects + audio (render + upload + client prep) | 262 s | 134 s (job 121 s) |

- Remaining cost: with an audio track, the effect graph runs about twice as long (121 s vs ~54 s without audio, same plan; a plain export with audio costs nothing extra). Likely ffmpeg's scheduling of one graph feeding both outputs; rendering the audio in a separate pass is the next optimization.
- Recording: one 1 s chunk to disk per track, fsync every 5 chunks; 81 s recording = 1.3 MB video + 1.1 MB audio at "Smaller file" quality; 23 interaction events (only on change).
- Local analysis: focus suggestions for 16k events in tens of ms; 30 min of audio analyzed in ~150 ms.
- Export holds the finished video in memory before writing (`saveExportFile` → `write_export`); fine at the 10-minute export cap, but worth streaming if the cap is raised.
- Projects copy their source videos into the app's storage (IndexedDB) for recovery, doubling disk use per project (capped by the 300 MB import limit).

## Security and privacy

- Recordings, projects, captions and analysis stay on the device. Uploads happen only on export and AI Cleanup (as on the website), to the configured backend.
- No telemetry from the desktop app: the Vercel Analytics `track()` call only queues in memory without its script, and the static bundle contains no Sentry or analytics endpoints (checked). Sentry is website-only.
- The app log (`%LOCALAPPDATA%\co.wipeclip.desktop\logs\WipeClip.log`) holds only lifecycle lines ("recording started/finished", "input monitor started/stopped", errors, export paths) — no screen content, no keystrokes. The recorder never stores typed text (Rust `input/keys.rs` filter, tested).
- `desktop/scripts/check-bundle.mjs` scans the build for server secrets (passed every build).
- CSP generated per build from the API hosts; release builds require `https` unless `WIPECLIP_LOCAL_TEST_BUILD=1` (localhost only).

## Dependencies and licensing

- npm production dependency tree (183 packages): MIT, Apache-2.0, BSD, ISC, BlueOak, 0BSD, CC0, CC-BY-4.0 (`caniuse-lite`, attribution). `@sentry/cli` is FSL-1.1-MIT but is a website build tool, not shipped in the desktop app.
- Rust crates (~490): MIT/Apache-2.0 dual-licensed in the vast majority; Unicode-3.0, Zlib, Unlicense, BSD-3-Clause; MPL-2.0 (5 crates, file-level copyleft — fine to ship unmodified with notice).
- Speech model: Whisper base (OpenAI, MIT), ONNX conversion from Hugging Face `onnx-community`, downloaded on first use only after the user agrees.
- The processing backend uses ffmpeg through `imageio-ffmpeg` (a GPL build) on the server; it isn't distributed with the desktop app.
- Include third-party notices (npm + cargo) in the installer/about screen before release — not done yet.

## Packaging and distribution

```bash
# Release (production APIs; https required)
cp desktop/.env.example desktop/.env.production.local   # fill in public values only
npm ci
npm run desktop:build
# Windows: src-tauri/target/release/bundle/nsis/WipeClip_<version>_x64-setup.exe
# macOS (on a Mac or CI): src-tauri/target/release/bundle/dmg/*.dmg

# Local end-to-end test build against `npm run dev` (never distribute)
WIPECLIP_LOCAL_TEST_BUILD=1 NEXT_PUBLIC_DESKTOP_SITE_ORIGIN=http://localhost:3000 \
NEXT_PUBLIC_TOOLS_API_URL=http://localhost:8002 \
NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... npm run desktop:build
```

- Windows: per-user NSIS install, no admin; WebView2 bootstrapper downloaded if missing; Windows 10 21H2+ / 11 (WebView2 preinstalled). Silent: `/S`. Uninstaller keeps app data and recordings when run silently; the interactive uninstaller offers to delete app data.
- macOS: `.app` / `.dmg`, macOS 11+, needs signing + notarization for Gatekeeper.
- Upgrades: install the new build over the old one; projects and settings survive.
- The version is `0.1.0` in `tauri.conf.json` and `package.json`; bump both per release.
- `src-tauri/tauri.generated.conf.json` is rewritten by every build (CSP); after a local test build it names localhost — run a release build before shipping.

## Required permissions

| | Windows | macOS |
|---|---|---|
| Screen capture | System picker per recording (WebView2) | Screen Recording (System Settings) |
| System audio | "Share system audio" in the picker (entire screen) | Not available in WKWebView |
| Microphone / camera | Windows privacy settings | Microphone / Camera prompts (usage strings set) |
| Mouse and keyboard metadata | No prompt (low-level hooks) | Input Monitoring / Accessibility |
| Files | Recordings in `Videos\WipeClip` (changeable); exports via the Save dialog | Same, via macOS dialogs |
| Network | Website (accounts, credits, tickets), processing backend, Supabase, Hugging Face (model, once) | Same |

## Known limitations

- Exports and AI Cleanup need the network and the backend; recording, editing, analysis and captions work offline (after the model is downloaded).
- Imports up to 300 MB / 10 minutes; recordings above that size can't be opened in the editor (the recorder shows the limit).
- Windows always records the system cursor (WebView2), so the drawn smooth cursor is unavailable; click highlights work.
- Export with audio runs ~2× slower than the same graph without (see Performance).
- Captions are uppercased by the default caption style and SRT/VTT take the styled text.
- See [FOCUS.md](FOCUS.md), [TUTORIAL.md](TUTORIAL.md) and [RECORDER.md](RECORDER.md) for feature-level limitations.

## Remaining release blockers (prioritized)

1. **Deploy the backend fixes before or with the desktop release.** Without them exports silently omit privacy masks and click highlights, show rings early, and render recordings at their average frame rate. (Bugs 1–4 are server-side.)
2. **Code signing.** Windows installer is unsigned (SmartScreen "unknown publisher"); macOS needs Developer ID signing + notarization (CI secrets).
3. **macOS build and full manual pass** on a real Mac (permissions, system audio absence, Retina coordinates, export, uninstall).
4. **Signed-in production test**: export and download at 1080p, credits, Google sign-in deep link `wipeclip://auth/callback` (Supabase redirect URL must be configured).
5. **Third-party notices** in the app/installer.

Recommended before a wide release: crash/interrupted-recording recovery and device-unplug tests (checklist 10), multiple displays, a 9-minute recording export, audio-pass split for export speed.

## Manual test checklist (both platforms)

Tick with OS version and date. Windows results from this pass are noted.

1. Install from the installer; app starts; About/version correct. *(Win 11: ✓)*
2. Recorder: entire screen, window, area; system audio (Windows); microphone; webcam. *(Win 11: entire screen + system audio ✓; others not run)*
3. Record 30 s with clicks, a marker, a screenshot, pause/resume; stop; folder has video, audio, events, screenshot, manifest `complete`. *(✓)*
4. Kill the app during a recording; reopen; Recover; it plays. *(not run)*
5. Unplug the microphone during recording: warning, recording continues. *(not run)*
6. Second display; change display resolution mid-recording (auto-stop with reason). *(not run)*
7. Open in editor; Analyze zooms; edit one; undo/redo; preview plays the zoom. *(✓)*
8. Captions: download consent, generate, edit one, export SRT. *(✓)*
9. Privacy mask, arrow, screenshot insert; play through. *(✓)*
10. Close app; reopen; Resume; everything there. Discard asks first. *(✓)*
11. Export signed out (720p) and signed in (1080p); open the file in the system player; check zoom, rings, mask, captions, audio sync, 30 fps. *(signed out ✓; signed in not run)*
12. AI Cleanup on a short clip. *(API ✓ via dev:smoke; in-app run not done)*
13. Upgrade install over the previous version; project kept. *(✓)*
14. Uninstall; recordings kept; reinstall; project kept. *(✓)*
15. macOS only: deny then grant Screen Recording, Microphone, Camera, Input Monitoring; each shows a clear message. *(not run)*

## How this was tested

The installed app was started with WebView2's DevTools port (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`) and driven with the helpers in `tests/desktop/manual/` (`cdp.mjs`, `desktop-recording.mjs`) plus Windows UI Automation for the native dialogs. Real mouse clicks were made only after checking that the point under the cursor belonged to WipeClip's own window. Exports were pulled from the app and checked with ffmpeg (probe, full decode) and frame-by-frame comparison against the source recording.
