// Starts the FastAPI backend for local development (npm run dev:backend).
// Uses the venv in backend/.venv on Windows, macOS and Linux, loads
// backend/.env, and reloads when files under backend/app change.
// Run `npm run dev:setup` first on a fresh clone.
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const backend = path.join(root, "backend");
const python =
  process.platform === "win32"
    ? path.join(backend, ".venv", "Scripts", "python.exe")
    : path.join(backend, ".venv", "bin", "python");
const envFile = path.join(backend, ".env");
const port = process.env.BACKEND_PORT ?? "8002";

if (!existsSync(python)) {
  console.error("backend/.venv is missing - run `npm run dev:setup` first.");
  process.exit(1);
}
if (!existsSync(envFile)) {
  console.error("backend/.env is missing - run `npm run dev:setup` first.");
  process.exit(1);
}

const args = [
  "-m", "uvicorn", "app.main:app",
  "--app-dir", backend,
  "--host", "127.0.0.1",
  "--port", port,
  "--env-file", envFile,
  "--reload",
  "--reload-dir", path.join(backend, "app"),
];
const child = spawn(python, args, { cwd: backend, stdio: "inherit" });
const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
