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
| Save → close → reopen (also after upgrade and after uninstall + reinstall) | Listed under Recent projects → Open restores everything, including click data (verified with the single-project format before the library; re-check) |
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
- Videos picked in the open dialog and recordings stay on disk (no copy, no size limit); dropped videos and project-file imports are still copied into the app's storage (IndexedDB), up to 300 MB each.

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
- **ffmpeg is distributed with the desktop app.** The local engine bundles `imageio-ffmpeg`'s static ffmpeg 7.1 (Windows: the gyan.dev "essentials" build, `--enable-gpl --enable-version3`, with libx264/libx265), so the installer ships a GPL-3.0 program. It runs as a separate process, so the app itself isn't affected, but every release must carry the GPL text and a way to get the corresponding source; the notices file does both and points source requests to the feedback page.
- **Content check model**: Marqo `nsfw-image-detection-384` (Apache-2.0), run in numpy by `backend/app/pipeline/nsfw_classifier.py`, weights pinned by revision and SHA-256 and bundled in the engine. It replaced nudenet, whose wheel is AGPL-3.0 despite its MIT metadata; the engine no longer ships nudenet or onnxruntime (about 28 MB smaller).
- **Third-party notices**: `desktop/scripts/notices.mjs` writes `THIRD-PARTY-NOTICES.txt` on every release build: npm packages in the UI bundle, Rust crates and, with the engine, its Python packages, the Python runtime, the content check model (Apache-2.0 text) and ffmpeg with the GPL-3.0 text, both texts from `desktop/notices/`. It ships as a bundle resource; **Open-source licences** on the start screen opens it. Run the build with the Python that built the engine (CI does; locally set `WIPECLIP_ENGINE_PYTHON` if it isn't `backend/.venv`), or the listed Python versions won't match the engine's.

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
- Upgrades: the app updates itself (see Updates), or install the new build over the old one; projects and settings survive.
- The version is in `tauri.conf.json` and `package.json`; bump both per release.
- `src-tauri/tauri.generated.conf.json` is rewritten by every build (CSP); after a local test build it names localhost — run a release build before shipping.

## Projects

The start screen lists every saved project (`src/components/editor/RecentProjects.tsx`): thumbnail, name, clip count, length, disk space, last saved. Open, rename (click the name, or the name field in the editor header) and delete. Projects autosave while editing; **Projects** in the header saves and goes back to the list, and opening another video or recording starts a new project without closing anything for good. Storage (`src/lib/editor/projectStore.ts`, IndexedDB `wipeclip-editor` version 2): a `projects` store keyed by project id, source files once each in `sources` under their own ids. The version 2 upgrade moves 0.1.0's single saved project into the list. On startup, files no project refers to (a crash between adding a video and the first autosave) are deleted. **Videos stay on disk** (`src-tauri/src/media.rs`, `src/lib/platform/media.ts`, `src/lib/editor/sourceFile.ts`): a video picked with the start screen's box (the OS open dialog) and every recording track is edited where it is. It plays through Tauri's asset protocol (streamed with range requests, nothing loaded into memory), the local engine reads it by path (`path` on probe and AI cleanup, `source_paths`/`audio_paths` on export; local mode only, existing absolute media files only, used in place, never moved), and projects keep its path instead of a copy. So these videos have no size limit (the 10-minute export rule still applies) and don't double disk use. The page can only stream files the user approved: picked in the dialog, or media in a recording folder the app knows; approved paths are remembered in `media.json` in the app's config folder (written only by the native side), and anything else gets 403 from the asset protocol. Reopening a project whose video was moved or deleted asks to find it and relinks it. Bytes are read only where they're really needed: waveform and captions (size-capped as before), project files, and the cloud fallback without the local engine. A video dropped on the window (HTML drag and drop has no file path) or opened from a project file is still kept in app storage, with the 300 MB limit. Verified in the release build on Windows 11: a 475 MB, 100 s 1080p video opened from a saved project, played from `http://asset.localhost` with a 9 MB JavaScript heap, and the engine probed it by path; an unapproved file returned 403. The relink prompt is not covered by automated tests (native dialogs). Backend: `tests/test_local_paths.py`, `tests/test_local_path_export.py` (real render of one path source and one upload, in order).

**Project files** (`.wipeclip`, `src/lib/editor/projectFile.ts`): **Save file** in the editor header writes the project with every file it uses into one file through the Save dialog; **Open a project file** on the start screen (or dropping one on it) adds it to Recent projects. The format is a plain ZIP of uncompressed entries (`src/lib/editor/zip.ts`; any unzip tool opens it): `project.json` (format name, version, name, the project, the list of sources) plus `media/<id>/<file name>` per source and `media/<id>.recording.json` for recording details. Only sources the edit uses are written, not undo history. Opening treats the file as untrusted: format and version checked, every source's id, kind, media type (video, audio or image only) and numbers validated, every clip, layer, audio, zoom and mask must point at a source in the file, and sources get fresh ids so a file opened twice gives two independent projects. A file from a newer version is refused with a message. Limits: 4 GB per file (no ZIP64); saving reads the whole file into memory once to hand it to the native side, like exports. Tests: `tests/desktop/projectfile.test.ts` (CRC check value, round trip validated by Python's `zipfile`, rejected inputs).

