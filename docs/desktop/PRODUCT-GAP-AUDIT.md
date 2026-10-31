# Product and engineering gap audit (Phase 0)

WipeClip desktop, 29 October 2026, branch `feat/recorder-hardening` (0 commits ahead of `master`; 31 modified and 25 untracked files, +1478/−146 lines, all uncommitted). No application code was changed for this audit. Nothing was built, signed, published or uploaded.

**Bottom line.** The product is far more complete than a typical pre-beta: recording, the editor, the automatic editing tools and local export are implemented, tested and, for most paths, run in the real app. This audit found nothing that is only UI or mocked. What blocks a release is mostly outside the features:

- There is no installer built from this code.
- The Rust toolchain on this machine is broken, so no Rust code can be compiled or tested.
- Two privacy and policy problems in user-visible output were found, one of them new in this audit.
- Export memory grows with the number of cuts.
- On desktop, plan limits for local exports are enforced only by the client.

Status labels in this report:

| Label | Meaning |
|---|---|
| **Verified (app)** | Run in the real desktop app (debug build of the current code). Unless marked "this audit", this was in Phase 7 earlier today ([RELEASE-VALIDATION.md](RELEASE-VALIDATION.md)) and not repeated |
| **Verified (headless)** | The real editor in headless Chrome, without the native side |
| **Automated** | Unit or integration tests, run in this audit (section 9) |
| **Untested** | Code exists; no runtime evidence |
| **Partial** | Works with a documented gap |
| **UI-only / mock** | Shows in the UI but does nothing real |
| **Broken** | Doesn't work as intended |
| **Missing** | Not implemented |

## 1. Feature matrix

### Recording (native shell, `src-tauri/src/capture`, `src/lib/recorder`)

| Feature | Status | Evidence |
|---|---|---|
| Full-screen capture, Windows | Verified (app) | `capture/video.rs` (Windows.Graphics.Capture, D3D11 video processor to NV12, Media Foundation H.264, fragmented MP4). Phase 7: 690 frames in 22.976 s, 0 dropped |
| System audio, Windows | Verified (app) | `capture/audio.rs` (WASAPI loopback) as a separate `system-audio.m4a` |
| Microphone | Verified (app), fake device only | `session.ts` uses `getUserMedia` and `MediaRecorder` into `microphone.m4a`. Sync with a real microphone (clap test): **untested** |
| Window and area capture | Untested | `capture/sources.rs`, `capture_sources`/`capture_thumbnail` commands; unit tests only |
| Webcam track | Untested | `session.ts` webcam track; no runtime pass |
| Pause/resume, markers, screenshots | Verified (app) | `capture_pause`, `recording_append`; no pointer events while paused |
| Capture clock and event sync | Verified (app) + automated | `capture/clock.rs`, `video_sync_test.rs` (new, live tests `#[ignore]`d), `src/lib/recorder/clock.ts`. Cursor probes matched `events.jsonl` in Phase 7 |
| Input events (mouse, clicks, scroll, shortcuts, typing activity, active window) | Verified (app) + automated | `input/windows.rs` (low-level hooks), `input/keys.rs` keeps only shortcut names, never typed text (Rust tests `keys::*`) |
| Input events, macOS | Untested | `input/macos.rs` (listen-only CGEventTap); never compiled on a Mac |
| Crash recovery of a recording | Verified (app) | `recording/mod.rs` manifest plus fragmented MP4. Phase 7: hard kill, relaunch, Recover, all 3 tracks decode |
| Permission denied / missing device | Verified (app) | `src/lib/recorder/mediaErrors.ts`, `tests/desktop/manual/media-errors.mjs` 4/4 |
| Free disk space check | Automated | `recording_storage`, `recorder.test.ts` |
| Recorder hotkeys and mini player | Partial | `shortcuts.rs` (global shortcuts, Rust only), `MiniPlayer.tsx` with its own capability `mini.json`. Mini player used in Phase 7; hotkeys not exercised separately |
| macOS screen capture | Partial, untested | `capture_support()` returns `supported: false` on every non-Windows OS (`capture/mod.rs:164-171`). The recorder falls back to WebView `getDisplayMedia` (`ScreenRecorder.tsx:334`) and states that macOS below 13 can't record (`:993`) |
| macOS system audio | **Missing** | `ScreenRecorder.tsx:385`: "System audio can't be captured on macOS with this recorder" |

### Projects and editing (`src/lib/editor`, `src/components/editor`)

