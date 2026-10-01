"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RESOLUTION_CREDIT_COST } from "@/lib/credits";
import { trackEvent } from "@/lib/analytics";
import { exportProject } from "@/lib/editor/exportProject";
import { saveLastExport } from "@/lib/editor/projectStore";
import { formatTime } from "@/lib/editor/timeline";
import type { MediaSource, Project } from "@/lib/editor/types";
import { ContentBlockedError, InsufficientCreditsError, type Resolution } from "@/lib/toolsApi";
import Dialog from "./Dialog";
import { ExportIcon } from "./icons";

const TOOL = "video_editor";
const TIERS: { key: Resolution; short: number }[] = [
  { key: "720p", short: 720 },
  { key: "1080p", short: 1080 },
  { key: "4k", short: 2160 },
];

/** Output size for a tier - mirrors api_video_export: short side capped
 * at the tier, never upscaled, even dimensions.
 */
function outputSize(w: number, h: number, short: number) {
  const scale = Math.min(1, short / Math.min(w, h));
  return { w: Math.floor((w * scale) / 2) * 2, h: Math.floor((h * scale) / 2) * 2 };
}

export default function ExportDialog({
  project,
  sources,
  originalId,
  total,
  isSignedIn,
  initialResult,
  onClose,
  onSignIn,
}: {
  project: Project;
  sources: Record<string, MediaSource>;
  originalId: string;
  total: number;
  isSignedIn: boolean;
  initialResult: Blob | null;
  onClose: () => void;
  onSignIn: () => void;
}) {
  const original = sources[originalId];
  const shortSide = Math.min(original.width, original.height);
  // A tier is only offered if it actually yields more pixels than the one below.
  const available = TIERS.filter((t, i) => i === 0 || shortSide > TIERS[i - 1].short);
  const [resolution, setResolution] = useState<Resolution>(isSignedIn ? available[available.length - 1].key : "720p");
  const [state, setState] = useState<"setup" | "rendering" | "done" | "error">(initialResult ? "done" : "setup");
  const [error, setError] = useState<{ message: string; credits?: boolean } | null>(null);
  const [result, setResult] = useState<{ blob: Blob; url: string } | null>(() =>
    initialResult ? { blob: initialResult, url: URL.createObjectURL(initialResult) } : null
  );
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    return () => {
      if (result) URL.revokeObjectURL(result.url);
    };
  }, [result]);

  const start = async () => {
    setState("rendering");
    setError(null);
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - started), 500);
    const controller = new AbortController();
    abortRef.current = controller;
    const hardStop = setTimeout(() => controller.abort(), 20 * 60 * 1000);
    trackEvent("processing_started", { tool: TOOL, resolution });
    try {
      const blob = await exportProject(project, sources, originalId, isSignedIn ? resolution : "720p", controller.signal);
      setResult({ blob, url: URL.createObjectURL(blob) });
      setState("done");
      trackEvent("processing_completed", { tool: TOOL, resolution });
      window.dispatchEvent(new Event("credits:refresh"));
      // Survives a sign-in redirect, so an anonymous export isn't lost
      // (and re-rendered) just to download it.
      if (!isSignedIn) void saveLastExport(blob);
    } catch (e) {
      console.error("[editor] export failed", e);
      if (controller.signal.aborted) {
        setError({ message: "Export took too long. Try a shorter video or a lower resolution. Your project is safe." });
      } else if (e instanceof InsufficientCreditsError) {
        setError({ message: e.message, credits: true });
      } else if (e instanceof ContentBlockedError) {
        setError({ message: e.message });
      } else if (e instanceof TypeError) {
        setError({ message: "Network problem during export. Check your connection and try again. Your project is safe." });
      } else {
        const msg = e instanceof Error ? e.message : "";
        setError({
          message:
            /limit|sign in|too long|too large/i.test(msg) && msg.length < 160
              ? msg
              : "Export failed. Your original video is safe. Please try exporting again.",
        });
      }
      setState("error");
      trackEvent("processing_failed", { tool: TOOL, error_category: "export_error" });
    } finally {
      clearInterval(timer);
      clearTimeout(hardStop);
    }
  };

  const filename = `wipeclip-${original.file.name.replace(/\.[^.]+$/, "")}-edit.mp4`;

  return (
    <Dialog title="Export video" onClose={state === "rendering" ? undefined : onClose}>
      {state === "setup" && (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-surface-2/60 p-3 text-center text-xs">
            <div>
              <p className="text-muted">Length</p>
              <p className="font-mono font-semibold text-foreground">{formatTime(total, true)}</p>
            </div>
            <div>
              <p className="text-muted">Clips</p>
              <p className="font-semibold text-foreground">{project.clips.length}</p>
            </div>
            <div>
              <p className="text-muted">Stickers</p>
              <p className="font-semibold text-foreground">{project.stickers.length}</p>
            </div>
          </div>
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Resolution</p>
            <div className="grid gap-2" role="radiogroup" aria-label="Export resolution">
              {available.map((t) => {
                const size = outputSize(original.width, original.height, t.short);
                const locked = !isSignedIn && t.key !== "720p";
                const cost = RESOLUTION_CREDIT_COST[t.key];
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="radio"
                    aria-checked={resolution === t.key}
                    disabled={locked}
                    onClick={() => setResolution(t.key)}
                    className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:cursor-not-allowed disabled:opacity-40 ${
                      resolution === t.key ? "border-accent-2 bg-accent-2/10" : "border-border bg-surface hover:border-accent/50"
                    }`}
                  >
                    <span>
                      <span className="font-semibold text-foreground">{t.key === "4k" ? "4K" : t.key}</span>
                      <span className="ml-2 font-mono text-xs text-muted">
                        {size.w}×{size.h}
                      </span>
                    </span>
                    <span className="text-xs text-muted">
                      {locked ? "sign in" : isSignedIn ? `${cost} credit${cost > 1 ? "s" : ""}` : "free preview"}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-muted">
              Frame rate and aspect ratio match your original ({original.width}×{original.height}). Videos are never upscaled.
            </p>
            {!isSignedIn && (
              <p className="mt-2 text-xs text-muted">
                Export a free 720p preview without an account.{" "}
                <button type="button" onClick={onSignIn} className="font-semibold text-accent underline">
                  Sign in
                </button>{" "}
                for full resolution and to download.
              </p>
            )}
          </div>
          <button type="button" onClick={start} className="btn-primary flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold">
            <ExportIcon width={16} height={16} /> Export
          </button>
        </div>
      )}

      {state === "rendering" && (
        <div className="space-y-3 py-8 text-center" role="status" aria-live="polite">
          <div className="mx-auto h-2 w-full max-w-sm overflow-hidden rounded-full bg-surface-3">
            <div className="h-full w-1/3 animate-[editor-indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-accent to-accent-2" />
          </div>
          <p className="text-sm font-medium text-foreground">Rendering your video…</p>
          <p className="font-mono text-xs text-muted">
            {Math.floor(elapsed / 60000)}:{String(Math.floor((elapsed % 60000) / 1000)).padStart(2, "0")}
          </p>
          <p className="text-xs text-muted">Uploading, then applying every cut, transition and sticker. Keep this tab open.</p>
        </div>
      )}

      {state === "done" && result && (
        <div className="space-y-4">
          <video src={result.url} controls playsInline className="max-h-[50dvh] w-full rounded-xl bg-black" />
          {isSignedIn ? (
            <a
              href={result.url}
              download={filename}
              onClick={() => trackEvent("download_clicked", { tool: TOOL })}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-emerald-500 py-3 text-sm font-bold text-black hover:bg-emerald-400"
            >
              <ExportIcon width={16} height={16} /> Download MP4
            </a>
          ) : (
            <button
              type="button"
              onClick={onSignIn}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-emerald-500 py-3 text-sm font-bold text-black hover:bg-emerald-400"
            >
              Sign in to download
            </button>
          )}
          <button type="button" onClick={() => setState("setup")} className="btn-secondary w-full rounded-full py-2.5 text-sm font-semibold">
            Export again
          </button>
        </div>
      )}

      {state === "error" && error && (
        <div className="space-y-4 py-4 text-center">
          <p className="text-sm font-semibold text-rose-600 dark:text-rose-400" role="alert">
            {error.message}
          </p>
          <div className="flex justify-center gap-2">
            {error.credits ? (
              <Link href="/pricing" className="btn-primary rounded-full px-5 py-2.5 text-sm font-semibold">
                Get credits
              </Link>
            ) : (
              <button type="button" onClick={start} className="btn-primary rounded-full px-5 py-2.5 text-sm font-semibold">
                Try again
              </button>
            )}
            <button type="button" onClick={() => setState("setup")} className="btn-secondary rounded-full px-5 py-2.5 text-sm font-semibold">
              Back
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
