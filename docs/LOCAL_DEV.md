# Running WipeClip locally

Everything except the database runs on your machine: the Next.js site and its API routes (port 3000) and the FastAPI processing backend (port 8002). Accounts and credits use the **cloud Supabase project, which is production**. See [Production data](#production-data) before signing in locally.

## First time

Needs Node 22+ and Python 3.12 or 3.13 (CI and Docker use 3.12).

```bash
npm ci
npm run dev:setup
```

`dev:setup` is safe to re-run. It:

1. creates `backend/.venv` if missing and installs `backend/requirements.txt`, then makes sure the contrib build of OpenCV is the one installed (see Troubleshooting);
2. creates `backend/.env` from `backend/.env.example`, and gives the site (`.env.local`) and the backend the same **local-only** `INTERNAL_API_SECRET`, so job tickets are signed and checked as in production. It also sets `SITE_URL=http://localhost:3000` so the backend can claim tickets and refund failed paid jobs. It points the site at `http://localhost:8002` unless `.env.local` already names a backend;
3. downloads the AI models now (background removal, about 180 MB, cached in `~/.rembg`; moderation ships with the package), so the first request isn't slow;
4. finds ffmpeg (a system install if on PATH, otherwise the copy bundled with `imageio-ffmpeg`).

It never talks to Supabase. Stop `npm run dev` before re-running it, because Windows locks packages the running backend has loaded.

## Every day

```bash
npm run dev          # site on :3000 + backend on :8002, backend reloads on code changes
npm run dev:check    # is everything up and wired together?
npm run dev:smoke    # end-to-end with a real video (probe, AI cleanup, export)
```

`dev:check` is read-only. It checks:

- the shared ticket secret and `SITE_URL`,
- backend health,
- the site serves `/editor`,
- the site accepts the backend's secret (using a deliberately invalid ticket),
- desktop-dev CORS,
- that Supabase is reachable.

`dev:smoke` runs signed out, like a visitor without an account: the probe, a 2-second AI cleanup, a check that a used ticket is refused (409), and an export joining a trimmed clip with the cleaned one. Each result is probed for size, resolution, duration, fps and audio. Signed-out jobs skip the credit ledger, so it writes nothing to Supabase. Signed-out visitors get 3 cleanups and 3 exports per day per IP. Locally those counters live in memory, so restarting `npm run dev` resets them.

Other entry points:

| | |
|---|---|
| `npm run dev:frontend` / `npm run dev:backend` | Start one side only |
| http://localhost:8002/docs | Backend API docs (`ENABLE_API_DOCS=1` in `backend/.env`) |
| `npm run desktop:dev` | Desktop app against this local stack (see [desktop/README](desktop/README.md)) |

## Configuration

| File | Holds | Committed? |
|---|---|---|
| `.env` | Supabase URL/keys and other shared values | no |
| `.env.local` | Local overrides: backend URL, local ticket secret, `DESKTOP_DEV_ORIGINS` | no |
| `backend/.env` | Backend settings, loaded by `npm run dev:backend` | no |
| `backend/.env.example`, `.env.local.example` | Templates | yes |

The local `INTERNAL_API_SECRET` is random and only on your machine. Production's lives in Vercel and Cloud Run and is not affected.

Not needed locally:

- **Redis job queue** (`REDIS_URL`): jobs run inline.
- **Upstash**: rate limits use an in-memory fallback.
- **Sentry**: inert without `SENTRY_DSN`.
- **Payments**: checkout needs the Payments.lk or Paddle keys and their webhooks can't reach localhost; leave them unset unless you're working on billing.

## Production data

The Supabase project in `.env` is production. Signed out, local use writes nothing to it. **Signed in, the local site behaves exactly like the live one.** AI cleanup spends that account's real credits; a failed paid job is refunded through the local site; referral claims and feedback are saved. Use your own account, and don't run schema changes (`supabase/schema.sql`) against this project.

## Troubleshooting

| Symptom | Fix |
|---|---|
| AI cleanup fails: `module 'cv2.xphoto' has no attribute 'inpaint'` | Both OpenCV packages are installed and the plain one overwrote the contrib build. Stop `npm run dev`, run `npm run dev:setup` (it removes `opencv-python-headless` and reinstalls the contrib build) |
| `dev:setup` fails with `Access is denied ... cv2.pyd` | A backend process still has OpenCV loaded. Stop `npm run dev`; if it persists, end leftover `python.exe` processes started from this repo (a killed `--reload` parent can leave its worker running) |
| `dev:check`: "INTERNAL_API_SECRET differs" or callback 403 | Run `npm run dev:setup`, then restart `npm run dev` (Next reads env files at startup) |
| "Couldn't reach WipeClip to check this video" in the editor | Backend isn't running or `NEXT_PUBLIC_TOOLS_API_URL` points elsewhere; `npm run dev:check` |
| Anonymous "Free preview limit reached" | Restart `npm run dev` |
| First background removal is slow | Run `npm run dev:setup` once to download the model in advance |
| Port 3000 or 8002 in use | Stop the other process, or `BACKEND_PORT=8003 npm run dev:backend` and update `NEXT_PUBLIC_TOOLS_API_URL` |