| Feature | Status | Evidence |
|---|---|---|
| Projects in IndexedDB, autosave | Automated + Verified (app) | `projectStore.ts`; autosave in `VideoEditor.tsx:380-387` (`pendingSave`); `projects.test.ts` |
| `.wipeclip` project files (save, open, double-click) | Automated + Verified (app) | `projectFile.ts`, `zip.ts`, `opened.rs` (file association in `tauri.conf.json`); files are validated as untrusted (tests) |
| Undo/redo | Automated | `history.ts`: 200 steps, a drag recorded as one step (`beginGesture`). Draft apply as one step verified (headless) |
| Missing media, relink | Partial, Verified (app) | Native "Video not found" prompt. D2: each track of a moved recording is asked for separately |
| Timeline: trim, split, ripple, speed, transitions, keyframes | Automated + earlier (app) | `timeline.ts`, `ripple.ts`, `speed.ts`, `keyframes.ts`; backend renders in `test_editor_layers.py` |
| Text, stickers, shapes, images (annotations) | Automated + earlier (app) | `textRaster.ts`, `stickers.ts`, `shapes.ts`, `OverlayLayer.tsx`; backend re-encodes every overlay PNG |
| Color: filters, curves, LUTs, chroma key | Automated | `look.ts`, `curves.ts`, `lut.ts`, `chromaKey.ts`; backend validates them (`main.py` `api_video_export`) |
| Privacy masks (blur, pixelate, solid; canvas, video and pointer anchored) | Automated + Verified (headless) | `masks.ts`, `MaskEditLayer.tsx`; real-ffmpeg renders in `test_privacy_export.py`. A mask present in **every exported frame** of a real recording: not checked in the app |
| Focus zooms, click rings, drawn cursor | Verified (headless); earlier (app, 16 Oct) | `focus.ts`, `focusExport.ts`, `pointerDraw.ts`, `focusPrefs.ts`; `preview-focus.mjs`; `test_focus_export.py` |
| Pause/silence/dead-time review, automatic cuts | Verified (headless) | `useTutorialTools.tsx`, `audioAnalysis.ts`, `insights.ts`; `preview-tutorial.mjs` |
| Draft assistant (cuts, zooms, chapters) | Verified (headless) | `draft.ts` (deterministic and rule-based, as the file says); `preview-draft.mjs`; `draft.test.ts` |
| Chapters | Automated | `chapters.ts`; part of the draft |
| Highlights | Verified (headless), partial | `highlights.ts`, `screenActivity.ts`, backend `pipeline/activity.py` (`test_activity.py`). Picture signals in the app and an exported highlight file: **untested** |
| Creator presets / reframing | Verified (headless), **policy defect** | `creatorPresets.ts`. Labels name third-party platforms (P0-4) |
| Auto captions (local Whisper), SRT/VTT | Earlier (app, 16 Oct) | `captions.ts`, `captions.worker.ts` (Transformers.js; model downloaded from Hugging Face after consent) |
| Transcript editing (delete words to cut, filler removal) | Automated | `wordEdit.ts` (one undo step), `TranscriptPanel.tsx`, `wordEdit.test.ts` |
| Audio cleanup (denoise, loudness) | Automated | backend `pipeline/audio_clean.py` (`afftdn` with a measured noise floor, about -16 LUFS); `test_audio_clean.py`. Not run in the app |
| Ducking, voice effects, voiceover, beats, SFX | Automated | `ducking.ts`, `voiceFx.ts`, `voiceover.ts`, `beats.ts`, `sfx.ts` |
| AI object cleanup (inpainting) | Earlier (API via `dev:smoke`) | `AiCleanupDialog.tsx`, `processVideo` in `toolsApi.ts` (local engine on paid plans, cloud on free) |

### Export and the local engine

