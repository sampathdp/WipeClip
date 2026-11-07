# Implementation status

Newest phase first.

## Scene analysis and a preview fix (7 November 2026)

Details: [SCENE-ANALYSIS.md](SCENE-ANALYSIS.md).

**Done and verified by tests.**
- The Draft can "Read the screen" (desktop, on this computer).
- Results: scenes with evidence and confidence; chapters titled from on-screen headings, apps, addresses, commands or speech; cuts for silent, still, input-free waiting; annotations naming clicked buttons and terminal commands; privacy masks for possible sensitive text.
- Privacy masks need one accept each, and export warns about unreviewed ones.
- A Scenes tab lists the scenes with frame previews.
- OCR: PaddleOCR PP-OCRv3 English, bundled, about 11 MB, on the existing onnxruntime.
- Measured on an i7-9750H: Quick takes 9–13 s for a one-minute 1080p recording.
- **Preview fix:** after the playhead had touched the end of the recording (played to it, or dragged to the edge), the preview stayed on one frame for good, because ended videos were never re-seeked or played. Fixed (`mediaSync.ts`, tested), and one failing frame can no longer stop the preview loop.

**Not done.**
- No vision-language model.
- Latin script only.
- Masks don't follow scrolling.
- No real low-end machine or long recordings measured.

**Manual tests still required.**
- In the app: Read the screen on a real tutorial recording, the Scenes tab, privacy review and export, scrubbing after playing to the end.

## Webcam background removal (7 November 2026)

Details: [WEBCAM-BACKGROUND.md](WEBCAM-BACKGROUND.md).

**Done and verified by tests.**
- Webcam layers get Original, Remove, Blur, Image and Video backgrounds, plus edge outline and softness, with no green screen.
- The engine makes one matted file per webcam video (picture over mask) with Google's MediaPipe selfie segmenter (Apache-2.0, 250 KB, bundled), run by the OpenCV it already ships. The preview and the export both read that file, with shared math.
- Measured on an i7-9750H, sustained on a 24 s clip: 20.9 fps for 720p30 with "Fine hair" (color-guided edges), 28.1 fps with "Faster", on the CPU, in the background. The GPU was measured slower for this model, so it isn't used.
- Works on recorded webcams and on video layers added from a file (handed to the local engine once, by key).
- The recorder's camera preview shows Remove or Blur live, and the recording opens in the editor with it applied.
- Green screen on recorded (disk) webcams: layer videos now load with CORS, so the keyed canvas can read them.
- Settings live on the layer (undo, autosave, project files); the matted file is a derived cache.
- The export composites the real matted file in ffmpeg, rendered and checked pixel by pixel for every mode.

**Not done.** The website (no engine there, and frames are never sent to a server for this). Pixel-identical preview and export blur (very close; identical would make the Blur slider slow).

**Manual tests still required.** A real webcam recording through the app UI: preview, seeking, each mode, reopening the project, and export.

## Smart Zoom 2: focus sessions, natural motion, zoom-aware cursor (5 November 2026)

Details: [SMART-ZOOM-2-IMPLEMENTATION.md](SMART-ZOOM-2-IMPLEMENTATION.md).

**Root causes fixed.**

- **Cursor and rings never scaled with the zoom.** Their size ignored the camera.
- **Zoom out and back in between clicks 3–5 s apart.** The merge window was tied to `hold + easeOut + minGap`; Dynamic at 3.5 s gave 7 zoom-outs for 8 clicks.
- **Unnecessary zooms while typing:**
  - shortcuts pressed while typing were placed at the pointer and split the session;
  - typing zooms were capped at 45 s;
  - the camera panned on every line wrap.
- **No-op pans at screen edges.** A point against an edge triggered pans that went nowhere.
- **Preview cursor and masks a frame ahead of the zoomed picture.**

**Functionality implemented.**

