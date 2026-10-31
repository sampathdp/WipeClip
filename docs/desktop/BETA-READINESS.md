# Beta readiness report (Phase 6)

WipeClip desktop (Windows, macOS), 29 October 2026, branch `feat/recorder-hardening` (uncommitted work on top of `af8a1a3`). Nothing has been published, signed, distributed or released.

**Verified** means run on a real machine in the stated way. Everything else says how far it got. No user feedback or field data exists yet; nothing below is estimated or invented.

Machine for every measurement: Windows 11 Pro 10.0.26200, Intel i7-9750H (6 cores / 12 threads), 15.9 GB RAM, NVIDIA GeForce GTX 1650 + Intel UHD 630, 1920×1080 at 125%.

## 1. Verdict

**Ready for a small, invited Windows beta after blockers B1–B4 are cleared. Not ready for macOS.**

The editing, recording and export core works and is heavily tested. What stands in the way:

- **B1**: this branch's changes haven't been run in an installed build.
- **B2**: long, heavily cut timelines need too much memory to export on 8 GB machines.
- **B3**: there's no way to collect crash or reliability data from testers.
- **B4**: the installer is unsigned and the backend fixes aren't deployed.

macOS has never been built.

## 2. Status of earlier phases

| Area | Doc | What works | Level of verification |
|---|---|---|---|
| Desktop shell, sign-in, export save, updater, local engine | README, RELEASE | Installer, upgrade, uninstall, deep links, OS save dialog, local FastAPI engine with per-launch token | **Installed app, Windows 11** (15–16 Oct build). Updater: code and CI only, never run against a real release |
| Screen recorder (native Windows capture, system audio, mic, webcam, events, markers, screenshots, pause) | RECORDER | Entire-screen capture + system audio; constant-rate frames; crash-readable fMP4 | **Installed app** for screen + system audio; **native tests** for timing (flips within one frame, before and after pause), 10 min and today a 5 min session with 0 dropped frames. Window/area capture, webcam, device unplug, crash recovery: **not run** |
| Focus zooms, click rings, drawn cursor | FOCUS | Suggestions from events; preview = export framing | **Installed app** + JS tests + real ffmpeg export tests |
| Tutorial tools (review, draft, chapters, shortcuts, masks, annotations, retakes) | TUTORIAL | All listed; draft apply as one undo step | JS tests, real ffmpeg export tests, headless Chrome (`preview-tutorial.mjs`, `preview-draft.mjs`). Masks/arrow/screenshot **installed app** (Phase 4). Draft and the picture-checked silence review: **not in the installed app** |
| Captions (local Whisper), SRT/VTT/transcript, edit by text | TUTORIAL | Model consent, transcription, editable layers, exports | **Installed app** (14.8 s of speech, word-perfect) |
| Export reliability (this branch) | RELEASE, Export | NVENC with libx264 fallback, output checks, disk-space checks, benchmark | Backend tests with real ffmpeg + the benchmark below. **Not in the installed app** |

## 3. Phase 6 results

