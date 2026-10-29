# Implementation status

Newest phase first.

## Phase 2: macOS port and native capture (29 October 2026). Stopped at a blocker: no Mac

Full report: [MACOS.md](MACOS.md).

**Files changed.**

- New: `src/lib/platform/keys.ts`, `tests/desktop/keys.test.ts`.
- `src/components/editor/VideoEditor.tsx`, `src/components/editor/Panels.tsx`, `src/components/editor/TutorialPanel.tsx`, `src/components/editor/HighlightsPanel.tsx`, `src/components/editor/useTutorialTools.tsx`.
- Docs: `docs/desktop/MACOS.md` (new), this file.

**Functionality implemented.**

- **Shortcut hints** name Cmd/Option on a Mac and Ctrl/Alt elsewhere, without a hydration mismatch.
- **API research** done from Apple's documentation data.
- **Windows-assumption audit** done.
- **macOS type-check recipe:** the Rust crate type-checks for `aarch64-apple-darwin` from Windows.

**Tests executed.**

| Check | Result |
|---|---|
| `cargo check --target aarch64-apple-darwin` (stand-in cc/ar, Rust 1.98.0) | 0 errors, 4 expected warnings |
| `tsc` (root and desktop) | Pass |
| ESLint on changed files | Pass |
| `npm run desktop:test:js` | 170/170 |

**Not done, and why.** No Mac is available, so native ScreenCaptureKit capture, macOS permissions, audio tracks, pause/resume and recovery were neither implemented nor tested. Writing about 1000 lines of capture code that can't be run would be unverifiable. The design is in MACOS.md section 4.

**Known limitations.**

- macOS has never been built or run.
- System audio is unavailable on macOS.
- Recording on macOS uses the WebView fallback (macOS 13+).

**Manual tests still required:** MACOS.md section 5 (M1–M10) on a real Mac.

**Migration or compatibility concerns:** none. Hint text only.

**Recommended next phase:** native capture once a Mac (or a CI macOS build, after your approval to push) is available; otherwise continue with Windows beta items (B3 diagnostics zip, P1-1 ticket signing).

## Phase 1: Windows stability and release hardening (29 October 2026)

Full report: [WINDOWS-STABILITY.md](WINDOWS-STABILITY.md).

**Files changed.**

Rust:

- `src-tauri/src/redact.rs` (new)
- `src-tauri/src/lib.rs`, `src-tauri/src/media.rs`, `src-tauri/src/export.rs`, `src-tauri/src/opened.rs`, `src-tauri/src/engine.rs`

Backend:

- `backend/app/pipeline/editor.py`, `backend/app/pipeline/audio_clean.py`
- Tests: `backend/tests/test_segmented_export.py` (new), `backend/tests/test_audio_clean.py`

Frontend:

- `src/lib/editor/creatorPresets.ts`
- Tests: `tests/desktop/creatorPresets.test.ts`, `tests/desktop/manual/preview-highlights.mjs`

Docs:

- `docs/desktop/WINDOWS-STABILITY.md` (new)
- `docs/desktop/CREATOR.md`, `docs/desktop/BETA-READINESS.md`, `docs/desktop/README.md`, this file

**Functionality implemented.**

- **Log redaction.** All log lines are redacted centrally: no file paths or user names, including forwarded engine output. Blocked navigations log only the origin.
- **Source protection.** An export can't be saved over a source video or recording track.
- **Long timelines render in pieces** from 13 clips on. 40 cuts: 5563 MB down to 1604 MB peak, 326 s down to 273 s, SSIM 0.9985.
- **Crossfade fix.** Exports with crossfades no longer lose a frame at every later cut. This was a pre-existing bug: 18 clips with 2 crossfades lost 1.2 s.
- **Audio cleanup.** An unreadable file now gives a clear message instead of a 500, and nothing in the error names the file.
- **Engine hardening.** The engine retries once on another port if it exits during startup; the dev origin is allowed in debug builds only.
- **Preset labels** no longer name third-party platforms.