**Double-click to open**: the installer registers `.wipeclip` (`bundle.fileAssociations`; NSIS writes the association and removes it on uninstall; macOS gets the `co.wipeclip.project` exported type). A launch with a project file in its arguments (Windows), a second launch handed over by the single-instance plugin, or macOS's `Opened` event queues the path in `src-tauri/src/opened.rs` behind a one-time token and focuses the window; the editor (`watchOpenedProjectFiles` in `src/lib/platform`) reads each queued file by token and opens it as a new project. The page can only read files the OS handed over. Files over 2 GB are refused there (they're read into memory) with a pointer to "Open a project file", which keeps them on disk. Verified on Windows 11 with the release build: cold start with a file argument, and a second launch with another file while running. macOS: not run. Tests: `tests/desktop/projects.test.ts` (in-memory IndexedDB via `fake-indexeddb`, a dev dependency only).

## Editing by text

**Transcript** in the editor toolbar (`src/components/editor/TranscriptPanel.tsx`): transcribe the timeline's speech on the device (the auto-captions model), then click a word to jump to it, Shift+click another to select the words between, and **Cut** them, or **Remove filler words** (um, uh, erm, ...). Each selection becomes a ripple cut from the first word's start to where the next word begins (so the pause goes too); several are applied last-first as one undo step (`src/lib/editor/wordEdit.ts`). Auto captions also keep their words as the transcript. The transcript (`project.transcript`, timeline time) follows ripple cuts and inserts; any other change of the timeline's length (trim, speed, delete) marks it out of date and the panel asks to transcribe again instead of cutting at wrong times. When the project has captions, they are rebuilt from the remaining words after a cut (so the cut words don't stay on screen; hand edits to caption text are replaced). Tests: `tests/desktop/wordEdit.test.ts`; checked in the editor: cutting two words removed 0.9 s, two fillers 1.1 s more, undo restored it.

## Audio cleanup

Clip panel > **Clean up audio** (desktop app): the clip's sound for its trimmed range is cleaned on the local engine (`/api/audio/clean`, `backend/app/pipeline/audio_clean.py`) and put on its own audio track in place of the clip's sound, like Extract audio, so the preview and the export play the same file; Undo restores the original. Steady background noise (fan, hum, hiss) is reduced with ffmpeg's `afftdn` at the clip's measured noise floor (10th percentile of 50 ms windows at full bandwidth; afftdn's own noise tracking barely reduced anything when measured), a 70 Hz high-pass removes rumble, and one fixed gain brings the loudness to -16 LUFS under a -1.5 dBTP peak (not `loudnorm`'s dynamic mode, which lifted the quiet gaps and the leftover noise with them). Measured on a tone under white noise: signal-to-noise 4.3 to about 24 (about +15 dB), speech level kept at 97%, loudness -16.0 LUFS. It doesn't separate voices from music or remove one-off sounds. Local engine only and free; the cloud backend answers 404. Same speed-1x / no freeze / no reverse rule as Extract audio. Tests: `backend/tests/test_audio_clean.py`.

## Image tools

**Image tools** on the start screen and in the editor header opens the website's three tools over the editor (`desktop/app/ImageTools.tsx`): remove background, sharpen photo, grab a video frame. Same rules as the website (`src/lib/imageTool.ts`): one free low-resolution preview a day per tool, full resolution for a credit when signed in. Background removal and sharpening run on the cloud backend through the site (the desktop engine doesn't bundle their models); the frame grabber runs in the app. Results save through the Save dialog (kind `image`, PNG). **Needs the website deployed**: `/api/remove-background`, `/api/sharpen-image` and `/api/frame-grab` now accept the desktop bearer token (`getRequestAuth`) and answer CORS for the desktop origins; `tests/desktop/cors.test.ts` checks every route the app calls does.

## Canvas frame

