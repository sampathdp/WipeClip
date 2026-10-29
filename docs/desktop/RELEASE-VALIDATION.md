# Release validation (Phase 7)

WipeClip desktop, 29 October 2026, branch `feat/recorder-hardening` (no commits ahead of `master`; all Phase 5–6 work is uncommitted in the working tree). Nothing was signed, published, uploaded or released.

**Verdict: NOT READY FOR BETA.** The editing, recording and recovery paths work in the running app, but the build testers would install has never been made. The last installer (`WipeClip_0.1.0_x64-setup.exe`, 23 Oct) predates most of this branch. This machine can't build a new one: `rustc.exe` is missing from the Rust toolchain. Once the four blockers in [section 9](#9-release-blockers-vs-non-blocking) are cleared, a **Windows-only, invited private beta** is supportable. macOS has never been built.

Wording used below:

- **Verified (app)**: run today in the real desktop app (debug build of the current Rust code, current frontend, local engine) on the machine below.
- **Verified (headless)**: the real editor in headless Chrome against the desktop frontend, without the native side or the engine.
- **Automated**: unit or integration tests, run today.
- **Earlier**: verified in an earlier phase (date given) and not repeated today.
- **Not run**: no evidence.

Machine: Windows 11 Pro 10.0.26200, Intel i7-9750H (6 cores, 12 threads), 15.9 GB RAM, GeForce GTX 1650 + UHD 630, one 1920×1080 display at 125 %. Node 22.23.3, cargo 1.99 (see the limitation below), Python venv in `backend/.venv`.

## 1. Initial audit (before any change)

**Repository.** Branch `feat/recorder-hardening`, 31 modified and 24 untracked files (Phase 5–6: draft assistant, highlights, creator presets, focus preferences, export encoders, recorder hardening). `Wipeclip Password/` at the repository root is ignored by `.gitignore` and not tracked (checked with `git ls-files`).

**Architecture.** Tauri 2 shell (`src-tauri/`) around a static export of the website's editor (`desktop/`, shares `src/`). Native Windows capture: Windows.Graphics.Capture + Media Foundation H.264 into fragmented MP4, WASAPI loopback. Microphone and webcam use `getUserMedia`/`MediaRecorder`. Input monitor: low-level hooks (Windows) and CGEventTap (macOS). Processing runs in a local engine: the FastAPI backend packaged with PyInstaller, on 127.0.0.1 with a per-launch token, using ffmpeg from `imageio-ffmpeg`. Projects are stored in IndexedDB. Videos stay on disk and are streamed through the asset protocol to approved paths only. Updater: minisign-signed manifests from a public GitHub releases repository.

**Environment limitation found.** `~/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/rustc.exe` is missing, while its `.pdb` and `rustc_driver` DLL are present and rustup still lists the component as installed. Effects:

- `cargo test` runs only because the test binaries were already built.
- No Rust code can be compiled, so there is no installer and no release build.
- `tests/desktop/notices.test.mjs` fails, because it calls `rustc -vV`.