**Tests executed.**

- Rust (Rust 1.98.0): 33 passed, 6 ignored.
- Desktop JS: 169/169.
- Backend pytest: 80 passed, 7 subtests.
- `tsc` root and desktop: pass.
- ESLint on the changed files: pass.
- Packaged engine (auth, CORS, audio cleanup): pass after the fix.
- Release build: the NSIS installer was produced; the release executable launched and started the bundled engine.
- Headless editor scripts: **not run**. The only dev server Next allows in that folder was already running from before this phase, stuck in a Turbopack error, and was left alone.

**Known limitations and unresolved bugs.**

- **Avast and Rust.** Avast deletes `rustc.exe` 1.99.0, so builds here need `RUSTUP_TOOLCHAIN=1.98.0-x86_64-pc-windows-msvc`.
- **Uncommitted work.** Phase 5–6 and Phase 1 changes are uncommitted.
- **Still open:** P1-1 (local tickets not signature-checked), B3 (diagnostics zip), D2 (relink each track).
- **Unsigned installer.** It was not installed on a clean machine.
- **First engine start** after install can take about 30 s while the files are scanned.

**Manual tests still required:** WINDOWS-STABILITY.md section 4 (E1–E8): real microphone sync, webcam, window/area capture, crash recovery on the release build, signed-in exports, export cancel, source-overwrite refusal, and checking the log for paths.

**Migration or compatibility concerns.**

- The preset id `youtube` was renamed `landscape`. It's used only at click time and never stored, so no migration is needed.
- Log line layout is unchanged.
- Exports from long timelines now use the temp drive for pieces, about 4× the export size, checked before rendering.

**Recommended next phase:**

1. Commit this work, once you approve.
2. Run E1–E8 on a clean Windows 11 install of `WipeClip_0.1.2_x64-setup.exe`.
3. Then Phase 3 (export ticket signing), or B3 (diagnostics zip) before the beta.

## Phase 0: product and engineering audit (29 October 2026)

**Files changed:**

- `docs/desktop/PRODUCT-GAP-AUDIT.md` (new)
- `docs/desktop/implementation-status.md` (new)

No application code changed.

**Functionality implemented:** none (audit only).

**Tests executed** (Windows 11 Pro 10.0.26200; full detail in PRODUCT-GAP-AUDIT.md section 9):

- `npm run desktop:test:js`: 167 passed, 2 failed. Both failures are `notices.test.mjs`, because `rustc` is missing.
- `npm run desktop:test`: did not start (exit 101, `rustc -vV`).
- Prebuilt Rust test binary run directly: 29 passed, 6 ignored.
- Backend `pytest -q`: 75 passed, 7 subtests.
- `tsc --noEmit -p .` and `-p desktop`: pass.
- ESLint on the editor and recorder sources: no findings.

**Known limitations and unresolved bugs:**

- D0: the Rust toolchain is broken, so nothing in Rust can be built and there is no installer.
- Phase 5–6 work is uncommitted.
- D1: Rust logs contain file paths.
- New: engine tracebacks and ffmpeg stderr also put file paths in the app log.
- New: preset labels and docs name third-party platforms.
- B2: export memory grows per clip.
- B3: there is no diagnostics export.
- New: desktop export tickets aren't signature-checked by the local engine.
- D2, D4, and the engine port race.

**Manual tests still required:** PRODUCT-GAP-AUDIT.md sections 4 and 9 (installer, real microphone, window/area/webcam, 8 GB and non-NVIDIA machines, signed-in export, updater, macOS).

**Migration or compatibility concerns:** none from this phase. Phase 3, if done as proposed, changes the ticket format between the site and the desktop engine, so the site must keep issuing tickets older app versions accept until they update.

**Recommended next phase:** Phase 1 (build baseline: repair `rustc` or build in CI, commit Phase 5–6, all suites green), then Phase 2 (privacy and policy fixes).