Canvas panel > **Frame**: None, Subtle, Card, Floating, or custom padding (0-20% per side), corner radius (up to 10% of the canvas's short side) and shadow. The main video becomes a card on the background, the usual look for screen recordings. One definition (`CanvasFrame` in `src/lib/editor/types.ts`; `frameInset`/`frameShadow` in `timeline.ts`) drives both sides: the padding shrinks the video box in `videoBox()`, so focus zooms, click rings, the drawn cursor and masks follow it, and the export applies the same factor (`editor.py _clip_video_chain`). Corners: CSS `clip-path: inset(... round r)` in the preview, an antialiased PIL alpha mask with `alphamerge` in the export. Shadow: CSS `box-shadow` on an element under each video slot; in the export a PIL-blurred rounded rectangle (sigma = half the CSS blur, offset in the card's own rotated frame, nothing under the card), rotated and faded with the clip. Free, not a premium feature. Measured parity on a 640x360 Card render: every sampled pixel within a few levels of the preview. Tests: `backend/tests/test_frame_export.py`. Gradient backgrounds are drawn by the export as an image interpolated exactly like the preview's CSS `linear-gradient` (`_gradient_image`); ffmpeg's `gradients` source jumped to the second color near the top. Measured within 3 levels of CSS over the whole height.

## Export progress, cancel, notification

With the local engine, an export shows real progress: "Checking your videos…" while sources are read and screened, then a bar with the percentage rendered and an estimate of the time left. The client sends a random `job_id` with the export and polls `GET /api/jobs/{id}` on the engine (`backend/app/progress.py`); ffmpeg runs with `-progress`, so the figure is seconds of output written out of the timeline's length. **Cancel export** posts `/api/jobs/{id}/cancel`, which kills ffmpeg at once (the export request then answers 409 "cancelled") and returns the dialog to its settings. When an export finishes or fails while WipeClip's window isn't focused, the OS shows a notification (`notify_if_away`, `src-tauri/src/notify.rs`; Rust-only use of the notification plugin, no page permissions). The saved file's "Show in folder" button is unchanged. Without the local engine (cloud backend, website) the bar stays indeterminate: progress is in-process only, and the cloud may run jobs on RQ workers or another instance. Tests: `backend/tests/test_export_progress.py` (real render: progress only rises and ends cleared, cancel stops ffmpeg within seconds and answers 409, ids validated). Not yet clicked through in the installed app (needs a signed-in export against a site that issues local tickets).

## Export: encoders, output checks, disk space, benchmark

`backend/app/pipeline/encoders.py`, used by `editor.render_export`.

- **Encoder**: the desktop engine uses NVIDIA NVENC (`h264_nvenc`, preset p5, VBR constant quality) when a 1 s test encode works on first use, otherwise libx264. If an export fails with NVENC or its file doesn't check out, it's rendered again with libx264, and NVENC isn't tried again that session. The log line says only the error's kind, never ffmpeg's text (it can contain paths). The cloud backend always uses libx264. Intel Quick Sync (`h264_qsv`) works but isn't picked automatically (see the table). `WIPECLIP_ENCODER=libx264|h264_nvenc|h264_qsv` forces one. AMD AMF and Media Foundation weren't tested (no AMD GPU; Media Foundation's H.264 refused the frames) and aren't used. All of these are in the bundled ffmpeg build already, so licensing is unchanged.
- **Quality calibration**: NVENC `-cq` = CRF + 6 and Quick Sync `-global_quality` = CRF − 4 give at least libx264 CRF 20's SSIM, scored against a CRF 8 render of the same graph, on both a real screen recording and high-motion 1440p60 footage (`.bench/calibration.jsonl`). At that quality hardware files are larger: NVENC 1.3–1.5×, Quick Sync 1.2–2.1×.
- **Every output is checked** before it's returned: it exists, has the expected streams (video and/or audio), the planned size (MP4), length within max(0.3 s, 3 frames), and its last 1.5 s decodes without errors. A cut-off file fails the last check.
- **Disk space**: before rendering, free space at the output folder must cover a generous estimate (0.15 bits per pixel per frame + 200 MB). Otherwise, or when ffmpeg reports a full disk mid-render, the export answers 507 `disk_full` with the space needed and free, and the project is unchanged. The temporary folder is removed on success, failure and cancel (tested).
- **One log line per export**: format, size, fps, length, clip count, encoder, render time, file size.

**Benchmark** (`backend/bench/export_bench.py`, real export graph, ffmpeg process measured with Windows APIs). Machine: i7-9750H (6 cores / 12 threads), 15.9 GB RAM, GeForce GTX 1650 (driver 32.0.15.7602) + UHD 630, Windows 11. Media: a real 300 s 1080p30 desktop capture from the native recorder (9,001 frames, 0 dropped, A/V within 22 ms of the clock) plus synthetic 1440p60 high-motion and A/V-sync clips. All 18 outputs passed the output check.