### A. Highlights: implemented
Signal-based, explainable, cancellable, cached, non-destructive, saved with the project. See [CREATOR.md](CREATOR.md#highlights).

- **Verified**: 11 logic tests; 2 real-ffmpeg tests for the motion profile; a headless-Chrome run of the real editor (`tests/desktop/manual/preview-highlights.mjs`). In that run: find took 0.6 s on a 20 s project; the marker and a sound + click burst were found with their reasons; keep, reject and range edit worked; Export clip opened "Export highlight" with a 7.0 s clip; finding again kept the user's choices; the result survived a reload; the timeline was unchanged; no console errors.
- **Not verified**: picture signals inside the app (the browser run has no engine; the endpoint itself is tested), an exported highlight file, usefulness on real recordings.

### B. Speech and captions: already existed; verified and documented
Local, optional, 24 languages + auto-detect, editable text/timing, SRT/VTT/transcript, source audio untouched, silence suggestions. No new model: the existing one uses the same Whisper checkpoints whisper.cpp would. Language limitations are in [CREATOR.md](CREATOR.md#speech-and-captions-status).

### C. Creator presets: implemented
Landscape, Vertical, Square, Software tutorial (Canvas > Made for). Reframing follows recorded activity per clip and falls back to the whole picture when a crop would hide activity. Everything stays adjustable. The existing renderer is reused.

- **Verified**: 6 logic tests; headless Chrome (Vertical preset applied, then undone).
- **Not verified**: exported files for each preset.

### D. Beta audit: findings in sections 4–8
Two problems were fixed in this pass:

- **Export memory** (found by the benchmark): text, sticker and image layers queued every frame before they appeared. Measured: 11.7 GB → 2.2 GB peak and 80 s → 57 s on a 2-minute project.
- **Modal dialogs** didn't keep keyboard focus inside them (Tab now wraps).

## 4. Test matrix

✓ = verified as described · T = automated tests only · H = headless Chrome · — = not run · n/a = not applicable

| Feature | Win 11 installed app | Win automated | Headless Chrome | macOS | Win 10 | AMD GPU / no NVIDIA | 8 GB RAM |
|---|---|---|---|---|---|---|---|
| Install / upgrade / uninstall | ✓ (Oct build) | — | n/a | — | — | — | — |
| First run, engine start, model consent | ✓ | T | — | — | — | — | — |
| Recording: entire screen + system audio | ✓ | ✓ native 5 + 10 min | n/a | — | — | — | — |
| Recording: window / area / webcam / mic unplug / crash recovery | — | T (format, recovery logic) | n/a | — | — | — | — |
| Project save / reopen / library | ✓ | T | H | — | — | — | — |
| Undo / redo (edits, draft, highlights, presets) | ✓ (zooms) | T | H | — | — | — | — |
| Automatic edits: zooms, review, draft | ✓ (zooms) | T | H | — | — | — | — |
| Highlights | — | T | H | — | — | — | — |
| Captions + subtitle export | ✓ | T | — | — | — | — | — |
| Creator presets | — | T | H | — | — | — | — |
| Export signed out 720p | ✓ | T | — | — | — | — | — |
| Export signed in 1080p+ | — | T (engine) | — | — | — | — | — |
| Export: NVENC + fallback, output checks, disk full | — | ✓ (GTX 1650) | n/a | n/a | — | T (fallback via forced bad encoder) | — |
| Export: 40-cut timeline | — | ✓ 8.3 GB peak | n/a | — | — | — | **expected to page** |
| Error messages (disk full, export failure, offline) | partly ✓ (offline, limits) | T | — | — | — | — | — |
| Keyboard navigation | — | — | partly (shortcuts) | — | — | — | — |
| Privacy masks in export | ✓ | T | H | — | — | — | — |

### Unsupported or untested combinations

| Combination | Status |
|---|---|
| macOS (any) | Never built. No system audio (WKWebView). Native capture is Windows-only; macOS uses the WebView fallback. Permissions untested |
| Windows 10 | Untested. The drawn cursor needs 2004+ (`IsCursorCaptureEnabled`) |
| Windows on ARM | Not built (x64 installer only) |
| Linux | Not supported |
| AMD GPUs | AMF never tested, not used; export uses libx264. The recorder uses the Media Foundation encoder (hardware if the driver offers one), untested on AMD |
| Intel-only GPU | Quick Sync available but not automatic; libx264 used |
| < 16 GB RAM | Untested. Exports of timelines with many clips (> ~25 at 1080p) are expected to page (B2) |
| HEVC sources on Windows | Need Microsoft's HEVC extension (playback); not tested |
| Multiple displays, display change while recording, 4K capture | Not run |
| Screen readers | Not tested with NVDA, Narrator or VoiceOver |

## 5. Performance (measured)

| What | Result |
|---|---|
| Recording, 1080p30 + system audio, 300 s (today) | 9,001 frames, 0 dropped; clock 300.001 s, video 300.033 s, audio 300.011 s |
| Recording, 600 s (earlier, RECORDER.md) | 18,001 frames, 0 dropped; memory flat at 155–170 MB |
| Export 60 s 1080p30 | libx264 22.6 s / NVENC 15.9 s (3.8× real time) |
| Export 300 s 1080p30 | 99 s / 76 s |
| Export 60 s 1440p60 high motion | 74.9 s / 51.4 s |
| Export A/V sync (clip, mic, system audio) | 0 ms offset at a 10 ms measurement step, both encoders |
| Export 40 cuts with zooms | 215 s, **8.3 GB** peak (B2) |
| Export 6 crossfades + 12 text layers | 57 s, 2.2 GB (was 80 s, 11.7 GB) |
| Highlight analysis, 1 h synthetic | ~250 ms |
| Picture motion profile | 120 s of 1080p in 11.9 s |
| Silence analysis, 30 min | ~150 ms after mixing (TUTORIAL.md) |

The full table with memory, CPU and GPU use is in [RELEASE.md](RELEASE.md#export-encoders-output-checks-disk-space-benchmark).

**Not measured**: time saved versus manual editing, highlight acceptance on real footage, caption correction rate, crash rate, export failure rate in the field, defect reports. Each needs testers; section 9 says how.

## 6. Privacy

- Recording, analysis, captions, highlights and export run on the device. Recordings and events are never uploaded. Export sends media to the **local** engine; only the plan check (ticket) reaches the site.
- Keystrokes: only shortcuts and "typing happened" are stored, never characters (enforced in Rust).
- Telemetry: none from the desktop app. The CSP limits connections to the site APIs, the engine on 127.0.0.1, Supabase and Hugging Face (model download). `@vercel/analytics` calls have no reachable endpoint there. Highlight counts are stored in the project only.
- Logs: app and engine logs under `%LOCALAPPDATA%\co.wipeclip.desktop\logs\`. The new export log lines hold no file paths or ffmpeg error text.
- Masks hide only what the user marks (stated in the UI).
- **Gaps**: no in-app diagnostics export (testers must find the log folder), no crash reporter, no privacy setting for the logs. Uninstall keeps app data and recordings (documented; no "remove my data" option).

## 7. Licensing

- No new dependency in this phase. Highlights use ffmpeg's `scdet`/`freezedetect`; presets are pure code; the encoders are already in the bundled ffmpeg (gyan.dev build).
- Existing: Whisper weights MIT; transformers.js Apache-2.0; ffmpeg GPL build obligations (source requests must be answered; RELEASE.md, blocker 5); notices file and secret scan in the build.
- Considered and **not** added: YAMNet (Apache-2.0 code, CC BY 4.0 labels) and Silero VAD (licence wording conflicts between copies; check the repository's LICENSE before any use).

## 8. Packaging

| | Status |
|---|---|
| Windows NSIS installer | Builds; installed/upgraded/uninstalled (Oct build). **Unsigned** (SmartScreen warning). This branch not yet packaged |
| Engine (PyInstaller) | Builds in CI; ~300 MB unpacked |
| macOS DMG | Config + CI job only; never built; needs Developer ID + notarization |
| Updater | Signed manifests via minisign; release script and CI exist; never exercised end to end |
| CI | Manual workflow on Windows and macOS runners |

## 9. Unresolved issues (prioritized)

| # | Issue | Why it matters | Next step |
|---|---|---|---|
| B1 | This branch (recorder hardening, draft, picture-checked review, export reliability, highlights, presets) is untested in an installed build | The installed-app pass predates it | Build the installer from this branch and run the RELEASE.md checklist plus: an exported highlight, each preset exported, an NVENC export and a forced fallback in the app |
| B2 | Export memory grows ~200 MB per clip (every clip keeps a decoder open) | A 10-min recording with 40 accepted cuts needs ~8 GB: paging or failure on 8 GB laptops, the likely beta hardware | Render in segments (groups of clips encoded separately, then joined without re-encoding), or reuse one decoder per source file for consecutive clips |
| B3 | No way to collect reliability data | The beta can't answer crash rate, export reliability or defect questions | Add an opt-in "Send diagnostics" that zips the logs (paths redacted) for the tester to attach; an opt-in crash reporter later |
| B4 | Unsigned installer; backend fixes not deployed; no signed-in production test | From RELEASE.md, still open | As there |
| H1 | macOS never built | Half the audience | One CI build, then a manual pass on a Mac |
| H2 | ffmpeg source-request process | GPL obligation | Name an owner |
| M1 | Highlights untested on real footage | The signal thresholds were tuned on synthetic tests | Collect testers' kept/rejected counts (already stored) and re-tune |
| M2 | Highlight rejection has no reason | Can't tell bad suggestions from unwanted ones | Optional "not interesting / wrong range" on reject |
| M3 | Caption corrections not counted | Asked-for metric | Count edited caption layers since generation (local, like highlights) |
| M4 | Accessibility: timeline trimming and moving are mouse-only (selection, seek and Alt+Arrow move work by keyboard); no screen-reader pass | Keyboard and assistive-tech users | Keyboard trim (e.g. `[`/`]`), live-region announcements for long jobs, an NVDA pass |
| M5 | Quick Sync gives little speed for bigger files | Intel-only laptops get no hardware speed-up | Revisit with a newer Intel GPU; keep libx264 meanwhile |
| L1 | Export with audio ~2× slower for heavy effect graphs (RELEASE.md) | Speed | Separate audio pass |

## 10. How to measure during the beta (nothing collected automatically)

1. **Highlights**: testers report the counts shown in the Highlights panel ("N suggested, kept, edited, rejected, exported") per project.
2. **Captions**: once M3 is in, the same kind of local count.
3. **Time saved**: a timed task. The same 5-minute recording, edited to a given brief once by hand and once with Draft + Highlights, in counterbalanced order, measured by the tester's clock.
4. **Reliability**: testers send the diagnostics zip (B3) after any failure. Each export log line includes the encoder and whether the fallback ran.
5. **Recording performance**: `live_sync::long_session` on testers' machines when they agree to run it (it reports dropped frames and drift).
6. **Defects**: a single issue form (OS, GPU, RAM, steps, diagnostics zip).

## 11. Post-beta roadmap (prioritized)

1. Segmented export rendering (B2), then raise the 10-minute export cap.
2. Diagnostics bundle, then an opt-in crash reporter (B3).
3. macOS build, signing, notarization, and system audio via ScreenCaptureKit (WKWebView has none).
4. Highlight tuning from beta counts; optional audio-event classifier evaluated against those counts (YAMNet-class, ~4 MB), only if it measurably helps.
5. Keyboard timeline editing and a screen-reader pass.
6. Caption correction counts; a speaker-aware silence review.
7. AMD AMF and newer Intel Quick Sync evaluation on real hardware.
8. Audio-pass split for export speed.

## Tests run for this report (all on the machine above)

- JS: `npm run desktop:test:js`, 169/169 (including the new highlights (11) and creator presets (6) suites).
- Backend: `pytest`, 75/75 (real ffmpeg renders; includes the new encoder, motion-profile and late-layer tests).
- Rust: `npm run desktop:test`, 29 passed, 6 ignored (live capture tests, run separately: `long_session` 300 s passed).
- Type checks for the website and desktop projects; ESLint on changed files.
- Headless Chrome: `preview-highlights.mjs` passed.
- Export benchmark: `backend/bench/export_bench.py` (6 projects × 3 encoders, plus the re-run after the memory fix).
