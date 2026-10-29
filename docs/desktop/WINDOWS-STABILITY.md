# Windows stability and release hardening (Phase 1)

WipeClip desktop, 29 October 2026, branch `feat/recorder-hardening`, on the machine below. Builds on [PRODUCT-GAP-AUDIT.md](PRODUCT-GAP-AUDIT.md) (Phase 0). Nothing was committed, signed, published or uploaded.

Machine: Windows 11 Pro 10.0.26200, Intel i7-9750H (6 cores, 12 threads), 15.9 GB RAM, GeForce GTX 1650 + UHD 630, one 1920×1080 display at 125 %.

## 1. Build environment (D0)

**Root cause found:** Avast Antivirus deletes `rustc.exe` 1.99.0 (MSVC) as soon as it is installed. Windows Defender is not running.

- A fresh `rustup toolchain install 1.99.0` lost `rustc.exe` within seconds, while the `.pdb` and `rustc_driver` DLL stayed.
- `rustup component remove rustc` then fails, because the file it expects to remove is gone.
- Rust **1.98.0** (MSVC) installs and stays.

What this phase uses:

- Every Rust command runs with `RUSTUP_TOOLCHAIN=1.98.0-x86_64-pc-windows-msvc`.
- No file in the repository pins the toolchain.
- The `stable` toolchain on this machine is left as it was (still missing `rustc.exe`).
- Tried and dropped: the GNU-host `rustc` cross-compiling to MSVC. Build scripts compile for the GNU host and need MinGW's `dlltool`, which fails.

**To fix permanently (your machine, your call):** in Avast, restore `rustc.exe` from the virus chest, or add `%USERPROFILE%\.rustup\toolchains\` as an exception. Then run `rustup toolchain uninstall stable && rustup toolchain install stable`. Report the false positive to Avast.

## 2. Defects fixed in this phase

| ID | Defect | Fix | Test |
|---|---|---|---|
| P0-3 / D1 | File paths (user name, file names) in `WipeClip.log`. They came from Rust log lines and from the engine: ffmpeg's stderr tail inside `RuntimeError`, and `subprocess.CalledProcessError` tracebacks that list the whole command | `src-tauri/src/redact.rs`: every log line, including forwarded engine and frontend lines, passes through `redact()` in the log formatter (`lib.rs`). Absolute paths (`C:\…`, `C:/…`, `\\server\…`, `/Users/…`, …) become `<.mp4 file>`. The explicit `path.display()` lines in `media.rs`, `export.rs` and `opened.rs` now log `a .mp4 file`. Blocked navigations log only the origin, never a query string (which could carry an auth code) | 4 Rust tests in `redact::tests`, built from real formats: an ffmpeg error, a Python traceback, an escaped Python path, a UNC path, sentence punctuation, text that must stay untouched |
| New | Audio cleanup of an unreadable file returned a bare `500 Internal Server Error`: `audio_clean._decode` raised `CalledProcessError`, which the route didn't catch, and the traceback named the file | `_decode` raises a `RuntimeError` without the command. The user now sees "This clip's audio couldn't be cleaned up." (400) | `test_audio_clean.py::test_unreadable_file_is_a_message_without_its_path` |
| New | **Exports with crossfades lost frames.** Every plain cut after an `xfade` dropped one frame, shifting everything after it earlier. 18 clips with 2 crossfades: 222 of 258 frames (1.2 s). Cause: xfade ends its stream at its last frame's start, and the `fps` after each following `concat` dropped that frame | `editor._clip_track`: each run of plain cuts is joined by a single `concat`, and the runs are crossfaded, so no concat ever follows an xfade. Audio joins unchanged | Frame counts now exact in every case measured (4/6/12 clips, 0–2 crossfades); `test_segmented_export.py` checks frame count and each clip's content |
| P0-5 / B2 | Export memory grew about 140 MB per clip (40 cuts: 5.6 GB) | Long timelines render in pieces (section 6) | `test_segmented_export.py` (4 tests); memory benchmark below |
| P0-4 | Preset labels named third-party platforms | Labels are now "Landscape", "Vertical", "Square" and "Software tutorial"; the internal id `youtube` became `landscape` (not stored in projects, so no migration). Docs and tests updated | `creatorPresets.test.ts`; grep finds no platform names in `src/lib/editor`, `src/components`, `docs/desktop` or `tests/desktop` |
| New | **An export could overwrite its own source recording.** The OS save dialog's "replace?" was the only guard | `choose_export_path` refuses an existing file that is an approved source video or a track in a known recording folder, comparing canonical paths so another spelling of the same file is caught. The editor shows the message and keeps the export, so the user can choose another name | Compiled and unit-tested crate; the refusal itself needs a manual check (section 4, E7) |
| D4 | `http://localhost:3100` allowed as an engine origin in release builds | Only in debug builds | Packaged engine run with the release origins: CORS preflight from `localhost:3100` gets no allow header |
| P1-7 | Engine port race: the port is picked, released, and only then bound by the engine | If the engine exits during startup, which is what a taken port causes, it is started once more on a new port | Covered by the existing engine tests. This phase hit the race for real in a manual run (section 7) |