| Project | libx264 | NVENC | Quick Sync | Notes |
|---|---|---|---|---|
| Short: 60 s 1080p30 + system audio | 22.6 s, 745 MB, 2.2 MB | **15.9 s**, 536 MB, 2.9 MB | 24.7 s, 361 MB, 2.6 MB | SSIM 0.9982 / 0.9983 / 0.9982 |
| Long: 300 s 1080p30 + audio | 99.0 s, 757 MB | **76.0 s**, 540 MB | 99.0 s, 372 MB | 3.0× / 3.9× / 3.0× real time |
| Gameplay: 60 s 2560×1440 60 fps | 74.9 s, 1.2 GB, 124 MB | **51.4 s**, 708 MB, 186 MB | 66.6 s, 458 MB, 259 MB | Slower than real time on CPU |
| Clip sound + mic + system audio | 20.3 s | **15.0 s** | 20.2 s | Max A/V and mic offset 0 ms (10 ms measurement step), 11/11 flashes matched |
| 40 cuts, each with a zoom (200 s) | 234 s, **9.5 GB** | 237 s, 10.0 GB | 219 s, 10.5 GB | After the memory fix below: 215 s, **8.3 GB** (libx264) |
| 6 crossfades + 12 text layers (117 s) | 80 s, **11.7 GB** | 71 s, 11.6 GB | 88 s, 11.7 GB | After the fix: **57 s, 2.2 GB** (libx264), 49 s, 2.0 GB (NVENC) |

NVENC is 1.3–1.5× faster when the graph isn't the bottleneck. With 40 clips the filter graph is (all encoders ~0.9× real time). Quick Sync ranged from 9% slower to 11% faster than libx264, for larger files, so it isn't automatic.

**Memory found and fixed**: still layers (text, stickers, images, shapes) were looped from t = 0 at the output frame rate, so ffmpeg decoded and queued every frame before each layer appeared: about 470 MB per layer on a 1080p timeline. They're now looped for their own length and shifted into place, like video layers (`test_late_layers_show_only_in_their_time`). Clip decoders are capped at 2 threads once there are more than 2 clips (24 clips: 5.6 → 3.5 GB, same speed).

**Still open**: every clip keeps its own decoder open for the whole render, about 200 MB per 1080p clip. A 10-minute recording with 40 accepted pause cuts needs ~8 GB, which would page heavily on an 8 GB machine. The fix is rendering in segments (see the beta report).

## Updates

The app checks `https://github.com/sampathdp/wipeclip-releases/releases/latest/download/latest.json` 10 s after launch and every 6 hours (`src-tauri/src/updater.rs`, `UpdateBanner` in `desktop/app/DesktopShell.tsx`). A newer version shows a banner. **Update now** downloads it, verifies its signature, installs it (Windows: the NSIS installer in passive mode) and restarts; **Later** hides that version until a newer one appears. Nothing installs without the click, and installing is refused while a recording is being written. Debug builds never check.

Update bundles are signed with a minisign key, separate from code signing. The public key is in `tauri.conf.json` (`plugins.updater.pubkey`). The private key and its password were generated on the release maintainer's machine (`~/.tauri/wipeclip-updater.key`, `~/.tauri/wipeclip-updater.password`) and must exist **only** there, in a password manager backup, and as repository secrets `TAURI_SIGNING_PRIVATE_KEY` (the key file's contents) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. **If the key is lost, installed apps can never be updated again** - users would have to reinstall by hand.

Releasing a version needs no local setup: on GitHub, **Actions > Desktop > Run workflow**, branch `master`, set **release** to `patch` (or `minor`, `major`) and run it. The workflow's `version` job runs `desktop/scripts/release.mjs` itself (commit and tag pushed as `github-actions[bot]`), then builds and publishes that tag in the same run, as in steps 2–3 below. Leave **release** at `none` for a test build that publishes nothing. If `master` is branch-protected, allow GitHub Actions to push to it, or the `version` job fails.

Or, from a clean `master` on your machine:

```sh
npm run desktop:release -- patch      # or minor, major, or an exact version like 0.2.0
```