Repair (not done, since it changes the machine's toolchain): `rustup component remove rustc --toolchain stable-x86_64-pc-windows-msvc` then `rustup component add rustc --toolchain stable-x86_64-pc-windows-msvc`. Antivirus quarantine is one possible cause; Defender's history wasn't readable from this session.

**Way around it for runtime testing.** `src-tauri/target/debug/wipeclip.exe` (built 28 Oct 23:35) is newer than every file in `src-tauri/src`, so its native code is the current code. A debug build loads its UI from `http://localhost:3100`, which served the current frontend from `next dev desktop`. Its engine is `backend/desktop_engine.py` from the venv. That gives the current code end to end, except for the installer, PyInstaller packaging and release optimizations.

## 2. Feature verification matrix

| Feature | Status | Evidence (code path → test) |
|---|---|---|
| App startup, first screen | Implemented and verified (app) | Start screen, recent projects; page load 768 ms (dev server), no console errors |
| Native screen capture + system audio (Windows) | Implemented and verified (app) | `capture/video.rs`, `capture/audio.rs` → `desktop-recording.mjs`: 1920×1080 H.264, 690 frames in 22.976 s, 0 dropped |
| Microphone track | Implemented and verified (app), fake device | Separate `microphone.m4a`; level meter. Content sync with a real clap: **not run** |
| Window / area capture, webcam | Implemented but not runtime-tested | Code and unit tests only |
| macOS capture (WebView fallback), permissions | Implemented but not runtime-tested | Never built on a Mac |
| Pause / resume, markers, screenshots | Implemented and verified (app) | No pointer events stored while paused; marker and screenshot files present |
| Input events, privacy | Implemented and verified (code + tests + app) | `input/keys.rs` keeps shortcut names only; typing stores "typing happened" + caret box, throttled; every setting off by default except typing activity; window titles off by default and gated behind active window |
| Event timestamp sync | Implemented and verified (app) | Real cursor probes at 3 known positions matched in `events.jsonl`; pause/resume on one timestamp |
| Permission denied / missing device | Implemented and verified (app) | `media-errors.mjs` with `--deny-permission-prompts`: NotAllowedError, NotFoundError, OverconstrainedError all mapped |
| Crash recovery of a recording | Implemented and verified (app), **first time** | Killed mid-recording (TerminateProcess) → relaunch → "A recording was interrupted" → Recover → all 3 tracks decode with no errors (47.3 s) → opens in editor at 47.3 s |
| Smart zoom (focus), click rings, drawn cursor | Implemented and verified (headless); earlier (app, 16 Oct) | `preview-focus.mjs` passed; JS tests |
| Silence / dead-time review, automatic cuts | Implemented and verified (headless) | `preview-tutorial.mjs`: analysis, preview skips the cut, keep/cut |
| Draft assistant (review and apply as one undo step) | Implemented and verified (headless) | `preview-draft.mjs`: cancel, generate, accept, apply, one-step undo, reload keeps the draft |
| Highlights | Implemented and verified (headless) | `preview-highlights.mjs`; picture signals in the app and an exported highlight file: **not run** |
| Creator presets / reframing | Implemented and verified (headless) | JS tests; preset apply/undo in headless run. Exported files per preset: **not run** |
| Captions (local Whisper), SRT/VTT | Earlier (app, 16 Oct) | Not repeated today |
| Timeline editing, transitions, overlays, audio (pre-recorder features) | Automated + earlier (app) | JS tests and backend renders; no new app pass today |
| Undo/redo, project save/reopen | Verified (headless) for draft/highlights/presets; earlier (app) | IndexedDB store tests (`projects.test.ts`) |
| Missing media on reopen | Implemented and verified (app), **first time** | Native "Video not found" prompt with path; Cancel → "can't open until its videos are found" |
| Project delete | Verified (app) | Removes the project; recording files stay (as the dialog says) |
| Local engine (start, token) | Implemented and verified (app) | Cold start 3.9 s (venv); 127.0.0.1 only; 403 without/with a wrong token, 200 with the right one |
| Export render, NVENC + libx264 fallback, output check, disk-full | Automated (real ffmpeg) | `pytest` 75/75. In-app export: **not run today** (needs the website for the job ticket) |
| AI cleanup | Earlier (API via `dev:smoke`) | Not run in app |
| Updater | Implemented but not runtime-tested | Never run against a real release |
| Installer install/upgrade/uninstall | Earlier, **old build only** (Oct) | This branch: not packaged |
| AI "assistant" (conversational/model-driven editing) | Not applicable | Doesn't exist. The draft is deterministic and rule-based (stated in `draft.ts`); captions are the only model |
| Linux | Not applicable | Not supported |

No feature was found to be UI-only, mocked or broken.

## 3. Regression test report (all run today, on the machine above)

| Suite | Command | Result |
|---|---|---|
| Desktop JS | `npm run desktop:test:js` | 167/169. The 2 failures are `notices.test.mjs`: `rustc -vV` → "Access is denied" (toolchain, section 1). Not a code failure, but the notices build is **unverified** until rustc is back |
| Backend | `backend/.venv/Scripts/python -m pytest -q` | 75 passed, 7 subtests, 65.8 s (real ffmpeg renders) |
| Rust | `npm run desktop:test` | 29 passed, 6 ignored (live capture tests); prebuilt binaries |
| Types | `npx tsc --noEmit -p .` and `-p desktop` | Pass |
| Lint | `npx eslint` on all changed and new TS/TSX | Pass |
| Headless editor | `preview-draft`, `preview-highlights`, `preview-focus`, `preview-tutorial` | 4/4 pass (each asserts and exits non-zero on failure), no console errors |
| App: recording | `desktop-recording.mjs` | Pass. Manifest `complete`; screen 23.00 s, system audio 23.15 s, mic 22.55 s |
| App: permissions | `media-errors.mjs` (prompts denied) | 4/4 |
| App: crash recovery | Scratch script (start, hard kill, relaunch, Recover, decode, open) | Pass |
| App: missing media | Reopen a project whose folder was deleted | Pass |
| App: engine | `local_engine` + token checks | Pass |

Task 2 scenarios not executed, each with its limitation and how to run it:

| # | Scenario | Why not run | How to run it |
|---|---|---|---|
| 1 | Clean install / first-run on a fresh machine | No installer of this branch (rustc) | Build with `npm run desktop:build -- --bundles nsis`, install on a clean Windows 11 VM, run RELEASE.md checklist 1–3 |
| 2 | Real microphone A/V sync | Fake device; no clap reference | RECORDER.md checklist 3: clap on webcam and mic, check within 1–2 frames |
| 2 | Window / area capture, webcam | Needs a real drag and a camera | RECORDER.md checklist 2, 4 |
| 11 | In-app export (720p signed out, 1080p signed in), cancel | Needs the website (`localhost:3000`) or production for the ticket | `npm run dev` + the app; export, cancel mid-render, `ffprobe` the file |
| 12 | Disk full during recording; drive unplugged | Needs a small or removable volume | Record to a nearly full USB stick; expect auto-stop with reason |
| 12 | Disk full during export | Automated only (`507 disk_full` tests) | Export to a nearly full volume in the app |
| 13 | Project recovery after a crash while **editing** | Not scripted | Edit, kill the app before autosave, relaunch; check Recent projects |
| — | Upgrade from 0.1.0 with projects; uninstall | No new installer | RELEASE.md checklist 13–14 |

## 4. Performance findings

Measured today (debug build, dev server; **not** release numbers):

| What | Result |
|---|---|
| Launch to DevTools-reachable window | 2.6 s |
| Page DOMContentLoaded / load | 282 ms / 768 ms; JS heap 20 MB |
| Recording 23 s 1080p30 + system audio + mic | 690 frames, 0 dropped (30.03 fps) |
| Engine cold start / warm call | 3.9 s / 15 ms (venv; the packaged engine wasn't run) |
| Memory, idle after a recording | App process 45 MB; app WebView tree ≈ 520 MB working set; engine (venv Python) 89 MB working set, 485 MB private |

From Phase 6 (same machine, same day, not repeated): 300 s and 600 s recordings with 0 dropped frames, memory flat at 155–170 MB; export 60 s 1080p30 in 22.6 s (libx264) / 15.9 s (NVENC); 40-cut timeline export peaks at **8.3 GB** (blocker B2 below); highlight analysis of 1 h ≈ 250 ms; motion profile 120 s 1080p in 11.9 s. Full table: [RELEASE.md](RELEASE.md#export-encoders-output-checks-disk-space-benchmark).

**Not measured:**

- recording CPU at 1440p/4K or 60 fps;
- timeline responsiveness with hundreds of clips;
- release-build startup;
- packaged engine memory;
- anything on 8 GB, AMD or Intel-only machines.

Bottleneck with evidence: export memory grows about 200 MB per clip, because each clip keeps its own decoder.

## 5. Security, privacy and licensing

| Check | Finding |
|---|---|
| Keyboard text / passwords | **Not recorded.** `keys.rs` drops plain typing, Shift+key, AltGr and Option combos; only shortcut names and throttled "typing happened" events are kept (Rust tests). Caret position is stored with typing events (off with the Typing switch) |
| Input tracking can be disabled | Yes: mouse, clicks, scroll, shortcuts, typing, active window, window titles are separate switches; defaults off except typing activity |
| Recordings stay local | Yes. Recording, analysis, captions and export run locally. Network: the site (tickets, credits), Supabase, Hugging Face (model, after consent). The CSP limits `connect-src` |
| Local engine exposure | 127.0.0.1, random 64-hex token, constant-time compare, 403 verified. Its CORS list includes `http://localhost:3100` in release builds too (harmless without the token; worth removing) |
| File paths / imports | Engine accepts only absolute paths with a media suffix that exist (`_local_file`); asset protocol serves approved paths only; `.wipeclip` files validated as untrusted (tests) |
| Subprocesses | ffmpeg called with argument lists, no shell; paths absolute, so no option injection |
| **Logs** | **Defect D1**: the app log stores full paths with the Windows user name and personal file names. Seen in today's real log: `media picked: C:\Users\<user>\OneDrive\Desktop\Recording 2025-11-12 132938.mp4`, `export saved: …`, `project file to open: …`. Engine logs hold no paths (access log off, error kinds only) |
| Licensing | ffmpeg GPL-3.0 build (gyan.dev, libx264/libx265) shipped as a separate program; notices generated per build. **Needs legal review**: (a) the notice points to ffmpeg.org/gyan.dev for source, but GPLv3 §6 puts the duty to provide Corresponding Source on the distributor (a third-party server is allowed only if availability is ensured); (b) shipping H.264/HEVC *encoders* (libx264/libx265) in a commercial product can bring patent-pool licensing questions, separate from copyright. Whisper (MIT), transformers.js (Apache-2.0), content-check model (Apache-2.0), npm/Rust trees as in RELEASE.md. No new dependency this phase |

## 6. Platform and packaging readiness

| | Windows 11 x64 | Windows 10 x64 | Windows on ARM | macOS 13+ (Apple Silicon) | macOS 11–12 / Intel |
|---|---|---|---|---|---|
| Builds | Old build only (Oct). This branch: no (rustc) | Same installer | Not built | Never built | Never built |
| Runs | Verified (debug build, current code) | Untested. Capture needs 1903+; pointer-free capture needs 2004+ (guarded by `ApiInformation`) | — | — | Recorder unavailable below 13 (WKWebView); editor only |
| Installer | NSIS per user, WebView2 bootstrapper | Same | — | DMG, hardened runtime, mic/camera entitlements and usage strings present | Same |
| Signing | **Unsigned** (SmartScreen warning) | Same | — | Needs Developer ID + notarization; the PyInstaller engine and its ffmpeg must also be signed (CI does this, never run) | Same |
| Updates | minisign-verified, click to install, refused while recording; never exercised end to end | Same | — | Same | Same |
| Failed update | NSIS passive installer; no rollback in the app. A failed install leaves the previous install (not tested) | | | | |
| Project migration | `migrateProject` drops invalid drafts and highlights instead of failing; IndexedDB v1→v2 move tested; newer `.wipeclip` files refused with a message | | | | |
| Uninstall | Keeps recordings (`Videos\WipeClip`), app data and projects (verified with the Oct build); no "remove my data" option. Documented, but not shown to the user at uninstall | | | | |

## 7. Bug list (prioritized)

| ID | Severity | Bug | Reproduction | Status |
|---|---|---|---|---|
| D0 | Blocker (environment) | `rustc.exe` missing from the MSVC toolchain; no Rust build possible | `rustc -vV` → "not applicable to the 'stable-x86_64-pc-windows-msvc' toolchain" | Open; repair command in section 1 (needs your approval) |
| B2 | High | Export memory ≈ 200 MB per clip; a 40-cut, 10-minute timeline peaks at 8.3 GB | `backend/bench/export_bench.py` "40 cuts" project | Open (architectural: segmented rendering; needs approval) |
| D1 | Medium (privacy) | Full file paths with the user name in the app log | Open a video, export, or double-click a `.wipeclip`; read `%LOCALAPPDATA%\co.wipeclip.desktop\logs\WipeClip.log` | Open. Fix is ready to apply (section 8) but needs rustc to verify |
| D2 | Low (UX) | Relinking a moved recording asks for each track separately, each called by a generic name (`screen.mp4`, then `system-audio.m4a`, …) | Move a recording folder, reopen its project | Open (recommendation) |
| D3 | Low (UX) | After Recover, the user lands on the "Recording saved" review, not the editor. Correct, but the recovered recording's length (from the files) is longer than the manifest's (from the last event) until it opens | Section 3, crash recovery | No change needed; documented |
| D4 | Low (hardening) | `http://localhost:3100` in the engine's allowed origins in release builds | `src-tauri/src/engine.rs` `ALLOWED_ORIGINS` | Open |

No defect was found that loses data or produces wrong output in the paths run today.

## 8. Recommended fixes (exact files)

1. **D0**: repair the toolchain (section 1), then `npm run desktop:test` and `npm run desktop:test:js` must be fully green.
2. **D1**: in `src-tauri/src/media.rs` (`media picked`), `src-tauri/src/export.rs` (`export save … failed`, `export saved`) and `src-tauri/src/opened.rs` (`project file to open`, `reading … failed`), log only the extension and size, never `path.display()`. Then run `npm run desktop:test` and check a fresh log with `grep -i users`.
3. **D4**: in `src-tauri/src/engine.rs`, add `http://localhost:3100` only when `cfg!(debug_assertions)`.
4. **B2**: segmented export in `backend/app/pipeline/editor.py` (render groups of clips, join with the concat demuxer), or one decoder per source for consecutive clips. Needs your decision, since it rewrites the export graph.
5. **B3** (from Phase 6): "Send diagnostics" that zips the logs (after D1) for testers to attach. New code in `src-tauri/src/lib.rs` plus a button in `desktop/app/DesktopShell.tsx`.
6. **D2**: when a recording track is relinked, try the same file names in the new folder before asking again (`linkDiskSources` in `src/components/editor/VideoEditor.tsx`; the native side must approve the sibling files, in `media.rs`).

No code was changed in this phase. The only confirmed defect with a small fix (D1) is in Rust, and it can't be compiled or tested here until D0 is fixed.

## 9. Release blockers vs non-blocking

**Blockers for a private (invited, Windows) beta:**

1. D0, then a signed-or-explained installer **built from this branch**, installed on a clean Windows 11 machine, passing RELEASE.md checklist 1–14.
2. D1 + B3: testers must be able to send logs without leaking file names.
3. B2: either fix it, or have the app warn before exporting large cut timelines on machines with less than 16 GB, and state it in the beta notes.
4. Commit the Phase 5–6 work (currently only in the working tree) so the beta build is reproducible.

**Blockers for a public release (in addition):** Windows code signing; macOS build, signing, notarization and a full manual pass; production backend deployed with the export fixes; a signed-in production export test; the ffmpeg source-offer process and patent review (section 5); updater exercised end to end, including a failed update.

**Non-blocking:** D2, D3, D4; Quick Sync/AMD encoders; keyboard trimming and a screen-reader pass; audio-pass split for export speed.

## 10. Beta test plan

**Who:** 15–25 invited Windows 11 users, roughly a third each from gamers/streamers, developers, and tutorial creators; at least 4 machines with 8 GB RAM and at least 4 without an NVIDIA GPU.

**Privacy for testers:**

- Recordings never leave their machine.
- Nothing is collected automatically.
- Logs are sent only by hand, after D1.
- Testers record only what they're allowed to share.
- Privacy masks hide only what they mark.

**Scenarios (each tester runs those for their group, plus S0):**

| ID | Scenario | Success criteria |
|---|---|---|
| S0 | Install, first launch, sign in, record 30 s, export 720p | No error; file plays with sound |
| G1 | 10 min 1080p60 gameplay with system audio + mic, then Highlights and export one | 0 dropped frames reported in the review; highlight file plays in sync |
| G2 | Stream-style 20 min recording, pause twice | Pauses removed; audio in sync at start and end (clap) |
| D1 | 5 min coding session with shortcuts on, focus zooms, captions | Zooms land on the typing area; shortcut indicators correct; **no typed text appears anywhere** |
| D2 | Mask a secret in a terminal, export | Mask present in every exported frame of its range |
| T1 | 8 min narrated tutorial, Draft (cuts + zooms + chapters), accept some, apply, undo once, apply again | Applied edits match accepted items; undo is one step |
| T2 | Same recording edited by hand vs with Draft (counterbalanced order) | Times recorded by the tester |
| R1 | Kill WipeClip during a recording (Task Manager), reopen, Recover | Recording opens and plays |
| R2 | Move a recording folder, reopen its project | Relink works |

**Metrics (from tester reports; none collected automatically):**

| Metric | Definition | Target for moving to a public release |
|---|---|---|
| Recording failure rate | Recordings that didn't produce a playable file ÷ recordings started | < 1 % |
| Export failure rate | Exports that errored or produced a bad file ÷ exports started | < 2 % |
| Automatic edits accepted | Accepted ÷ suggested, per kind (zooms, cuts, chapters, highlights), from the Draft and Highlights panels | Reported, not targeted, in the first beta |
| Time saved | Manual time − Draft time on T2, per tester, median | Median > 0 with most testers saving time |
| Critical bugs per session | Data loss, crash, wrong export, privacy leak ÷ sessions | 0 data-loss or privacy bugs |
| Crashes / data loss | Count, with diagnostics zip | 0 unrecovered recordings |

**Feedback questions:**

1. What did you record, and how long was it?
2. Which automatic edit was wrong, and how did you fix it?
3. What made you leave the app or do something by hand?
4. Was anything you didn't want recorded or kept?
5. How long did the export take, and was the result what you expected?

**Bug report must include:**

- OS build, CPU, GPU, RAM;
- recording settings (source, fps, audio);
- steps, expected and actual result;
- time of the problem;
- the diagnostics zip (after B3);
- for export bugs, the project file if the tester agrees to share it.

## 11. Release checklist

1. [ ] Toolchain repaired; JS, Rust, backend, type and lint checks all green on a clean checkout.
2. [ ] Phase 5–7 work reviewed and committed; version bumped.
3. [ ] D1 fixed; fresh log contains no `\Users\` paths.
4. [ ] B3 diagnostics bundle; B2 fixed or warned.
5. [ ] `npm run desktop:build -- --bundles nsis` on CI (with engine, notices) and locally.
6. [ ] Clean Windows 11 VM: install, first run, record, recover, edit, export (720p signed out, 1080p signed in), upgrade from 0.1.0 with projects, uninstall (data kept as documented).
7. [ ] Windows 10 22H2 smoke test.
8. [ ] 8 GB, no-NVIDIA machine: 10-minute recording, export.
9. [ ] Real microphone clap sync; webcam; window and area capture; mic unplug.
10. [ ] Updater: publish to a test channel, update 0.1.x → new, and a failed download.
11. [ ] Production backend deployed; signed-in production export.
12. [ ] (Public only) Windows signing; macOS build, signing, notarization, full pass; legal sign-off on ffmpeg source offer and codec patents.

## 12. Implementation status (verified only)

| Area | Highest verification reached |
|---|---|
| Windows native recording (screen, system audio), pause, markers, screenshots, events | App, today |
| Crash recovery of recordings | App, today (first time) |
| Permission and missing-device errors | App, today |
| Missing media relink prompt | App, today (cancel path) |
| Local engine start and token | App, today (venv engine) |
| Draft, highlights, focus preferences, presets, pause review | Headless editor, today |
| Export pipeline (encoders, fallback, output checks, disk full) | Automated with real ffmpeg, today |
| Captions, masks, annotations, focus zooms in the app | App, 16 Oct (older build) |
| Installer, upgrade, uninstall | App, Oct build only |
| Microphone content sync, webcam, window/area capture, updater, signed-in export | Not verified |
| macOS (all) | Not verified |
