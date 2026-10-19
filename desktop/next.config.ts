import path from "node:path";
import type { NextConfig } from "next";

/** The desktop app's frontend: a static export of the real editor
 * (src/components/editor) for Tauri to bundle - see docs/desktop. Separate
 * from the website's next.config.ts so the site keeps its server features
 * (API routes, proxy, headers, redirects) and the website build never
 * changes because of the desktop one.
 */
const nextConfig: NextConfig = {
  output: "export",
  // The repo root already carries AGENTS.md/CLAUDE.md; don't generate
  // a second copy in desktop/ on every `next dev`.
  agentRules: false,
  // Tauri serves files from disk; there's no image optimizer to call.
  images: { unoptimized: true },
  // Every page is a directory with index.html, which Tauri's asset
  // resolver serves for "/" without any rewriting.
  trailingSlash: true,
  env: {
    NEXT_PUBLIC_WIPECLIP_DESKTOP: "1",
  },
  turbopack: {
    // The editor lives in ../src, outside this app's directory.
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