Not fixed, with the reason:

- **P1-1 (unsigned local export tickets).** Needs your decision on asymmetric ticket signing (Phase 3 in the audit).
- **B3 (diagnostics zip).** New feature; with logs now redacted, it's a small follow-up.
- **D2 (relink each track).** UX improvement only.

## 3. Regression test matrix

Rows marked "Automated" were run in this phase (section 8). "Manual" rows give a reproducible procedure and their latest result.

| Area | Case | How | Result |
|---|---|---|---|
| Launch | App starts, engine starts on first use | Packaged engine started by hand (section 7) | Engine cold start 2.15 s. App launch of the new build: see section 9 |
| Recording | Screen + system audio, 1080p30 | `tests/desktop/manual/desktop-recording.mjs` | Phase 7: pass, 0 dropped frames. **Not re-run** (needs the debug app and moves the real cursor) |
| Recording | Pause/resume, markers, screenshots | Same script | Phase 7: pass |
| Recording | Microphone | Same script, fake device | Phase 7: pass. A real microphone: not run |
| Recording | Webcam, window/area capture | Manual | Not run (hardware) |
| Recording | Manifest, event timing, A/V sync after a normal stop | `recorder.test.ts` (24 tests) + script | Automated: pass |
| Recovery | Hard kill mid-recording, relaunch, Recover | Phase 7 scratch procedure (TerminateProcess, relaunch, Recover, decode all tracks) | Phase 7: pass |
| Failures | Permission denied, missing device, unsupported constraints | `mediaErrors.ts` + `media-errors.mjs` | Phase 7: 4/4 |
| Failures | Low disk before recording | `recorder.test.ts` (storage checks) | Automated: pass |
| Failures | Disk full during export / before export | `test_encoders.py` (2 tests) | Automated: pass |
| Failures | Write failure on save (missing folder, permissions) | `export::tests::atomic_write_replaces_and_cleans_up`, `friendly_io_error` | Automated: pass |
| Failures | Unreadable source in audio cleanup | New test | Automated: pass |
| Failures | Display unplugged during capture | Manual: start a recording on a second display, unplug it | Not run (one display) |
| Projects | Autosave, reopen, IndexedDB migration | `projects.test.ts` (7) | Automated: pass |
| Projects | `.wipeclip` export/import, damaged or compressed files, newer versions refused | `projectfile.test.ts` (5); `zip.ts` bounds checks | Automated: pass |
| Projects | Missing source, relink | Manual (Phase 7) | Phase 7: pass |
| Timeline | Trim, split, ripple, speed, word edit | `tutorial.test.ts`, `wordEdit.test.ts`, `cleanup.test.ts` | Automated: pass |
| Undo/redo | Draft and highlights applied as one step | `draft.test.ts`, `highlights.test.ts` | Automated: pass. Headless scripts: see section 8 |
| Export | Render, layers, masks, focus zooms | `test_editor_layers.py`, `test_privacy_export.py`, `test_focus_export.py` | Automated: pass |
| Export | Crossfades + cuts keep every frame | `test_segmented_export.py` | Automated: pass |
| Export | Long timeline in pieces = one-pass result | `test_segmented_export.py` | Automated: pass |
| Export | Cancel stops the render and removes temp files | `test_export_progress.py`, `test_encoders.py::test_cancel_removes_the_temporary_folder` | Automated: pass |
| Export | Hardware encoder fails, libx264 fallback | `test_encoders.py::test_a_failing_encoder_falls_back_to_libx264` | Automated: pass |
| Export | Output validation (length, size, streams, decodable end) | `test_encoders.py::test_output_checks` | Automated: pass |
| Export | Final file replaced atomically; never over a source | `write_atomically` test; source guard (manual E7) | Automated: pass / manual pending |
| Security | Engine token: 403 without or with a wrong token, 200 with it | Packaged engine (section 7) | Pass |
| Security | Engine path validation | `test_local_paths.py` (4) | Automated: pass |
| Security | Log redaction | `redact::tests` (4) | Automated: pass |