- **Focus sessions:** related actions stay in one zoom, or are chained with a pan. The cooldown drops weak zooms that would come right back.
- **Joining never hides an action** that happens elsewhere.
- **Long typing** continues in chained zooms; typing frames the whole line.
- **Recording type profiles:** Tutorial, Demo and Gaming.
- **Natural easing** with a steady perceived zoom rate. Older eases are unchanged.
- **The cursor and rings grow with the zoom** (on by default, can be turned off).
- **Optional recording-relative cursor size**, and "Match recording size" from the display's DPI.
- **Export draws the cursor the same way.** It renders the same per-frame size using static layers (exact for held sizes, a 1 % ladder for transitions, geq beyond 48 layers). A constant-size cursor still sends the old 3-column rows.

**Tests executed.**

| Suite | Result |
|---|---|
| `npm run desktop:test:js` | 259/259 (25 new, `smartZoom.test.ts`) |
| `python -m unittest tests.test_focus_export` | 14/14 (4 new, real ffmpeg) |
| Backend `pytest tests` | 146 passed |
| `tsc` root and desktop, ESLint on changed files | pass |
| `preview-focus.mjs` (4 variants) against `next dev desktop` in headless Chrome | 4/4 pass, no console errors |

**Before/after and performance:** see sections 6 and 7 of the details. For example, Dynamic with clicks 3.5 s apart went from 7 zoom-outs to 0. Analysis of a 60-minute recording takes 102 ms. A 30 s 1080p export with a growing cursor takes 16.3 s, against 13.6 s with a fixed cursor.

**Known limitations.** No visual target detection. The native cursor size is an estimate (22 logical px). Gaming thresholds were not tuned on real gameplay. Transition sizes in the export are within 0.5 % of the preview.

**Manual tests still required.**

- Real Windows recordings at 125/150/200 % scaling.
- macOS Retina and multi-monitor recordings.
- A full export in the Tauri app.
- A subjective review of motion and profiles on real recordings.

**Compatibility.**

- New fields are optional, and older projects open unchanged.
- Projects with a drawn cursor or rings *and* zooms now show them growing with the zoom: the fix, which can be switched off.
- A varying cursor size needs this backend (4-column rows). Deploy the backend before a web build sends them; the desktop app bundles its engine.

## Phase 6: audio quality and camera presentation (31 October 2026)

Details: [AUDIO.md](AUDIO.md).

**Files changed.**

- New:
  - `src/lib/editor/loudness.ts`, `mix.ts`, `programMix.ts`, `audioMixer.ts`, `webcamLayout.ts`
  - `src/components/editor/MixerPanel.tsx`
  - `tests/desktop/audio.test.ts`, `backend/tests/test_audio_mix.py`, `tests/desktop/manual/preview-audio.mjs`
  - `docs/desktop/AUDIO.md`
- Changed (editor):
  - `types.ts`: `AudioClip.clean`, `Project.master`, `camLayout`, `ShapeMask.radius`
  - `shapeMask.ts` (rounded rectangles), `ripple.ts` (ducking regions), `exportProject.ts`
  - `voiceFx.ts` (router moved to `audioMixer.ts`)
  - `PreviewPlayer.tsx`, `OverlayLayer.tsx`, `Panels.tsx`, `VideoEditor.tsx`, `toolsApi.ts` (message)
- Changed (backend):
  - `editor.py`: `master_chain`, mono upmix, `master_gain_db`
  - `audio_clean.py`: delay compensation
  - `main.py`: `masterGain`, clip volume up to 4, audio files for cleanup, mono flags
- Test harness: `preview-highlights.mjs` reads highlight titles from their rename input (the Phase 5 rename made the old selector stale).

**Functionality implemented.**

- **Noise reduction for audio tracks:**
  - Light, Medium or Strong;
  - a cleaned, time-aligned copy made on this computer;
  - Cleaned/Original compare;
  - remove or undo.
- **Loudness normalization:** -14, -16 or -23 LUFS presets. The gain is measured in the editor and applied by the preview and the export, with peak protection and an always-on limiter.
- **Mixer:** video sound plus each track, with meters, volume, mute and solo (solo for listening only). Master meter.
- **Webcam layouts:**
  - circle, rounded or rectangle, in three sizes and four corners;
  - side by side (landscape) or stacked (portrait);
  - placed again when the canvas changes.
