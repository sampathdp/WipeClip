# Screen recorder (desktop app, Phase 1)

The desktop app can record the screen, a window or a selected area, with system audio, microphone and webcam as separate tracks, plus a timestamped log of mouse and keyboard activity for later cursor effects and auto zoom. Recordings are written to a folder on the user's disk and open directly in the existing editor. Nothing is uploaded unless the user later exports or runs AI cleanup, which work exactly as before.

Open it from the editor: **Record your screen** on the start card, or **Record** in the editor header.

## How it works

| Piece | Where | What |
|---|---|---|
| Recorder UI | `src/components/recorder/ScreenRecorder.tsx`, `parts.tsx` | Choose source, configure video/audio/metadata, countdown, record, review |
| Session | `src/lib/recorder/session.ts` | Runs one `MediaRecorder` per track, streams 1-second chunks to disk, drives pause/resume, polls input events, writes the manifest |
| Format | `src/lib/recorder/format.ts` | Manifest (`recording.json`) and event log (`events.jsonl`): types, versioning, parse/serialize |
| Timing | `src/lib/recorder/clock.ts` | Recording time (pauses excluded) and the page-to-native clock sync |
| Coordinates | `src/lib/recorder/coords.ts` | Desktop to capture to region to video pixel mapping; display matching |
| Events | `src/lib/recorder/events.ts` | Converts native input events to recording time and capture coordinates |
| Editor import | `src/lib/recorder/importPlan.ts`, `VideoEditor.tsx` `importRecording` | Builds the project: screen clip, audio tracks, webcam layer |
| Reading back | `src/lib/recorder/bundle.ts` | Preview, open in editor, recovery of interrupted recordings |
| Native: screen capture (Windows) | `src-tauri/src/capture/` | In-app source list and thumbnails (`sources.rs`), Windows.Graphics.Capture + D3D11 video processor + Media Foundation H.264 (`video.rs`), WASAPI loopback + AAC (`audio.rs`), recording clock (`clock.rs`) |
| Source picker | `src/components/recorder/SourcePicker.tsx` | Displays and windows with thumbnails, shown instead of the system share dialog on Windows |
| Mini player | `src/components/recorder/MiniPlayer.tsx`, `desktop/app/mini/`, `recorder_mini` in `src-tauri/src/lib.rs`, `capabilities/mini.json` | Small always-on-top window while recording (Windows): live preview of what is recorded (`capture_preview`), time, Pause/Marker/Stop. Excluded from capture, so never in the video |
| Native: files | `src-tauri/src/recording/` | Folder creation (never overwrites), chunk appends with periodic fsync, atomic manifest writes, read/reveal/delete limited to known folders |
| Native: input | `src-tauri/src/input/` | Windows low-level hooks / macOS listen-only event taps, cursor polling, active window, keyboard privacy filter (`keys.rs`) |
| Native: hotkeys | `src-tauri/src/shortcuts.rs` | Global shortcuts, registered only while the recorder is open |
| Bridge | `src/lib/platform/recorder.ts` | `invoke` wrappers for all of the above |

**Capture backend (Windows).** The screen and system audio are captured by the app itself: Windows.Graphics.Capture for the frames (no browser share bar, no yellow border on Windows 11, the pointer can be left out), a D3D11 video processor to scale and convert to NV12 on the GPU, the Media Foundation H.264 encoder (hardware when available, software otherwise) into fragmented MP4 (`screen.mp4`, readable after a crash), and WASAPI loopback of the default output device into AAC (`system-audio.m4a`; silence is written while nothing plays, so it always spans the recording; a device change reopens the new default). Frames arrive only when the screen changes; the capture keeps a copy of the newest one and a frame clock encodes it at a constant rate (frame n at n/fps, repeats included) until the stop. Constant timing matters: fragmented MP4 stores per-frame durations, and Chromium/ffmpeg and Media Foundation read uneven ones differently (measured: 6.56 s vs 7.16 s for the same file). The page picks the source in its own picker (`capture_sources`, `capture_thumbnail`), the preview is a canvas fed with thumbnails, and "Hide WipeClip from the recording" uses `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`. Microphone and webcam still use `getUserMedia` + `MediaRecorder`. The page syncs its clock to the capture clock (QPC, `capture_clock`, best of 5 round trips) and sends pause/resume/stop with their exact time, so IPC delays (measured up to ~90 ms for a pause) don't shift the native tracks against the page's. The manifest records `capture.backend: "native"`.