| Feature | Status | Evidence |
|---|---|---|
| Local engine start, token auth | Verified (app) | `engine.rs` (127.0.0.1, free port, 64-hex token, health check), `main.py:147-157` (`hmac.compare_digest`, 403) |
| Export authorization (plan, resolution, free-tier mark) | Partial: **client-enforced on desktop** | The site signs tickets with HMAC (`src/lib/jobTicket.ts`, `INTERNAL_API_SECRET`). `engine.rs` removes that secret from the engine's environment, so `tickets.verify` (`backend/app/tickets.py:52-57`) skips the signature check and accepts **any** well-formed ticket. `claim` is also a no-op locally (no `SITE_URL`). See P1-1 |
| Export render (NVENC, libx264 fallback) | Automated | `pipeline/encoders.py`, `editor.py:1553-1594`; `test_encoders.py`, `test_editor_layers.py` (real ffmpeg) |
| Output validation | Automated | `encoders.validate_output` (duration, size, streams, fps) after every render |
| Cancellation | Automated | `progress.py` (`cancel` event), `_run_ffmpeg(..., cancel=job.cancel)`, `ExportDialog.tsx` `AbortController`; `test_export_progress.py` |
| Disk-full handling | Automated | `main.py` returns 507 `disk_full` with free/needed space |
| Export from the app, signed in | **Untested this phase** | Needs the website for the ticket; Phase 7 didn't run it either |
| Large timelines | **Broken at scale (B2)** | About 200 MB per clip because each clip has its own decoder; a 40-cut, 10-minute project peaked at 8.3 GB (`backend/bench/export_bench.py`, Phase 6) |

### Account, updates, packaging

| Feature | Status | Evidence |
|---|---|---|
| Website sign-in (deep link, PKCE) | Earlier (app) | `wipeclip://auth/callback` (`platform/env.ts`), `tauri-plugin-deep-link`, single instance |
| Session storage in the OS credential store | Automated | `secure_storage.rs`: only Supabase auth keys accepted, chunked for the 2560-byte Windows limit |
| Plan checks | Automated (site) | `src/app/api/export/route.ts` (`canExportAt`, `plan_required`) |
| Updater | Untested | `updater.rs` (minisign, Rust-only commands, refused while recording); never run against a real release |
| CSP | Automated (generated per build) | `desktop/scripts/tauri.mjs` builds `connect-src` from env and rejects non-https in release; `'unsafe-eval'` only in dev |
| Third-party notices | **Unverified** | `desktop/scripts/notices.mjs`; its test fails because `rustc` is missing |
| Windows installer (NSIS, per user) | **Not built from this branch** | Last installer is from 23 Oct, version 0.1.0; code is 0.1.2 |
| macOS DMG, signing, notarization | Missing (never built) | CI steps exist in `.github/workflows/desktop.yml` (macos-latest, Apple secrets), never run |
| Code signing, Windows | Missing | Unsigned; SmartScreen warns |
| Diagnostics export for testers (B3) | Missing | No "send diagnostics" command in `lib.rs` |
| Uninstall "remove my data" option | Missing | Recordings and projects are kept; only documented |

**UI-only / mock:** none found. Every panel checked calls real code paths with tests behind them.

**Doc claims contradicted by code:**

1. RELEASE-VALIDATION section 5 says "Engine logs hold no paths". That's wrong: see P0-3.
2. RELEASE-VALIDATION section 3 says the Rust tests run from prebuilt binaries via `npm run desktop:test`. Today `cargo` can't start at all (exit 101, `rustc -vV`). Only running the prebuilt test executable directly works (section 9).

## 2. Evidence notes for the main findings

**Desktop export tickets are not verified (P1-1).** The tickets are HMAC-signed with a server secret, and a desktop install can't hold that secret. The engine therefore runs without `INTERNAL_API_SECRET` (`engine.rs:137`, `env_remove`), and `tickets.verify` only checks the signature `if secret:`. Anyone who reads the per-launch token (from the engine's environment, as the same OS user) can post a hand-made ticket with `resolution: "4k"` and `branding: false`. The local engine has to work offline from the site, so this can't be fully closed; it can be made much harder (section 8, Phase 3).

**The engine writes file paths into the app log (P0-3).**

- `_run_ffmpeg` raises `RuntimeError(f"ffmpeg failed …: {tail}")` with the last 2000 bytes of ffmpeg's stderr (`pipeline/video.py:243-244`). That stderr names the input and output files.
- `main.py` prints the full traceback (`traceback.print_exc()`) in seven handlers, including audio cleanup (`:407`) and export (`:1446`), both reachable in local mode.
- `engine.rs` `forward_logs` copies every engine stdout/stderr line into `WipeClip.log`.
- In a packaged build the traceback frames themselves carry the install path under `C:\Users\<name>\AppData\Local\…`.

D1 (Rust-side `path.display()` in `media.rs:106`, `export.rs:114,117`, `opened.rs:70,110`) is still open as described.

**Platform names in the UI (P0-4).** `creatorPresets.ts:21-25` shows the labels "YouTube" and "Shorts · Reels · TikTok", and `docs/desktop/CREATOR.md` and `BETA-READINESS.md` repeat them. This breaks the rule set for the payment-provider review: describe formats as landscape, vertical, square or portrait, and name no third-party platforms.

