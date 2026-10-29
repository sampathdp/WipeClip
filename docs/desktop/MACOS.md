# macOS port (Phase 2)

29 October 2026, branch `feat/recorder-hardening`. **No Mac was available.** Everything here was done on Windows 11. Nothing in this document says macOS works: the app has never been built, run or tested on a Mac.

## Status at a glance

| Area | State |
|---|---|
| Rust crate compiles for macOS | **Type-checked** from Windows (`cargo check --target aarch64-apple-darwin`): 0 errors, 4 warnings (unused native-capture items, expected while macOS has no native capture). Not linked, not run |
| Editor, projects, export engine | Shared code, unchanged; untested on macOS |
| Screen capture | WebView `getDisplayMedia` fallback only (exists since earlier phases); **native ScreenCaptureKit capture not implemented** (see "Blocker") |
| System audio | **Not available** on macOS; the recorder says so (`ScreenRecorder.tsx`) |
| Microphone, webcam | `getUserMedia` in WKWebView; untested on macOS |
| Input events | `input/macos.rs` (listen-only CGEventTap); type-checks; untested |
| Keychain session storage | `keyring` with `apple-native` (`secure_storage.rs`); type-checks; untested |
| Shortcut hints | Fixed this phase: "Cmd"/"Option" on a Mac, "Ctrl"/"Alt" elsewhere |
| Signing, notarization | Configured in CI, never run; no credentials exist in this repository |

## 1. API research (Apple's documentation, checked today)

Availability below was read from Apple's documentation data (`developer.apple.com/tutorials/data/documentation/<path>.json`, `metadata.platforms`):