**Capture backend (macOS, fallback).** Video and audio are captured with the WebView's own media stack: `getDisplayMedia` (screen or window), `getUserMedia` (microphone, webcam) and `MediaRecorder`, which are hardware-encoded on both platforms and need no bundled encoder or extra native dependency. Windows uses WebView2 (Chromium); macOS uses WKWebView (Safari engine). They don't behave the same, see Limitations.

**Region recording.** The full surface is recorded and the selected area becomes the clip's crop in the editor. That keeps the original intact, lets the user adjust the crop later, and avoids a per-frame canvas pipeline that would stall when the window is minimized.

**Sync.** All `MediaRecorder`s are started in the same tick. Each track's `start` event time gives its offset from the screen track (`startOffsetMs`), which the editor import uses to line up audio and webcam. Pause and resume act on every recorder in the same tick; the shared `RecordingClock` records the pause spans.

**Interaction metadata.** The native monitor timestamps events in microseconds since it started. The page syncs that clock with its own (5 round trips, lowest latency wins, error at most half a round trip), maps each event to recording time, and drops events from before the start, during pauses and after the stop. On resume it writes the pointer's current position and the active window again, so playback never animates across the cut. The pointer is polled at 30, 60 or 120 Hz and stored only when it moves. Clicks, scrolls and keys come from OS hooks.

## Recording folder format (v1)

```
WipeClip Recording 2026-10-11 at 14.03.22/
  recording.json      manifest, status "recording" until finalized, then "complete" (or "recovered")
  screen.mp4          video only (MP4/H.264, or WebM on older WebView2)
  system-audio.m4a    optional (Windows)
  microphone.m4a      optional
  webcam.mp4          optional
  events.jsonl        interaction events
  screenshots/shot-001.png ...
```

All paths in the manifest are relative to the folder. Readers accept any `version` up to their own, refuse newer ones with a clear message, and ignore unknown fields and event types. See the doc comments in `format.ts` for every field.

`events.jsonl`: line 1 is a header (`format`, `version`, `recordingId`, `coordinateSpace`, `timeUnit: "ms"`), then one compact array per event:

| Line | Meaning |
|---|---|
| `["m", t, x, y]` | pointer moved |
| `["c", t, "l"/"r"/"m"/"o", 1/0, x, y]` | button down/up |
| `["s", t, dx, dy, x, y]` | scroll, in notches/lines, dy > 0 = down |
| `["k", t, "Ctrl+Shift+S"]` | shortcut |
| `["i", t, x, y, h]` / `["i", t]` | typing: center and height of the text cursor when the app exposes it (Windows system caret), else no position; at most one per 120 ms, never which key |
| `["b", t, id, label]` | marker |
| `["w", t, app, title or null, [x, y, w, h] or null]` | active window changed or moved |
| `["p", t]` / `["r", t]` | paused / resumed (same t) |
| `["v", t, width, height]` | captured surface size changed |