## 3. Prioritized gaps

### P0: release blockers (private Windows beta)

| ID | Gap | Why it blocks |
|---|---|---|
| P0-1 | Rust toolchain broken (D0); no installer from this branch | Nothing testers could install exists. Alternative to repairing locally: `desktop.yml` builds on GitHub's Windows runners (needs a push; your call) |
| P0-2 | Phase 5–6 work uncommitted | A beta build can't be reproduced; work could be lost |
| P0-3 | File paths in logs, from Rust (D1) and from the engine (new) | Testers send logs; those leak user names and file names |
| P0-4 | Third-party platform names in preset labels and docs | Breaks the payment-provider review rule |
| P0-5 | Export memory per clip (B2) | Machines with 8 GB fail or swap on ordinary cut-heavy tutorials |
| P0-6 | No diagnostics export (B3) | Beta bugs can't be triaged without asking testers to dig through `%LOCALAPPDATA%` |

### P1: important gaps

| ID | Gap |
|---|---|
| P1-1 | Desktop export authorization is client-enforced (section 2) |
| P1-2 | Windows code signing (SmartScreen warning drives installs away) |
| P1-3 | Updater never exercised end to end, including a failed update |
| P1-4 | Signed-in in-app export never run on the current code |
| P1-5 | CI: backend `pytest` not run (only `compileall` and import in `ci.yml`); desktop tests and the `-p desktop` type check run only on manual or tag builds (`desktop.yml`), not on pull requests |
| P1-6 | Real-hardware gaps: microphone sync, window/area capture, webcam, 1440p/60 fps CPU, 8 GB and non-NVIDIA machines |
| P1-7 | Engine port race: `engine.rs` binds port 0, releases it, then starts the engine on it; another process can take it in between (rare; startup then fails with a timeout) |
| P1-8 | `localhost:3100` in the engine's allowed origins in release (D4) |

### P2: improvements

- Relink all tracks of a moved recording at once (D2).
- Uninstall option to remove app data.
- Keyboard trimming and a screen-reader pass.
- Intel Quick Sync and AMD encoders.
- Splitting the audio pass to speed up export.
- Land in the editor after Recover (D3).

### P3: future ideas

- macOS native capture with ScreenCaptureKit, including system audio.
- Windows on ARM build.
- Opt-in crash reporting.
- Model-driven editing. It doesn't exist today, and nothing should claim it does.

## 4. Windows 11 release-readiness checklist