- **Sync and level fixes:**
  - The limiter's 5 ms delay.
  - The denoiser's 25 ms delay.
  - Mono sources were 3 dB quiet in the export.
  - No limiter on clip-only mixes.
  - Ducking after ripple edits.
  - Voice effects silent on disk sources.

**Tests executed.**

| Suite | Result |
|---|---|
| `npm run desktop:test:js` | 214/214 (19 new) |
| Backend `pytest tests` | 93/93 (12 new) |
| `preview-audio.mjs` against a production build | 9/9 (meters, measurement within 0.1 LU of ffmpeg, undo) |
| `preview-focus`, `preview-tutorial`, `preview-draft`, `preview-highlights` | pass |
| `tsc` root and desktop, ESLint on changed files | pass |

**Not implemented.** Webcam background removal. The reasons and options are in AUDIO.md; chroma key still works.

**Known limitations.**

- Noise reduction: steady noise only, desktop only, can't be cancelled while running.
- Loudness reads up to about 1.5 LU low on broadband or wide-stereo content (voice within 0.1 LU).
- The preview limiter has no look-ahead.
- Webcam layouts clear the layer's keyframes.

**Manual tests still required.** The routed preview with disk sources in the desktop app (CORS on the asset protocol), real noisy microphone recordings, loudness of a real export with a meter, webcam layouts exported on 16:9, 9:16 and 1:1, and preview mixer CPU on a low-end laptop. Details in AUDIO.md.

**Compatibility.**

- New fields are optional; older projects open unchanged.
- **Export level change:** mono sources now export 3 dB louder, matching what the preview and players play.
- The website's export needs this backend deployed for `masterGain` and video sound above 100 %.

**Recommended next phase.** Run the manual desktop checks above (CORS first), then commit Phases 4–6 in reviewed commits.

## Phase 4: speech-aware editing (29 October 2026)

Details: [SPEECH.md](SPEECH.md).

**Files changed.**

- New: `src/lib/editor/speechEdits.ts`, `tests/desktop/speechEdits.test.ts`, `tests/desktop/manual/preview-transcript.mjs`, `docs/desktop/SPEECH.md`.
- Changed: `src/lib/editor/types.ts` (kinds `filler`, `repeat`, `no-speech`), `src/lib/editor/captions.ts` (`cancelSpeech`, clean worker shutdown), `src/components/editor/useTutorialTools.tsx`, `TranscriptPanel.tsx`, `Panels.tsx` (`SpeechModelNotice`), `VideoEditor.tsx`.
- Test harness: `tests/desktop/manual/cdp.mjs` (`launch({ args })`).

**Functionality implemented.**

- **Review suggestions from the transcript:** filler words (English), immediate repeats and restarted sentences. Each has its timestamp, reason, confidence and an uncertain-timing note, and goes through the existing per-item keep/cut, preview and one-step apply.
- **Pauses checked against the words:** quiet speech becomes review instead of cut, and sound without words is flagged for review.
- **Model consent in the Transcript panel:** it used to download without asking.
- **Cancel** for model download and transcription.

**Tests executed.**

| Suite | Result |
|---|---|
| `npm run desktop:test:js` | 181/181 (7 new) |
| `tsc` root and desktop | Pass |
| ESLint on changed files | Pass |
| `preview-transcript.mjs` against a production build | 10/10 (consent, cancel, offline) |
| `preview-focus` (4 variants), `preview-draft`, `preview-highlights`, `preview-tutorial` | 7/7 pass |

The headless scripts ran against a production build served by a small Node static server. The Phase 3 flakiness was caused by Python's `http.server` dropping chunk requests.

**Known limitations.**

- Fillers are English only.
- Repeats must be exact and immediate.
- Overlapping speakers are merged into one word stream.
- Transcription speed was not re-measured (needs the model download).
- The licence of the downloaded ONNX conversions isn't stated on their model cards. To review.