## 4. Manual checks still needed (each about 2 minutes, on the new build)

| ID | Steps | Expected |
|---|---|---|
| E1 | Record 30 s screen + system audio + a **real** microphone, clap three times | Clap in the video and in both audio tracks within 1 frame |
| E2 | Record with the webcam on; then window capture; then area capture | Each opens in the editor and plays |
| E3 | Kill WipeClip in Task Manager mid-recording, reopen, Recover | Recording opens and plays |
| E4 | Export 720p signed in on a free account, then on a paid one | Free: mark present, 720p max; paid: no mark |
| E5 | Export a project with 20+ cuts; watch memory in Task Manager | `wipeclip-engine.exe` plus ffmpeg stay under about 2 GB |
| E6 | Start an export, press Cancel | Export stops; no file at the chosen name; temp folder gone |
| E7 | Export and, in the save dialog, pick the source recording's `screen.mp4` (agree to replace) | Refused with "That file is one of your source videos or recordings…"; the original is unchanged |
| E8 | After E1–E7, open `%LOCALAPPDATA%\co.wipeclip.desktop\logs\WipeClip.log` and search for `Users\` and for a recording's file name | No match |

## 5. Unsigned installer warning (for beta testers)

The installer isn't code-signed. On first run Windows SmartScreen shows **"Windows protected your PC"** with **Unknown publisher**:

1. Select **More info**.
2. Select **Run anyway**.

Some antivirus products (this phase found Avast deleting the Rust compiler) may also flag the unsigned app or its engine (`wipeclip-engine.exe`). Testers should restore the file and add an exception only if they got the installer from the beta link. Signing (OV/EV certificate or Azure Trusted Signing, see [README.md](README.md)) removes the SmartScreen warning and is required before a public release.

Packaging configuration, checked:

- NSIS, per-user install (`installMode: currentUser`, no admin prompt).
- WebView2 is fetched by the bootstrapper.
- `.wipeclip` file association.
- `wipeclip://` deep link.
- The engine bundled from `src-tauri/resources/engine` (the build refuses to run without it when `WIPECLIP_REQUIRE_ENGINE=1`).
- Third-party notices generated per build.
- The updater public key is set.
- No update bundles without `TAURI_SIGNING_PRIVATE_KEY` (none on this machine), so this build can't be offered as an update.

## 6. Export memory (B2): profile, change, result

**Profiled first.** Synthetic 330 s 1080p30 H.264, cuts of 5 s every 7.5 s with a zoom in and out (the Phase 6 "cuts_zooms" project), libx264, peak working set of ffmpeg:

| Cuts | Before (one pass) | Time |
|---|---|---|
| 1 | 736 MB | 12 s |
| 10 | 2008 MB | 64 s |
| 20 | 3771 MB | 114 s |
| 40 | 5563 MB | 326 s |

Where it goes (20 cuts):

- Decoder threads aren't the cause: 1 thread instead of 2 gave 3603 vs 3771 MB.
- Without zooms the peak is 2982 MB.
- Bare inputs with only a concat: 2083 MB, about 78 MB per open input.

So every clip's decoder and filter chain stays allocated for the whole render, about 80 MB for the input and about 70 MB for its filters. Only rendering fewer clips at once bounds it.

**Change (bounded processing, not a rewrite of the graph).**

- From 13 clips on (`SEGMENT_MIN_CLIPS`), `render_export` first renders groups of about 8 clips (`SEGMENT_CLIPS`) to near-lossless pieces in the export's temp folder: H.264 CRF 8 plus PCM audio, each exactly its timeline length.
- A piece only ends at a plain cut, so a crossfade's two clips are always rendered together.
- The final render joins the pieces and applies everything timeline-wide: effects, masks, pointer, overlays, audio tracks.
- Free space for the pieces (4× the export estimate) is checked on the temp drive first.
- Progress: the pieces are the first half of the bar. Cancel works in both steps. The hardware-encoder fallback reuses the pieces.
- Shorter timelines render exactly as before.

**Result** (same project, 40 cuts):

| | Peak memory | Time | Frames | SSIM vs one pass |
|---|---|---|---|---|
| One pass | 5563 MB | 326 s | 6000 | — |
| In pieces | **1604 MB** (6 runs: 1534, 1600, 1595, 1604, 1597, 1372) | **273 s** | 6000 | 0.9985 |

**Remaining limits:**

- Peak memory now depends on the group size and on the timeline-wide layers, not on the clip count. Projects with many overlay layers (text, stickers) still add their own inputs to the final render; not profiled here.
- Pieces need temporary disk space, about 4× the export size. With too little space, the export stops before rendering with the disk-space message.
- One generation of near-lossless re-encoding for long timelines (SSIM 0.9985 measured).
- Real recordings, 1440p/4K, and 8 GB machines not measured.

## 7. Security review

| Area | Finding |
|---|---|
| Local engine auth | Packaged engine (rebuilt today): 403 without a token or with a wrong one, 200 with the right one; constant-time compare; 127.0.0.1 only; CORS limited to the app's origins in release |
| Port race | Seen for real while testing: a port picked by hand was taken in between, and the health check talked to another process. The app picks a fresh port each launch and now retries once. Residual: the health check sends the token to whatever listens on the picked port. Exploiting that needs another local program racing for the port, which can already read the engine's environment as the same user |
| Engine file paths | `_local_file`: absolute paths with a media suffix that exist; read only, never written. UNC paths are accepted (editing from a NAS); the page that sends them is the app's own (CSP, no remote IPC) |
| Archive extraction | `.wipeclip` (`zip.ts`): stored entries only, every offset and size checked against the file, entries read as slices in memory and never written to disk by name, so there is no path traversal. Manifest and recording JSON size-capped (`projectFile.ts`) |
| Export writes | Atomic (temp file, sync, rename); never over a source (new guard) |
| Update integrity | minisign signature checked by the updater plugin against the public key in `tauri.conf.json`; checked and installed from Rust only; refused while recording. Not exercised end to end (needs two signed releases) |
| Logs | Redacted centrally (section 2) |
| Export authorization | Local tickets aren't signature-checked (P1-1, open) |

## 8. Tests executed in this phase

