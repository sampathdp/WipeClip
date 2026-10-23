# WipeClip Desktop (Windows and macOS)

The desktop app is the website's real video editor (`src/components/editor`), built as static files and wrapped in a [Tauri 2](https://tauri.app) shell. Accounts, credits and plan limits still run on wipeclip.co, exactly as they do for the website. Video processing (the import check, AI cleanup and export) runs on the user's own machine, on a bundled copy of the backend (see [Local engine](#local-engine)). The app adds:

- saving exports through the OS save dialog,
- the sign-in session kept in Windows Credential Manager or macOS Keychain,
- links to other site pages (pricing, terms, account) opening in the system browser,
- Google sign-in and email links returning to the app through `wipeclip://auth/callback`,
- a screen recorder (screen, window or area, with system audio, microphone, webcam and mouse/keyboard metadata) that saves locally and opens recordings in the editor - see [RECORDER.md](RECORDER.md),
- automatic focus zooms, click highlights and a drawn cursor for those recordings - see [FOCUS.md](FOCUS.md),
- tutorial tools: pause and dead-time review, captions with subtitle export, shortcut indicators, chapters, privacy masks, annotations and retakes - see [TUTORIAL.md](TUTORIAL.md).

See [ARCHITECTURE-AUDIT.md](ARCHITECTURE-AUDIT.md) for why it's built this way, and [RELEASE.md](RELEASE.md) for release readiness, test results, packaging and the manual checklist.

## Layout

| Path | What |
|---|---|
| `desktop/` | Second Next.js app, `output: "export"`. One page that renders `VideoEditor`. Shares `src/` with the website |
| `desktop/app/DesktopShell.tsx` | Link handling, sign-in deep link, offline banner, error logging |
| `desktop/scripts/tauri.mjs` | Runs `tauri dev`/`tauri build` with a CSP generated from the build's env |
| `desktop/scripts/check-bundle.mjs` | Fails the build if a server secret is in `desktop/out` |
| `src/lib/platform/` | `apiFetch`, `openExternal`, `saveExportFile`, `getDesktopCapabilities`, `showDesktopError`. Browser behaviour unchanged when not on desktop |
| `src/lib/cors.ts` | CORS for the four API routes the app calls, Tauri origins only |
| `src-tauri/` | Rust shell: window, navigation guard, commands, capabilities, bundle config |
| `src/lib/recorder/`, `src/components/recorder/` | Screen recorder: recording format, timing, event mapping, session, UI ([RECORDER.md](RECORDER.md)) |
| `src-tauri/src/recording/`, `src-tauri/src/input/`, `src-tauri/src/shortcuts.rs` | Recorder native side: recording files, input monitor, hotkeys |
| `src/lib/editor/camera.ts`, `pointer.ts`, `focus.ts`, `focusExport.ts` | Focus zooms, pointer reconstruction, suggestions, export rows ([FOCUS.md](FOCUS.md)) |
| `tests/desktop/` | Node tests for CORS, the secret scan, the recorder and focus effects; `manual/` holds the headless-Chrome preview check |
| `.github/workflows/desktop.yml` | Windows and macOS builds on GitHub runners |

## Required tools

| | Windows | macOS |
|---|---|---|
| Node.js | 22+ (the JS tests use `--experimental-strip-types`) | same |
| Rust | stable via [rustup](https://rustup.rs) | same |
| C/C++ toolchain | Visual Studio 2022 Build Tools, workload "Desktop development with C++" | Xcode Command Line Tools (`xcode-select --install`) |
| WebView | WebView2 (preinstalled on Windows 10 21H2+ and 11; the installer downloads it otherwise) | WKWebView, part of macOS |

Check the setup with `npx tauri info`.

## Configuration

Desktop builds read `desktop/.env*` (same precedence as Next.js). Copy `desktop/.env.example` to `desktop/.env.production.local` for release builds or `desktop/.env.development.local` for dev.

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_DESKTOP_SITE_ORIGIN` | Website the app calls. Default `https://www.wipeclip.co` |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same public values as the website |
| `NEXT_PUBLIC_TOOLS_API_URL` | Processing backend. Must be `https://` for release builds |

Everything in these files is compiled into the app. **Only public values.** The service-role key, `INTERNAL_API_SECRET`, payment and webhook secrets stay on the server; `check-bundle.mjs` stops the build if one shows up.

### One-time server setup

1. **Supabase** (Dashboard > Authentication > URL Configuration > Redirect URLs): add `wipeclip://auth/callback`. Without it, Google sign-in and email links can't return to the app (email and password sign-in still works).
2. **Website**: deploy this branch's API changes. `/api/process`, `/api/export`, `/api/credits` and `/api/referrals/claim` now also accept `Authorization: Bearer <Supabase access token>` and answer CORS for `tauri://localhost`, `http://tauri.localhost` and `https://tauri.localhost`. Cookie sessions behave as before.
3. **Backend**: `ALLOWED_ORIGINS` is `*` today (`deploy-backend.yml`). If you narrow it, include `tauri://localhost,http://tauri.localhost,https://tauri.localhost`.

## Development

```bash
npm ci
# Local website + backend (for API calls), as usual:
npm run dev
# In another terminal, the desktop app with hot reload:
npm run desktop:dev
```

For dev against your local website, set in `desktop/.env.development.local`:

```
NEXT_PUBLIC_DESKTOP_SITE_ORIGIN=http://localhost:3000
NEXT_PUBLIC_TOOLS_API_URL=http://localhost:8002
```

and in the website's `.env.local`, `DESKTOP_DEV_ORIGINS=http://localhost:3100` (the dev window's origin).

`wipeclip://` links register automatically in Windows dev builds. On macOS they only work from a bundled `.app`.

Logs: Windows `%LOCALAPPDATA%\co.wipeclip.desktop\logs\`, macOS `~/Library/Logs/co.wipeclip.desktop/`.

## Builds

| Command | Result |
|---|---|
| `npm run build` | Website, unchanged |
| `npm run desktop:frontend:build` | `desktop/out` + secret scan |
| `npm run desktop:build` | Frontend, then the Tauri bundle for the current OS |
| `npm run desktop:test` | Rust unit tests (path checks, file names, atomic save, credential chunking) |
| `npm run desktop:test:js` | CORS and secret-scan tests |

Output goes to `src-tauri/target/release/bundle/`.

### Windows release

1. On Windows: `npm run desktop:build -- --bundles nsis` produces `bundle/nsis/WipeClip_<version>_x64-setup.exe`. It installs per user (no admin prompt) and adds an uninstaller in Settings > Apps. Running a newer installer upgrades in place.
2. **Code signing (required for public release):** without it SmartScreen warns on every download. Buy an OV or EV code-signing certificate (or use Azure Trusted Signing), then set `bundle.windows.certificateThumbprint` (certificate in the machine's store) or `bundle.windows.signCommand` (cloud signing) in `src-tauri/tauri.conf.json`. See <https://v2.tauri.app/distribute/sign/windows/>. Never commit `.pfx` files or passwords.

### macOS release

1. On a Mac: `npm run desktop:build -- --bundles app,dmg` produces `bundle/dmg/WipeClip_<version>_aarch64.dmg` (Apple Silicon).
2. Intel Macs: `rustup target add x86_64-apple-darwin`, then `npm run desktop:build -- --target universal-apple-darwin` for one universal app. Not yet tested.
3. **Signing and notarization (required, or Gatekeeper blocks the app):** an Apple Developer Program membership, a "Developer ID Application" certificate, and an app-specific password. Set `APPLE_SIGNING_IDENTITY`, `APPLE_CERTIFICATE` (base64 .p12) and `APPLE_CERTIFICATE_PASSWORD`, plus `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID` for notarization, and Tauri signs and notarizes during `tauri build`. In CI these are repository secrets (see `desktop.yml`). See <https://v2.tauri.app/distribute/sign/macos/>.

### CI

`.github/workflows/desktop.yml` builds on `windows-latest` and `macos-latest` (only when started by hand: Actions > Desktop > Run workflow) and uploads the installer as a workflow artifact. It needs repository **variables** (not secrets) `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_TOOLS_API_URL`, and optionally `NEXT_PUBLIC_DESKTOP_SITE_ORIGIN`.

## Behaviour notes

- **Import**: clicking the start screen's box opens the OS dialog through the app (`media_choose`); the video is then edited where it is on disk, at any size (see RELEASE.md, Projects). Drag and drop works as on the website (the dropped file is kept in app storage, up to 300 MB). Codec and server checks apply unchanged.
- **Export** renders on the local engine. "Save MP4…" opens the save dialog (the OS asks before replacing a file), writes to a hidden temporary file beside the target, flushes, and renames it into place. Failures delete the temporary file and keep the export in the dialog so you can pick another folder. Plan and branding rules come from the server, unchanged.
- **Offline**: editing an already-open project and opening a new video work. AI cleanup, sign-in and export still need a connection for the plan check (the job ticket); a banner says so.
- **Auto captions** download the Whisper model from Hugging Face on first use, as on the website.
- **Screen recorder**: see [RECORDER.md](RECORDER.md) for permissions, format, limitations and the manual test checklist.
- **Updates**: the app offers new versions from GitHub Releases and installs them on a click; see [RELEASE.md](RELEASE.md#updates).
- **Not in this release**: GPU processing, offline export, Linux packages.

## Local engine

The website's FastAPI backend (`backend/`), packaged with PyInstaller (`backend/desktop.spec`, `backend/requirements-desktop.txt`) and shipped in the app as `resources/engine/`. `src-tauri/src/engine.rs` starts it on first use (opening a video or the AI cleanup dialog) on a free `127.0.0.1` port, with a random per-launch token every request must carry as `X-Local-Token`. It exits with the app, also after a crash (it watches the app's process id). The page reaches it through `localEngine()` in `src/lib/platform`; `src/lib/toolsApi.ts` sends the probe, AI cleanup and export there instead of to the cloud backend.

- **Plan checks stay on the site.** Jobs still need a ticket from `/api/process` or `/api/export`. The app asks with `local: true`: AI cleanup then needs a paid plan and spends no credits; free plans get `plan_required` and the app falls back to the cloud backend with credits, as on the website. Export rules (resolution, premium features, daily limit, branding) are unchanged. The cloud backend refuses `local` tickets, so they can't buy a credit-free job there. The engine runs on the user's machine, so a determined user could bypass these checks.
- **CPU only**, all cores. Speed scales with the machine.
- **Size**: about 300 MB unpacked, adding roughly 120–150 MB to the installer.
- **Build it**: `cd backend && pip install -r requirements-desktop.txt && pyinstaller desktop.spec --noconfirm`, then copy `dist/wipeclip-engine` to `src-tauri/resources/engine`. `desktop.yml` does this on both runners (and signs it on macOS). Without that folder a build still works, processing on the cloud backend; CI sets `WIPECLIP_REQUIRE_ENGINE=1` so a release can't miss it.
- **Dev**: `npm run desktop:dev` runs `backend/desktop_engine.py` from `backend/.venv` instead.
- **Logs**: the engine's output goes to the app log under the `engine` target.

## Codec differences

The editor plays video in the OS WebView, so what opens depends on the OS, as it does across browsers today:

| | Windows (WebView2 / Chromium) | macOS (WKWebView / Safari) |
|---|---|---|
| H.264 MP4 / MOV | yes | yes |
| HEVC | only with the HEVC Video Extensions from the Microsoft Store | yes |
| VP9 / WebM | yes | macOS 11.3+; varies |
| AV1 | yes | Apple Silicon M3+ only |
| WebGPU (faster captions) | yes | macOS 26+; otherwise WASM fallback |

Unsupported files fail at import with the existing "can't play this video's format" message. Nothing is transcoded silently.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `link.exe not found` / `MSVC not found` | Install VS 2022 Build Tools with "Desktop development with C++" |
| `Missing NEXT_PUBLIC_...` | Create `desktop/.env.production.local` from `desktop/.env.example` |
| `Secret scan FAILED` | A server secret is in a `NEXT_PUBLIC_` variable or imported into client code. Remove it; never ship that build |
| Credits or export fail with a network error in the app but not the site | The site isn't deployed with the CORS/bearer changes, or `ALLOWED_ORIGINS` on the backend excludes the Tauri origins |
| Google sign-in opens the browser but the app never signs in | `wipeclip://auth/callback` missing from Supabase redirect URLs, or (macOS) running unbundled dev build |
| macOS: "WipeClip is damaged / can't be opened" | Unsigned or not notarized build. Sign and notarize; for local testing only, right-click > Open |
| Editor shows but is unstyled (raw text, visible "Choose File") | Tailwind didn't scan `src/`. `desktop/app/desktop.css` must keep its `@source "../../src"` line |
| App opens to a dead editor; log says `supabaseUrl is required` | Public config wasn't compiled in. The bundle check now fails the build for this; delete `desktop/.next` and rebuild with `desktop/.env.production.local` filled in |
| Blank window | Check the log file; CSP violations are listed in the WebView devtools (debug builds: right-click > Inspect) |

## Test status

Automated (run on this branch):

- `npm run build` (website) passes with the same route table.
- `npx tsc --noEmit` for the website and `-p desktop` pass; ESLint passes on changed files.
- `npm run desktop:frontend:build` produces `desktop/out`; the secret scan passes.
- `npm run desktop:test:js`: 7 tests pass (CORS allowlist, preflight, secret scan detects service_role JWTs and payment keys without printing them).
- The desktop frontend dev server serves the editor page.
- `npm run desktop:test` on Windows (MSVC 14.44): all Rust unit tests pass.
- `npm run desktop:dev` on Windows 11: the app window opens and shows the styled editor with the in-app Sign in button.
- `tauri build --bundles nsis` on Windows produces `WipeClip_0.1.0_x64-setup.exe` (6.7 MB). The release exe starts and logs no frontend errors. This test build pointed at the local site and backend; the installer itself has not been run yet.

**Not yet run:** a macOS build (needs a Mac or the CI workflow), and the installer's install/upgrade/uninstall.

Manual, on a real Windows machine and a real Mac, before release:

1. App installs, launches, closes; reinstall over it upgrades; uninstall removes it.
2. Open a real MP4 and MOV via the picker and by drag and drop; cancel the picker.
3. Timeline editing, preview playback with audio, captions.
4. Sign in with email/password and with Google (deep link); sign out; restart and confirm the session persists.
5. AI cleanup on a clip: credits drop by the right amount; signed-out is capped at 720p.
6. Export: save to a chosen folder, replace an existing file, cancel the dialog, save to a read-only folder (clean error, no partial file), pull the network mid-export (clean error).
7. Output keeps audio and expected resolution and frame rate (`ffprobe`).
8. Pricing/terms/profile links open in the browser; nothing navigates the app window away.
9. Signed builds pass SmartScreen and Gatekeeper.