**Manual tests still required.**

On a real narrated recording:

- transcribe, review the suggestions, preview, accept some, apply, undo;
- check captions and audio sync after the cuts;
- measure transcription time and memory.

**Compatibility.**

- New suggestion kinds are plain strings; older app versions show them like any other suggestion.
- No new stored project fields.

**Recommended next phase.** B3 (diagnostics zip) or P1-1 (signed export tickets) before the Windows beta.

## Phase 3: smart zoom and cursor quality (29 October 2026)

Details: [FOCUS.md](FOCUS.md) ("Suggestion engine" step 4, "Phase 3 before/after", Limitations).

**What already existed (audited, kept).**

- Suggestions from clicks, typing, drags, scrolls, shortcuts and markers, with pacing and follow paths.
- Three easings.
- Edge and canvas-fill handling.
- Manual and edited zooms win over suggestions (`mergeSuggestions`).
- Per-zoom reason.
- Original view and intensity.
- Leave-out ranges and ignored clicks.
- One shared camera and pointer math for preview, masks and export, with tests.

**Files changed.**

- `src/lib/editor/focus.ts`
- `src/lib/editor/focusPrefs.ts`
- `src/components/editor/FocusPanel.tsx`
- `src/components/editor/VideoEditor.tsx`
- `backend/app/pipeline/editor.py`
- Tests: `tests/desktop/focus.test.ts`, `tests/desktop/focusPrefs.test.ts`, `backend/tests/test_focus_export.py`
- Harness: `tests/desktop/manual/cdp.mjs`, `tests/desktop/manual/preview-focus.mjs` (race-free seeding)
- Docs: `docs/desktop/FOCUS.md`, this file

**Functionality implemented.**

- **Back-and-forth pacing.** Alternating clicks get one steady wide zoom instead of whip pans. At 1.2–2 s spacing: camera reversals 8 → 2.
- **Chaining fix.** Before, with 1.2–2 s spacing, the camera was still on the previous spot for 7 of 8 alternating clicks when they happened; now it's on every click.
- **Invalid events.** Events that are NaN, negative, past the end or out of order no longer produce a zoom with no end. They're dropped before analysis.
- **Export blur order** now matches the preview (blur after zoom). Mean pixel difference: 3.29 → 0.35.
- **"Compare with original"** in the Focus panel: preview only, never saved or exported, not an undo step.

**Tests executed.**

| Suite | Result |
|---|---|
| `npm run desktop:test:js` | 174/174 (4 new: back-and-forth, a single trip stays separate, invalid events, compare) |
| Backend pytest | 81 passed (1 new: blur order, discriminates 0.35 vs 3.29) |
| `tsc` root and desktop | Pass |
| ESLint on changed files | Pass |

Headless editor scripts were run against a static production build, since the dev server on port 3100 is stuck. Each of preview-focus `default` and `original`, preview-draft and preview-highlights passed at least once. They are flaky against that build: sleep-based steps sometimes don't find a button or capture empty screenshot samples.

**Known limitations.**

- Drawn cursor and rings don't scale with the zoom (export cost).
- Alternating clicks 3–4 s apart still zoom out and back in between.
- No visual target detection.
- Canvas fill can't bring the outermost edge strip into view.

**Manual tests still required.**

- On a real recording in the desktop app: Analyze, then review a back-and-forth zoom (reason text).
- Compare with original on and off during playback.
- Export a blurred, zoomed clip and compare it with the preview.

**Compatibility.**

- Projects unchanged: no new stored fields.
- Re-analysis of existing recordings gives different suggestions where clicks alternate. Existing zooms stay until re-analyzed; manual and edited zooms are never replaced.
- Exports of zoomed clips with blur now look like the preview, so slightly less blurry than before.

**Recommended next phase.** Make the headless scripts wait on conditions instead of sleeps, so they're reliable against a production build. Then B3 (diagnostics zip) or P1-1 (ticket signing).

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