| Suite | Command | Result |
|---|---|---|
| Rust | `RUSTUP_TOOLCHAIN=1.98.0-x86_64-pc-windows-msvc cargo test --manifest-path src-tauri/Cargo.toml` | 33 passed, 0 failed, 6 ignored (live capture) |
| Desktop JS | `RUSTUP_TOOLCHAIN=1.98.0-x86_64-pc-windows-msvc npm run desktop:test:js` | 169 passed, 0 failed (the notices tests pass now that `rustc` runs) |
| Backend | `backend/.venv/Scripts/python -m pytest -q` | 80 passed, 7 subtests, 86 s (75 before plus 5 new: 4 segmented export, 1 audio cleanup) |
| Types | `npx tsc --noEmit -p .` and `-p desktop` | pass |
| Lint | `npx eslint` on changed TS | pass |
| Packaged engine | Started by hand on a free port (section 7) | cold start 2.15 s; auth and CORS as expected; audio cleanup 200 on a good file. The broken-file 500 found here is fixed |
| Headless editor | `preview-*.mjs` | **Not run.** The only allowed dev server (Next allows one per folder) was already running from before this phase, stuck in a Turbopack error; it wasn't started here, so it was left alone |
| Export memory | Scratch scripts on synthetic media (section 6) | as reported |

## 9. Build and release smoke test

**Engine.** Rebuilt from the current backend with PyInstaller in a separate build venv, so the dev venv was left unchanged:

```
python -m venv <scratch>/enginevenv
pip install -r requirements-desktop.txt
pyinstaller desktop.spec --noconfirm
```

The new engine replaced the stale 23 Oct copy in `src-tauri/resources/engine` (gitignored build output).

**Installer.** Built with:

```
RUSTUP_TOOLCHAIN=1.98.0-x86_64-pc-windows-msvc WIPECLIP_REQUIRE_ENGINE=1 npm run desktop:build -- --bundles nsis
```

Result:

- Frontend build: TypeScript checked, bundle secret scan passed (45 files).
- Notices: 1196 KB.
- Release Rust build: 17 min 52 s cold, 9 min 44 s for the rebuild with the fixed engine.
- `src-tauri/target/release/bundle/nsis/WipeClip_0.1.2_x64-setup.exe`, 110.30 MiB, SHA-256 `ea4aa7f01ecacab073a65a31cba953689c4a44331aa83528d6bc624d9d71b0d5`.
- **Unsigned**, with no update bundle (no signing key on this machine).
- **Not installed** on this machine or a clean one.

**Release executable smoke test.** `target/release/wipeclip.exe` with WebView2 debugging:

- The start screen renders from the bundled frontend.
- `local_engine` started the packaged engine: **30.5 s on its first run** from the new location (most likely the antivirus scanning 315 MB of new files), **2.1 s** on the next launch.
- Closing the app ends the app and the engine; no process left behind.
- The log uses the new formatter (`[date][time][target][LEVEL] message`), with no `Users` paths in the new lines.

The first-run delay is worth telling testers about. The 90 s startup timeout in `engine.rs` covers it.

**Not done:**

- install, upgrade or uninstall on a clean Windows 11 machine;
- recording and export in the release build;
- the manual checks E1–E8 (section 4).

## 10. Acceptance criteria

| Criterion | Status |
|---|---|
| Critical recording, project and export paths have reproducible tests | Met for project and export: automated. Recording relies on Phase 7's app runs and the scripted manual procedures here (E1–E3); not re-run in this phase |
| No known P0 unresolved without a documented reason | P0-3, P0-4 and P0-5 fixed. P0-1: build works with the 1.98 workaround; the permanent fix needs an antivirus change (section 1). P0-2 (commit): not done, since committing wasn't requested. P0-6 (diagnostics zip): deferred, documented |
| No source recording overwritten by editing or export | Export refuses source paths (new); exports go through atomic temp+rename; the engine only reads source paths. Manual check E7 pending |
| Clear messages, recoverable data | New: audio cleanup error message; source-overwrite refusal keeps the export for another try. Existing: disk-full, permission and missing-device messages; crash recovery |
| Memory benchmarks and limits documented | Section 6 |
| App builds in the available Windows environment | Yes, with Rust 1.98.0 (section 1) |