| API | macOS | Used for |
|---|---|---|
| `SCStream`, `SCShareableContent`, `SCContentFilter` | 12.3 | Display, window and app capture |
| `SCStreamConfiguration.capturesAudio`, `.excludesCurrentProcessAudio` | **13.0** | System audio (without WipeClip's own sounds) |
| `SCContentSharingPicker` | 14.0 | The system's own picker for what to share |
| `SCScreenshotManager` | 14.0 | Single-frame screenshots |
| `SCStreamConfiguration.captureMicrophone`, `SCRecordingOutput` | 15.0 | Microphone in the same stream; direct file recording |
| `CGPreflightScreenCaptureAccess` / `CGRequestScreenCaptureAccess` | 10.15 | Checking or requesting Screen Recording permission |
| `AVCaptureDevice.DiscoverySession` | 10.15 | Camera and microphone device lists |
| `AVAssetWriter` | 10.7 | H.264/AAC into MP4 |

What this means for WipeClip:

- **Native screen capture needs macOS 12.3 or later.**
- **System audio needs macOS 13.0 or later.** It can't be offered below 13, and the UI has to say so.
- The app's `minimumSystemVersion` is 11.0 (`tauri.conf.json`). On 11 to 12.2 only the editor would work, and the recorder would need to explain why it's unavailable.
- **Suggested minimum for recording: macOS 13.** That gives screen, window, area and system audio in one stream, and matches the 13+ the current WebView fallback already needs.
- Using `SCContentSharingPicker` (14+) is optional, since the app already has its own source picker.
- Rust bindings: `objc2-screen-capture-kit` 0.3.2, the same objc2 family Tauri already locks (0.3.2). Licence: Zlib OR Apache-2.0 OR MIT. **Not added yet.**

## 2. Windows-specific assumptions found

| Place | Assumption | macOS state |
|---|---|---|
| `capture/mod.rs` (34 `cfg` sites) | Native capture only on `cfg(windows)`; every command has a `cfg(not(windows))` stub returning "unsupported" | Stubs compile. Should become one platform module per OS behind the same commands (section 4) |
| `ScreenRecorder.tsx:151` | `useNative = platform === "windows" && …` | The frontend already switches to the WebView path on macOS. It needs `nativeSupport.supported` alone once macOS has native capture |
| `ScreenRecorder.tsx` | Display matching in points (macOS) vs physical pixels (Windows) | Already handled |
| `shortcuts.rs` | `CommandOrControl+Alt+R/P/M/S` | Becomes Cmd+Option+R/P/M/S on macOS. None of these are macOS system shortcuts (screenshots use Cmd+Shift+3/4/5). They are registered only while the recorder is open and released after. If another app owns one, the recorder lists it as unavailable (`ShortcutStatus.error`) |
| Editor hint texts | "Ctrl+Z", "Ctrl+D", "Alt+←" hard-coded (12 places) | **Fixed** (`src/lib/platform/keys.ts`). The key handlers already accepted Cmd (`ctrlKey \|\| metaKey`) |
| `recording_default_dir` | `video_dir()/WipeClip` | `~/Movies/WipeClip` on macOS, correct |
| `engine.rs` | `wipeclip-engine.exe` vs `wipeclip-engine`; `CREATE_NO_WINDOW` only on Windows | Handled. On macOS the engine notices that the app has exited by polling `getppid()` (`desktop_engine.py`) |
| `system.rs` | Memory via `sysctl` on macOS | Present |
| `Info.plist` | Microphone and camera usage strings | Present. Screen Recording and Input Monitoring use System Settings permissions and need no key |
| `Entitlements.plist` | `device.audio-input`, `device.camera` for the hardened runtime | Present. No App Sandbox (Developer ID distribution, not the App Store) |
| Updater | `latest.json` with a `darwin-aarch64` entry from CI | Never exercised |

## 3. Changes made this phase (verified on Windows)

- `src/lib/platform/keys.ts` (new): `modKey()`, `altKey()` and `useShortcutKeys()`, which give "Cmd"/"Option" on a Mac in the desktop app or a browser.
  - Prerendered HTML and hydration use "Ctrl"/"Alt"; the real names appear after hydration (`useSyncExternalStore`), so there's no hydration mismatch.
  - Used in `VideoEditor.tsx`, `Panels.tsx`, `TutorialPanel.tsx`, `HighlightsPanel.tsx` and `useTutorialTools.tsx`.
  - Test: `tests/desktop/keys.test.ts`.
- Cross type-check recipe for macOS from Windows (section 6). This is how every future macOS change can be compile-checked before reaching a Mac.

Verified: `npx tsc --noEmit -p .` and `-p desktop` pass; ESLint passes on the changed files; `npm run desktop:test:js` 170/170.

## 4. Blocker: native capture needs a real Mac

Native capture means:

- an `SCStream` delegate receiving `CMSampleBuffer`s on a dispatch queue;
- pixel-format and colour-space handling;
- `AVAssetWriter` sessions for video and system audio;
- the capture clock that `events.jsonl` uses;
- pause/resume by timestamp offset;
- fragmented or periodically finalized files, so a crash keeps what was recorded.

All of this can be type-checked from Windows but **not run**. Writing it without a Mac would produce about 1000 lines of capture code whose behavior is unknown. It would have to stay switched off (`capture_support()` returning false) until tested, which is "mock functionality" by another name. Per the phase instructions, this phase stops here and asks how to proceed (see the end of the conversation).

**Design ready to implement once a Mac is available:**

- **`capture/macos.rs`** behind the existing commands (`capture_support`, `capture_sources`, `capture_start`, `capture_pause`, `capture_stop`, `capture_frame`, `capture_thumbnail`). The `cfg(not(windows))` stubs become `cfg(target_os = "macos")` calls; nothing in the frontend changes beyond `useNative`.
- **Sources:** `SCShareableContent` (displays and windows); area capture as a display filter plus `sourceRect`. Thumbnails via `SCScreenshotManager` on 14+, otherwise one frame from a short stream.
- **Permissions:** `CGPreflightScreenCaptureAccess` before listing. If it's missing, `CGRequestScreenCaptureAccess` opens the system prompt, and the recorder explains that macOS needs the app restarted after granting it.
- **Writing:** `AVAssetWriter`, H.264 video (hardware encoder) into `screen.mp4`, AAC system audio into `system-audio.m4a` (13+, `excludesCurrentProcessAudio`), the same files as Windows so the editor, manifest and recovery code stay shared.
  - **Crash safety:** `AVAssetWriter.movieFragmentInterval` (fragmented MP4, like the Windows writer), so an interrupted recording stays decodable.
- **Clock:** sample-buffer presentation times (host time) mapped to the recording clock that `recording/mod.rs` and `input/macos.rs` share. Pause and resume shift timestamps the same way as `capture/video.rs`.
- **Microphone and webcam:** keep `getUserMedia`/`MediaRecorder` (shared with Windows). Native microphone via `captureMicrophone` only on 15+, and only if WebView microphone sync proves inadequate on a real Mac.
- **Dependencies:** `objc2-screen-capture-kit`, `objc2-av-foundation`, `objc2-core-media`, `objc2-core-video`, `block2`, `dispatch2` (all MIT/Apache/Zlib, objc2 0.3.x).

## 5. Testing on a Mac (exact steps)

Needs: an Apple Silicon Mac on macOS 13 or later (ideally 14 and 15 as well), Xcode Command Line Tools, Node 22, Rust (stable), Python 3.13.

```sh
git clone <repo> && cd unmarkai && git checkout feat/recorder-hardening
npm ci
cp desktop/.env.example desktop/.env.development.local   # fill in the values
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && cd ..
npm run desktop:test           # Rust tests
npm run desktop:test:js        # JS tests
npm run desktop:dev            # debug app
```

Manual checks, recording the macOS version each time:

| ID | Steps | Expected |
|---|---|---|
| M1 | First launch | Start screen; no console errors |
| M2 | Open Record | Screen Recording prompt or explanation; after granting and restarting, the source picker lists displays |
| M3 | Record 30 s with microphone (and webcam) | Microphone prompt and level meter; the recording opens in the editor; microphone in sync (clap) |
| M4 | System audio switch | Disabled, with "System audio can't be captured on macOS with this recorder" |
| M5 | Pause/resume, marker, screenshot (Cmd+Option+P/M/S) | Work while another app is in front; Input Monitoring prompt for shortcuts and typing |
| M6 | Quit (Cmd+Q) mid-recording, relaunch | Interrupted recording offered for recovery |
| M7 | Sign in through the browser | `wipeclip://` link returns to the app; session survives a restart (Keychain item `co.wipeclip.desktop`) |
| M8 | Export 720p | Engine starts (first time can be slow), export saves through the save dialog |
| M9 | Open a `.wipeclip` made on Windows | Opens; relink prompt for videos on the other machine's paths |
| M10 | Editor hints | Tooltips say "Undo (Cmd+Z)"; the shortcut list shows Cmd/Option |

Release build (unsigned, local only):

```sh
cd backend && .venv/bin/pip install -r requirements-desktop.txt && python -m app.pipeline.nsfw_classifier && .venv/bin/pyinstaller desktop.spec --noconfirm && cd ..
mkdir -p src-tauri/resources && cp -R backend/dist/wipeclip-engine src-tauri/resources/engine
WIPECLIP_REQUIRE_ENGINE=1 npm run desktop:build -- --bundles app,dmg
```

An unsigned build is blocked by Gatekeeper. For local testing only: right-click the app and choose Open, or run `xattr -dr com.apple.quarantine WipeClip.app`.

## 6. Type-checking macOS code from Windows

Run this before committing any macOS change, then build on a Mac:

```sh
rustup target add aarch64-apple-darwin --toolchain <toolchain>
CC_aarch64_apple_darwin=<stand-in cc> AR_aarch64_apple_darwin=<stand-in ar> \
  cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-apple-darwin --target-dir <scratch>
```

`objc2-exception-helper`'s build script compiles one Objective-C file. Without an Apple SDK, stand-in `cc`/`ar` scripts that only create empty output files let the build script finish. `cargo check` never links, so this is fine for type-checking. It is **not** a build. On this machine: `RUSTUP_TOOLCHAIN=1.98.0-x86_64-pc-windows-msvc` (see WINDOWS-STABILITY.md section 1).

## 7. Signing, notarization, distribution (not done; no credentials here)

1. **Apple Developer Program membership** (paid), then create a **Developer ID Application** certificate. Export it as `.p12` with a password.
2. **Repository secrets** used by `.github/workflows/desktop.yml`:
   - `APPLE_CERTIFICATE` (base64 `.p12`), `APPLE_CERTIFICATE_PASSWORD`;
   - `APPLE_SIGNING_IDENTITY` (for example `Developer ID Application: <Name> (<TEAMID>)`);
   - `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password), `APPLE_TEAM_ID`.

   Without them CI builds unsigned and warns.
3. **The engine is signed by PyInstaller** with the same identity (`codesign_identity` in `backend/desktop.spec`). Every binary inside, including the bundled ffmpeg, must be signed with the hardened runtime, or notarization fails.
4. **Tauri signs the app** with `hardenedRuntime: true` and `Entitlements.plist`, then submits it to Apple's notary service with `APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID` and staples the ticket.
5. **Verify on a clean Mac:**
   - `spctl -a -vv WipeClip.app` (accepted, "Notarized Developer ID");
   - `codesign --verify --deep --strict WipeClip.app`;
   - opening the DMG shows no Gatekeeper warning.
6. **Updates:** CI adds `darwin-aarch64` to `latest.json` with the minisign signature. Test an update from the previous signed version.
7. **Not done:** none of these steps has been run, and no notarization has happened.

**Decisions still open:**

- Intel Macs: CI builds Apple Silicon only. An Intel or universal build needs a `macos-13` runner or `--target universal-apple-darwin` plus an Intel engine build.
- Whether to raise `minimumSystemVersion` to 13 so that recording is available on every supported version.