1. `desktop/scripts/release.mjs` sets the version in `package.json` (and its lock), `src-tauri/tauri.conf.json`, `Cargo.toml` and `Cargo.lock`, commits, tags `desktop-v<version>` and pushes both.
2. The tag push starts `desktop.yml`, which builds both platforms with the signing key; `desktop/scripts/update-manifest.mjs` checks that the tag matches the version, renames the assets and writes `latest.json`.
3. When every platform has built, the release is **published** in the releases repo (Windows installer, macOS DMG and update tarball, fixed-name copies of both installers, `latest.json`) as the latest release. Installed apps show the update banner on their next check (launch, or every 6 hours), and the website's download buttons serve it. If any platform fails, nothing is published.

There's no manual check before users get it, so try the build first when a change is risky: run the workflow by hand on `master` (Actions > Desktop > Run workflow) and install the artifact.

Releases live in a separate **public** repository, `sampathdp/wipeclip-releases` (`RELEASES_REPO` in `desktop.yml`, which must match `plugins.updater.endpoints`): the updater and the website's download buttons fetch release assets without authentication, and this code repository can stay private. One-time setup:

- Create `sampathdp/wipeclip-releases` as a public repository with at least one commit (a README), so releases can be created in it.
- Create a fine-grained personal access token limited to that repository with **Contents: read and write**, and add it to this repository as the secret `RELEASES_TOKEN`. Release tags fail without it.
- On the website, set `NEXT_PUBLIC_DOWNLOAD_WINDOWS_URL=https://github.com/sampathdp/wipeclip-releases/releases/latest/download/WipeClip-Windows-x64-setup.exe` and `NEXT_PUBLIC_DOWNLOAD_MAC_URL=https://github.com/sampathdp/wipeclip-releases/releases/latest/download/WipeClip-macOS-AppleSilicon.dmg` (`src/lib/download.ts`), then redeploy. Leave the Mac one empty until a Mac build is published; its button shows "Coming soon". Builds without `TAURI_SIGNING_PRIVATE_KEY` (local and PR builds) produce no update bundles but otherwise work; release tags fail without it (`WIPECLIP_REQUIRE_UPDATER`).

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
- Exports up to 10 minutes. Videos picked in the open dialog and recordings open at any size; dropped videos up to 300 MB.
- Windows: the drawn smooth cursor needs the native capture with "Leave the mouse pointer out of the video" (Windows 10 2004+, `IsCursorCaptureEnabled`); old WebView2 captures always include the system pointer, so those get click highlights only.
- Export with audio runs ~2× slower than the same graph without (see Performance).
- Captions are uppercased by the default caption style and SRT/VTT take the styled text.
- See [FOCUS.md](FOCUS.md), [TUTORIAL.md](TUTORIAL.md) and [RECORDER.md](RECORDER.md) for feature-level limitations.

## Remaining release blockers (prioritized)

1. **Deploy the backend fixes before or with the desktop release.** Without them exports silently omit privacy masks and click highlights, show rings early, and render recordings at their average frame rate. (Bugs 1–4 are server-side.)
2. **Code signing.** Windows installer is unsigned (SmartScreen "unknown publisher"); macOS needs Developer ID signing + notarization (CI secrets).
3. **macOS build and full manual pass** on a real Mac (permissions, system audio absence, Retina coordinates, export, uninstall).
4. **Signed-in production test**: export and download at 1080p, credits, Google sign-in deep link `wipeclip://auth/callback` (Supabase redirect URL must be configured).
5. **ffmpeg source requests**: someone must answer them (see Dependencies and licensing). The notices file and the nudenet replacement are done.

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
10. Close app; reopen; the project is under Recent projects; Open; everything there. Rename from the list and from the header; Delete asks first and frees the space. Opening another video keeps the first project in the list. A project saved by 0.1.0 (single-project format) shows up in the list after upgrading.
11. Export signed out (720p) and signed in (1080p); open the file in the system player; check zoom, rings, mask, captions, audio sync, 30 fps. *(signed out ✓; signed in not run)*
12. AI Cleanup on a short clip. *(API ✓ via dev:smoke; in-app run not done)*
13. Upgrade install over the previous version; project kept. *(✓)*
14. Uninstall; recordings kept; reinstall; project kept. *(✓)*
15. macOS only: deny then grant Screen Recording, Microphone, Camera, Input Monitoring; each shows a clear message. *(not run)*

## How this was tested

The installed app was started with WebView2's DevTools port (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`) and driven with the helpers in `tests/desktop/manual/` (`cdp.mjs`, `desktop-recording.mjs`) plus Windows UI Automation for the native dialogs. Real mouse clicks were made only after checking that the point under the cursor belonged to WipeClip's own window. Exports were pulled from the app and checked with ffmpeg (probe, full decode) and frame-by-frame comparison against the source recording.