| # | Check | State |
|---|---|---|
| 1 | Rust toolchain repaired; `npm run desktop:test` and `desktop:test:js` fully green | Open (P0-1) |
| 2 | Phase 5–6 work committed; build from a clean checkout | Open (P0-2) |
| 3 | Release installer built with the engine (`WIPECLIP_REQUIRE_ENGINE=1`) and notices | Open |
| 4 | Install on a clean Windows 11 (no dev tools, no Python), first launch, WebView2 bootstrap | Open |
| 5 | Packaged engine cold start and memory measured | Open |
| 6 | Record 30 s screen + system audio + real microphone; clap sync within 1 frame | Partial (fake microphone only) |
| 7 | Window and area capture, webcam | Open |
| 8 | Sign in through the browser, export 720p and 1080p, check the free-tier mark | Open (P1-4) |
| 9 | Crash recovery and missing-media relink on the release build | Done on debug build only |
| 10 | Log contains no `C:\Users\` after record, import, export and a failed export | Open (P0-3) |
| 11 | Diagnostics zip produced and readable | Open (P0-6) |
| 12 | 40-cut 10-minute export under the agreed memory ceiling on an 8 GB machine | Open (P0-5) |
| 13 | Update from the previous version, and a failed update leaves a working install | Open (P1-3) |
| 14 | Uninstall keeps recordings, as documented | Done (Oct build only) |
| 15 | Code signed, or the SmartScreen step explained in the beta notes | Open (P1-2) |
| 16 | UI and docs free of third-party platform names | Open (P0-4) |
| 17 | RELEASE.md checklist 1–14 passed on the release build | Open |

## 5. macOS port: feasibility and requirements

**State.** The editor, engine, sign-in, credential store (Keychain via `keyring`), input monitor (`input/macos.rs`), DMG config (hardened runtime, `Entitlements.plist`, microphone and camera usage strings) and the CI job (`macos-latest`, signing and notarization steps, PyInstaller signing) exist. None of it has been compiled or run on a Mac.

**Recorder gap.** Native capture is Windows-only. On macOS the recorder uses WebView `getDisplayMedia`:

- no system audio;
- no recording below macOS 13 (`ScreenRecorder.tsx:993`);
- none of the native features: frame-accurate clock, pointer-free capture, fragmented-MP4 crash safety for the screen track.

**Feasible path.**

1. **Build the editor only.** Run the `desktop.yml` macOS job (unsigned) to prove it compiles. No Mac needed. It needs a push to GitHub, which is your call.
2. **Manual pass on a real Mac (13+ on Apple Silicon, plus one Intel machine if supported):**
   - editor, engine and export;
   - sign-in deep link;
   - Input Monitoring and Screen Recording permission prompts.
3. **Native capture with ScreenCaptureKit.** It captures video on macOS 12.3+ and system audio on 13+, writing H.264 through AVAssetWriter. This is a new `capture/macos.rs` behind the same commands as `capture/video.rs`, so `capture_support()` stops returning `false`. Roughly the size of the Windows capture module (about 1400 lines of Rust plus Objective-C bindings).
4. **Distribution.** It needs:
   - an Apple Developer ID;
   - notarization of the app, the PyInstaller engine and its ffmpeg;
   - a decision on Intel support (`minimumSystemVersion` is 11.0, but recording needs 13).

**Complexity.** Steps 1–2 are small to medium and need Mac access. Step 3 is large. Step 4 is medium and needs a paid Apple account.

## 6. Performance and memory risks

| Risk | Evidence | Severity |
|---|---|---|
| Export memory about 200 MB per clip | Phase 6 bench: 8.3 GB peak at 40 cuts | High (P0-5) |
| Captions decode the whole file in memory | `captions.ts`: `MAX_DECODE_BYTES = 400 MB` (`decodeAudioData` keeps everything) | Medium; long recordings are refused or slow on 8 GB |
| WebView memory | About 520 MB working set idle after a recording (Phase 7) | Medium on 8 GB |
| Engine memory | 485 MB private (venv); packaged build not measured. Mitigated: started on first use, exits after 300 s idle, below-normal priority, leaves one core free (`desktop_engine.py`) | Low to medium |
| Large editor components | `VideoEditor.tsx` 3158 lines, `Panels.tsx` 2280; responsiveness with hundreds of clips not measured | Medium (unknown) |
| Recording at 1440p/4K or 60 fps | Not measured; 1080p30 recordings of up to 600 s had 0 dropped frames | Unknown |
| Undo history | 200 full `Project` snapshots (`history.ts`); structural sharing keeps this small unless a large field changes every step | Low |

## 7. Security, privacy and licensing risks

| Area | Finding | Risk |
|---|---|---|
| Typed text | Never recorded (`keys.rs`, Rust tests) | Low |
| Logs | File paths from Rust (D1) and engine tracebacks or ffmpeg stderr (new) | **High (P0-3)** |
| Local engine | 127.0.0.1, per-launch token, constant-time compare, token checked before any route (preflights excepted); `localhost:3100` origin in release (D4); port race (P1-7) | Low |
| Export authorization | Unsigned tickets accepted locally (P1-1) | Medium (revenue, not user safety) |
| IPC surface | No fs, shell or opener plugin APIs exposed; small capability files (`main.json`, `mini.json`); remote pages have no IPC | Low |
| Credential storage | OS store, key allow-list (`secure_storage.rs`) | Low |
| CSP | Generated per build; https only in release | Low |
| Asset protocol | Static scope empty, paths approved one by one (`media.rs`) | Low |
| Updates | minisign-signed; key holder must protect `TAURI_SIGNING_PRIVATE_KEY` | Low (process) |
| ffmpeg licensing | GPL-3.0 build with libx264/libx265, shipped as a separate program. The source offer relies on third-party sites, which GPLv3 §6 doesn't allow unless availability is ensured. H.264/HEVC encoder patent exposure | **Needs legal review** before a public release |
| Whisper and Transformers.js | MIT and Apache-2.0; model files fetched after consent | Low |
| Notices | Generated per build; generator test can't run without `rustc` | Medium until verified |
| Payment-provider review | Platform names in preset labels and docs (P0-4) | High (business) |

## 8. Recommended phase order

| Phase | Scope | Acceptance criteria | Complexity | Needs from you |
|---|---|---|---|---|
| **1. Build baseline** | Repair `rustc` (or build in CI); commit Phase 5–6 in reviewed commits; all suites green | `npm run desktop:test` and `desktop:test:js` 0 failures; clean-checkout `desktop:build` produces an installer | Small | Approve the rustup repair and the commits |
| **2. Privacy and policy fixes** | D1 (Rust paths), engine path scrubbing (log error kinds only, no stderr tail or traceback in local mode), D4, platform-name removal in UI and docs, diagnostics zip (B3) | Fresh log after import, export, a failed export and audio cleanup contains no `\Users\` or file names (test); no platform names in `src/` or `docs/desktop/` (grep test); zip produced | Medium | None |
| **3. Export authorization hardening** | Sign desktop tickets with an asymmetric key (Ed25519); embed the public key in the engine; verify in `tickets.verify` when `LOCAL_MODE` | Engine rejects unsigned or altered tickets (tests); site still issues tickets the cloud backend accepts | Medium | Agree the approach; generate the key pair |
| **4. Export memory (B2)** | Segmented rendering (groups of clips, joined with the concat demuxer), or decoder reuse per source | 40-cut 10-minute bench under 2 GB peak with identical output (SSIM ≥ 0.99, A/V offset ≤ 1 frame) | Large | Approve the export-graph rewrite |
| **5. Windows release candidate** | Section 4 checklist on a clean Windows 11 machine, plus an 8 GB and a non-NVIDIA machine | All checklist items pass or are documented | Medium | Hardware; code-signing certificate decision |
| **6. CI hardening** | Backend pytest and desktop tests on pull requests | PR runs fail on a broken test | Small | None |
| **7. macOS** | Steps 1–4 of section 5 | macOS editor build runs; ScreenCaptureKit recorder passes the Windows recording tests | Large | Mac hardware, Apple Developer account |

## 9. Tests

### Executed in this audit (29 Oct 2026, this machine: Windows 11 Pro 10.0.26200)

| Suite | Command | Result |
|---|---|---|
| Desktop JS | `npm run desktop:test:js` | 167 pass, **2 fail** (169 total, 11.5 s). Both failures are `notices.test.mjs`: "Command failed: rustc -vV … the 'rustc.exe' binary … is not applicable to the 'stable-x86_64-pc-windows-msvc' toolchain" |
| Rust via cargo | `npm run desktop:test` | **Fails to start**, exit 101, same `rustc -vV` error |
| Rust, prebuilt binary | `src-tauri/target/debug/deps/wipeclip_lib-a1f6bc2c5ce2ded6.exe` (built 29 Oct 09:49, after the last Rust source change at 28 Oct 23:23) | 29 passed, 0 failed, 6 ignored (live capture tests) |
| Backend | `backend/.venv/Scripts/python -m pytest -q` | 75 passed, 7 subtests passed, 1 warning, 60.4 s (real ffmpeg) |
| Types | `npx tsc --noEmit -p .` and `-p desktop` | Both pass (exit 0) |
| Lint | `npx eslint src/lib/editor src/components/editor src/components/recorder src/lib/recorder` | No findings |

Not run in this audit: the app itself, the headless editor scripts and the manual recording scripts. Their latest results are Phase 7's (earlier today), cited as "Verified (app)" or "Verified (headless)" above.

### Require real hardware or services

| Test | Needs |
|---|---|
| Release installer: install, upgrade, uninstall | `rustc` repaired or a CI build; clean Windows 11 VM or PC |
| Microphone sync (clap) | A real microphone |
| Window and area capture, webcam | A webcam; a second display ideally |
| 1440p/4K and 60 fps recording CPU, dropped frames | A 1440p+ display or high refresh rate |
| 8 GB and non-NVIDIA export and recording | Those machines |
| Signed-in export, free-tier mark, plan limits | Production or staging site and test accounts per plan |
| Updater end to end, failed update | Two signed release builds and the releases repository |
| SmartScreen behavior | A signed and an unsigned build on a clean machine |
| Any macOS item | Apple Silicon Mac (13+), Developer ID |

## 10. Recommended next phase

**Phase 1 (build baseline), then Phase 2 (privacy and policy fixes).** The evidence:

- No installer exists for the code under test.
- The Rust half of the code can't currently be compiled or tested (`cargo` exit 101).
- Every Rust fix, including D1, waits on that.
- 56 files of finished work are uncommitted.

Phase 2's fixes are small, and they're the only findings that would leak user data (log paths) or risk the payment-provider review (platform names). Phases 3 and 4 need your decisions first (ticket signing approach; export-graph rewrite).