`t` is recording time in ms. With `coordinateSpace: "capture"`, x/y are fractions of the captured surface (0..1, outside that range when the pointer is on another display); multiply by the video size for pixels, and use `capture.region` to get region-relative values (`coords.ts`). With `"desktop"` (a single window, or the display couldn't be identified), x/y are raw desktop coordinates in `capture.desktopUnit` (physical pixels on Windows, points on macOS).

**In the editor**, the screen source carries `recording` (`MediaSource.recording`: manifest + events, in that source's own time). Clip trims and splits reference source time, so an event at source time `t` shows at timeline position `clipStart + (t/1000 - clip.start) / clip.speed` for the clip that covers it. It is stored in IndexedDB beside the source file, survives reloads and is never sent to the server (export only uploads media files and the project JSON).

## Privacy

- Metadata recording is visible and configurable in the recorder; keyboard capture is **off by default**.
- Keyboard: only shortcuts are stored (Ctrl/Alt/Win or Ctrl/Cmd plus a key, function keys, Esc, Print Screen). Plain typing, Shift+letter, macOS Option+key and Windows AltGr (Ctrl+Alt+key) combinations, which produce characters, are dropped in Rust before anything is buffered. Key names follow the physical key; the produced character is never read. Clipboard contents are never read.
- Typing ("Typing (for auto zoom)", on by default): any key that isn't a shortcut or a modifier records only *that* typing happened, at most every 120 ms, with the text cursor's box when the focused app has a system caret (`GetGUIThreadInfo`; most apps keep one for accessibility tools). No key, character or count is stored. macOS: no text cursor position, and it needs Input Monitoring like shortcuts.
- Window titles are off unless the user enables them (app names and window bounds only otherwise).
- Nothing about recorded content is written to the app log: only "recording started/finished/discarded" and "input monitor started/stopped".

## Permissions

| | Windows | macOS |
|---|---|---|
| Screen / window | none (in-app picker, Windows.Graphics.Capture) | **Screen Recording** in System Settings > Privacy & Security; the app must be restarted after granting |
| System audio | none (loopback of the default output device) | Not available |
| Microphone | Windows privacy setting + WebView2 prompt | **Microphone** prompt (`NSMicrophoneUsageDescription`, entitlement `com.apple.security.device.audio-input`) |
| Webcam | Windows privacy setting + WebView2 prompt | **Camera** prompt (`NSCameraUsageDescription`, entitlement `com.apple.security.device.camera`) |
| Pointer position | none | none |
| Clicks, scroll | none (low-level hooks) | none for listen-only mouse taps on current macOS; reported as unavailable if refused |
| Keyboard shortcuts | none | **Input Monitoring**; the recorder offers "Request access" and "Open settings"; restart after granting |
| Active window | none | none (titles of other apps need Screen Recording, which the recording has) |

`src-tauri/Info.plist` (merged by Tauri) and `src-tauri/Entitlements.plist` (`bundle.macOS.entitlements`) carry the macOS strings and hardened-runtime entitlements. Denials show a message in the recorder with an **Open settings** button (fixed URLs, `open_privacy_settings`).

## Reliability

- Chunks reach disk every second and are fsynced every 5 chunks; the manifest is rewritten every 10 s while recording.
- Write failure, disk under 150 MB, the shared screen going away (user stops sharing, display unplugged, window closed): the session stops itself, finalizes what it has and opens the review screen with the reason.
- Microphone or webcam unplugged mid-recording: the rest keeps recording; the track is marked `endedEarly` and a warning is stored.
- Display resolution or captured window size changes: a `surface` event is stored; coordinates stay normalized.
- App closed or crashed while recording: on exit the native side stops the hooks and fsyncs open files. Next time the recorder opens it lists recordings whose manifest still says `recording` and offers **Recover** (rebuilds the manifest from what is on disk, status `recovered`) or **Delete**.
- Low disk warning in setup and during recording; a recording won't start with under 150 MB free.
- A disk that stops keeping up (unplugged USB drive, network share, a scanner holding the file): chunks the page hasn't written yet are counted every second (`backlogState` in `writer.ts`). From 64 MB waiting in memory the recorder warns; at 256 MB it stops and finalizes what reached disk, instead of growing until the app runs out of memory. Applies to the tracks the page writes (microphone, webcam, events; on macOS also the screen). The native Windows screen and system-audio tracks are written by Media Foundation directly.
- Recording runs off the UI thread: file writes and input handling are async Tauri commands and background threads; the hook callbacks only push into a bounded buffer (200,000 events) so input is never delayed.
- The window keeps recording when minimized (`background_throttling: Disabled`, macOS 14+; Chromium doesn't freeze pages that are capturing).

## Editing recordings (Phase 2)

Focus zooms, click highlights and the drawn cursor are described in [FOCUS.md](FOCUS.md). For a drawn cursor, record with **Leave the mouse pointer out of the video**: the recorder asks the web engine for `cursor: "never"` and stores in `capture.cursorCaptured` whether it was honored (an optional field added to format v1; readers that don't know it ignore it). If it wasn't, the system pointer stays in the video and the editor offers only click highlights, so two cursors never show.

## Hotkeys

Registered only while the recorder is open (shown in the recorder; "unavailable" if another app owns one):

| Action | Windows | macOS |
|---|---|---|
| Start / stop | Ctrl+Alt+R | Cmd+Option+R |
| Pause / resume | Ctrl+Alt+P | Cmd+Option+P |
| Marker | Ctrl+Alt+M | Cmd+Option+M |
| Screenshot | Ctrl+Alt+S | Cmd+Option+S |

## Limitations (Phase 1)

- **macOS screen capture depends on WKWebView's `getDisplayMedia`.** If the installed macOS's web engine doesn't provide it, the recorder says so and recording is unavailable (the editor is unaffected). A native ScreenCaptureKit backend would remove this dependency; it isn't part of Phase 1.
- **No system audio on macOS** (WKWebView doesn't capture it). Windows needs an entire-screen source with "Share system audio".
- **macOS: the OS picker chooses the source.** The app can't preselect a display or window there, and can't hide its own window from a full-screen capture (use "Minimize WipeClip while recording"). On Windows the in-app picker and "Hide WipeClip from the recording" cover both.
- **Protected content is recorded black (Windows).** A window that asks for content protection (`SetWindowDisplayAffinity` with `WDA_MONITOR`, used by DRM video players and some password managers) shows on the monitor but is black in the recording (measured: luma 16 where the window was white, `live_sync::protected_window_records_without_content`). Windows with `WDA_EXCLUDEFROMCAPTURE` (like WipeClip's own mini player) don't appear at all. Nothing works around this, on purpose. See <https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity>.
- **Games and full-screen apps: not verified.** Borderless and windowed games go through the same desktop composition as any window; exclusive full-screen games and anti-cheat protected games haven't been tested and may record black or not at all.
- Windows: minimized windows can't be recorded (they're listed but disabled until restored). A window that is resized while recording is letterboxed into the size it had at the start. Displays larger than 4096×2304 are scaled down to fit the H.264 encoder.
- **Display identification** compares the capture's size with the connected displays. Two identical displays need the user to pick ("Which display is this?"); window captures store events in desktop coordinates plus active-window bounds.
- **Editor limits apply**: recordings open in the editor at any size (they're edited in place in their folder, see RELEASE.md Projects); exports are up to 10 minutes, and longer recordings save fine with a warning.
- Pause relies on `MediaRecorder` closing the gap in the file's timestamps. Verified on Windows/WebView2 (pause excluded from both clock and files, within one frame); verify on macOS (manual step 6).
- Windows: input to elevated (administrator) windows and the secure desktop isn't visible to the hooks.
- The chosen save location is remembered in the app's config folder (`recorder.json`, written only by the native side after the OS folder dialog); if the folder is gone the default Videos/WipeClip is used.
- **Windows (WebView capture, old recordings only): the system pointer is always in the video.** WebView2 reports `cursor: "never"` for display capture even when "always" is requested, while the pointer is in the frames (checked on a real capture). The recorder therefore never trusts that report on Windows, disables "Leave the mouse pointer out", and the editor offers click highlights but not a second, drawn cursor.
- Recording-time 0 is when all recorders are started. The `start` events lag on WebView2 (measured: the H.264 screen recorder's ~0.35 s after the audio ones, all files covering the same span); import also re-aligns events and tracks from the decoded file lengths (`alignRecording`), which corrects recordings made before this fix.

## Build and run

Same as the rest of the desktop app ([README.md](README.md)): `npm run desktop:dev`, `npm run desktop:build`. Tests:

```bash
npm run desktop:test:js   # recorder format, clock, coordinates, events, import plan, writer, mime
npm run desktop:test      # Rust, incl. keyboard privacy filter (input/keys.rs), folder names (recording/paths.rs), input buffer
```

`cargo test --lib capture::video::live -- --ignored --nocapture` records the main display for 3 s with a pause on the machine it runs on and checks the screen and system-audio durations against the clock.

`cargo test --lib capture::video::live_sync::flips_in_the_file_match_the_clock -- --ignored --nocapture` checks recording time against the pictures in the file: a small topmost window turns black and white at known recording times, two before and two after a pause, and ffmpeg (`WIPECLIP_FFMPEG`, or the engine's imageio-ffmpeg in `backend/.venv`) finds each flip in `screen.mp4`. Each must appear once, never before its time and at most 100 ms plus one frame after it; nothing from the pause may appear. `live_sync::long_session` records the primary display with system audio for `WIPECLIP_LIVE_SECS` (default 600) and checks for dropped frames, steady file growth and final lengths; watch the test process's memory from outside.

`node tests/desktop/manual/media-errors.mjs` (app started with `--deny-permission-prompts`, see its header) checks that the real WebView2 throws the error names the recorder's messages (`mediaErrors.ts`) are written for, for refused and missing microphone and camera.

`keys.rs` and `recording/paths.rs` have no crate dependencies and can also be tested without the full toolchain: `rustc --edition 2021 --test src-tauri/src/input/keys.rs -o keys && ./keys`.

## Windows test results (desktop app, real WebView2)

Run on Windows 11 (125% display scaling, 1920×1080), built with MSVC 14.44: `cargo test` 18/18; the app started with `npm run desktop:dev` and was driven over WebView2's DevTools port (`tests/desktop/manual/desktop-recording.mjs`; see its header for the flags).

| Check | Result |
|---|---|
| Entire-screen capture through `getDisplayMedia` in WebView2 | Works (auto-selected source, 1920×1080, H.264 MP4) |
| System audio captured as its own track | Works (AAC, 48 kHz) |
| Microphone (Chromium fake device) as its own track, level meter | Works |
| Files written incrementally, manifest finalized `complete` | Works |
| Clock vs decoded length (after the timing fix) | 11.162 s vs 11.16 s; 9.614 s vs 9.58 s; audio offsets 0 |
| Pause/resume | Pause and resume at the same t; no pointer move from the paused span recorded; paused time excluded from the files |
| Marker, screenshot (PNG at full resolution) during recording | Works |
| Low-level hooks: real clicks | Captured as down/up pairs (left button) |
| Cursor mapping on a scaled display | Real cursor moved to (960,540), (1440,810), (480,270) physical px: recorded at exactly x/1920, y/1080 |
| Display identification | `\.DISPLAY1`, scale factor 1.25, primary |
| Open in editor | Imported with Zoom, Audio tracks; no console errors |
| Log privacy | Only "recording started/finished", "input monitor started/stopped" |

Second pass, 28 October 2026 (same machine, Windows 11 Pro 10.0.26200, 1920×1080 at 125%):

| Check | Result |
|---|---|
| Recording time vs the pictures in the file (`live_sync::flips_in_the_file_match_the_clock`, 3 runs) | Every flip in the file exactly one frame after its clock time (+32.4 to +33.1 ms at 30 fps), before and after a pause; nothing from the pause in the file |
| 10-minute recording, 1080p30 + system audio, hardware H.264 (`live_sync::long_session`) | 18,001 frames, 0 dropped; clock 600.010 s, video 600.033 s, audio 600.021 s; screen file +22.3–22.5 MB every 30 s; full decode with ffmpeg 7.1: 0 errors; test process memory flat (private 155 MB → 166 MB, working set 155–170 MB) |
| Protected window (`WDA_MONITOR`) | Recorded black |
| Real app, end to end (`desktop-recording.mjs`) | Native capture + system audio + fake microphone, pause, marker, screenshot; manifest `complete`; cursor probes mapped; no events while paused; opened in the editor with its audio tracks; no console errors |
| Microphone refused / missing devices in the real WebView2 (`media-errors.mjs`) | `NotAllowedError` when refused, `OverconstrainedError`/`NotFoundError` for a missing device, `NotFoundError` with no camera at all - all mapped to messages |

Not run: webcam (no camera on the machine), a real stalled disk (the backlog limit is unit-tested only), crash recovery, multiple displays.

Found and fixed during the first pass:
- the ~0.35 s timing offset;
- WebView2's wrong `cursor` report;
- `window.confirm` always returning a truthy Promise in the desktop app, which silently skipped every confirmation, including "Discard this recording?". It is now a native dialog through `confirm_action`, and lint forbids `window.confirm`.

Not automated: the native confirm dialog itself, system-audio/microphone **content** sync with a clap, webcam, region selection with a real drag, window capture, multiple displays, mic/camera unplugging, crash recovery. These are covered by the manual checklist below.

## Manual test checklist

Run on a real machine for each platform; tick each with the OS version.

1. **Source.** Open the recorder, choose an entire screen, then a window. Preview shows it; resolution label is right. Unplug/disable a second display and check the display picker.
2. **Region.** Select area, drag a rectangle, Done. Record 10 s, open in editor: the clip shows only that area (crop), and Crop in the inspector can widen it.
3. **Audio.** Windows: entire screen with "Share system audio", play a sound. Pick a microphone, check the level meter moves. Record 15 s talking over the sound. In the editor there are separate System audio and Microphone tracks; clap on camera/mic and check audio lines up with the video within a frame or two.
4. **Webcam.** Turn on the webcam, record 10 s. Editor shows it as a corner layer, in sync with the microphone.
5. **Countdown, hotkeys.** 3 s countdown, Esc cancels. With WipeClip minimized, Ctrl/Cmd+Alt/Option+R starts and stops, P pauses, M adds a marker, S saves a screenshot (check `screenshots/`).
6. **Pause/resume.** Record 5 s, pause 5 s (move the mouse a lot meanwhile), resume 5 s. The file is ~10 s with no frozen gap; `events.jsonl` has `p` and `r` at the same t, no `m` lines between them, and an `m` right at the resume.
7. **Metadata.** With pointer, clicks, scroll on: click in each corner of the recorded display. In `events.jsonl` the `c` lines near those times have x/y near 0/1. On a scaled display (Windows 150%, Retina) the values still match the click positions in the video.
8. **Keyboard privacy.** Turn on keyboard shortcuts, type a sentence and a fake password, press Ctrl/Cmd+C, Ctrl/Cmd+Shift+S, F5. Only the shortcut lines appear (`k`), none of the typed text. macOS: first without Input Monitoring (warning shown, rest records), then with it.
9. **Permissions denied (macOS).** Revoke Screen Recording, Microphone, Camera in System Settings; each shows a clear message and "Open settings".
10. **Failure handling.** During a recording: click the system "Stop sharing" bar (auto stop, review opens with the reason); unplug the USB microphone (warning, recording continues); kill WipeClip from Task Manager / Activity Monitor, reopen the recorder, Recover, play it.
11. **No overwrite.** Record twice within the same second (or rename a folder to the next timestamp): the second gets " (2)".
12. **Review.** Preview plays; Retake deletes the folder; Save keeps it; Show in folder opens it; Open in editor replaces the current project after confirming.
13. **Regression.** In the editor: import a normal MP4, trim/split, text, captions, AI cleanup, export; reload and resume a saved project (including one made from a recording).
