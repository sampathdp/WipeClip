"use client";

import { IS_DESKTOP } from "@/lib/platform";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import RegionSelector from "@/components/RegionSelector";
import { RESOLUTION_CREDIT_COST } from "@/lib/credits";
import { trackEvent } from "@/lib/analytics";
import { grabFrame, loadVideoMeta } from "@/lib/editor/media";
import { formatTime, newId } from "@/lib/editor/timeline";
import type { Clip, MediaSource } from "@/lib/editor/types";
import {
  ContentBlockedError,
  InsufficientCreditsError,
  processVideo,
  type Region,
  type Resolution,
} from "@/lib/toolsApi";
import Dialog from "./Dialog";

const TOOL = "video_editor";
const TIERS: { key: Resolution; label: string; height: number }[] = [
  { key: "720p", label: "720p", height: 720 },
  { key: "1080p", label: "1080p", height: 1080 },
  { key: "4k", label: "4K", height: 2160 },
];

type Step = "frame" | "select" | "processing" | "error" | "blocked";

/** Runs the existing WipeClip cleanup (the same /api/process route,
 * credits, moderation and reconstruction engine the homepage tool uses) on
 * one timeline clip: the backend cuts the clip's source range, cleans only
 * that, and the result becomes a new source the clip is re-pointed at.
 */
export default function AiCleanupDialog({
  clip,
  source,
  frameTime,
  isSignedIn,
  onClose,
  onCleaned,
  onSignIn,
}: {
  clip: Clip;
  source: MediaSource;
  frameTime: number;
  isSignedIn: boolean;
  onClose: () => void;
  onCleaned: (source: MediaSource) => void;
  onSignIn: () => void;
}) {
  const [step, setStep] = useState<Step>("frame");
  const [frame, setFrame] = useState<{ url: string; width: number; height: number } | null>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [consent, setConsent] = useState(false);
  const defaultTier = isSignedIn
    ? (TIERS.find((t) => t.height >= source.height) ?? TIERS[TIERS.length - 1]).key
    : "720p";
  const [resolution, setResolution] = useState<Resolution>(defaultTier);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    grabFrame(source.url, frameTime)
      .then(({ blob, width, height }) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setFrame({ url, width, height });
        setStep("select");
      })
      .catch(() => {
        if (cancelled) return;
        setError("Couldn't read a frame from this clip. Please try again.");
        setStep("error");
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [source.url, frameTime]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async () => {
    if (!region) return;
    setStep("processing");
    setError(null);
    setElapsed(0);
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - started), 500);
    const controller = new AbortController();
    abortRef.current = controller;
    const hardStop = setTimeout(() => controller.abort(), 20 * 60 * 1000);
    trackEvent("processing_started", { tool: TOOL, mode: "remove", resolution });
    try {
      const blob = await processVideo(source.file, region, resolution, controller.signal, {
        start: clip.start,
        end: clip.end,
      });
      const file = new File([blob], `cleaned-${source.file.name.replace(/\.[^.]+$/, "")}.mp4`, { type: "video/mp4" });
      const url = URL.createObjectURL(file);
      const meta = await loadVideoMeta(url);
      trackEvent("processing_completed", { tool: TOOL, mode: "remove", resolution });
      window.dispatchEvent(new Event("credits:refresh"));
      onCleaned({
        id: newId("src"),
        kind: "cleaned",
        file,
        url,
        duration: meta.duration,
        width: meta.width,
        height: meta.height,
        fps: source.fps,
        hasAudio: source.hasAudio,
      });
    } catch (e) {
      if (controller.signal.aborted) {
        setError("Cleanup took too long. Try a shorter clip or a lower resolution.");
        setStep("error");
      } else if (e instanceof ContentBlockedError) {
        setError(e.message);
        setStep("blocked");
      } else if (e instanceof InsufficientCreditsError) {
        setError(e.message);
        setStep("blocked");
      } else {
        console.error("[editor] AI cleanup failed", e);
        const msg = e instanceof Error ? e.message : "";
        setError(
          /limit|sign in|credits/i.test(msg) && msg.length < 160
            ? msg
            : "AI Cleanup failed. Your clip wasn't changed. Please try again."
        );
        setStep("error");
      }
      trackEvent("processing_failed", { tool: TOOL, error_category: "processing_error" });
    } finally {
      clearInterval(timer);
      clearTimeout(hardStop);
    }
  };

  return (
    <Dialog title="AI Cleanup" onClose={step === "processing" ? undefined : onClose} wide>
      <p className="text-sm text-muted">
        Clip {formatTime(clip.start, true)} – {formatTime(clip.end, true)} ({formatTime(clip.end - clip.start, true)}). Drag a box over the
        unwanted object to remove. It&apos;s reconstructed across every frame of this clip.
      </p>

      {step === "frame" && (
        <div className="mt-6 flex items-center justify-center gap-3 py-12 text-sm text-muted">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" /> Loading frame…
        </div>
      )}

      {step === "select" && frame && (
        <div className="mt-4 space-y-4">
          <RegionSelector previewUrl={frame.url} naturalWidth={frame.width} naturalHeight={frame.height} onChange={setRegion} />
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Cleanup resolution</p>
            <div className="flex flex-wrap gap-2">
              {TIERS.map((t, i) => {
                const disabled = (!isSignedIn && t.key !== "720p") || (i > 0 && source.height <= TIERS[i - 1].height);
                return (
                  <button
                    key={t.key}
                    type="button"
                    disabled={disabled}
                    onClick={() => setResolution(t.key)}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:cursor-not-allowed disabled:opacity-30 ${
                      resolution === t.key ? "border-accent-2 bg-accent-2/10 text-foreground" : "border-border bg-surface text-muted"
                    }`}
                  >
                    {t.label} · {RESOLUTION_CREDIT_COST[t.key]} credit{RESOLUTION_CREDIT_COST[t.key] > 1 ? "s" : ""}
                  </button>
                );
              })}
            </div>
            {!isSignedIn && (
              <p className="mt-2 text-xs text-muted">
                Free preview at 720p.{" "}
                <button type="button" onClick={onSignIn} className="font-semibold text-accent underline">
                  Sign in
                </button>{" "}
                for full resolution.
              </p>
            )}
          </div>
          <label className="flex cursor-pointer items-start gap-3 text-xs text-muted">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
            />
            <span>
              I shot this video or have the rights to edit it, and the area I mark is not a watermark, logo or other
              ownership or copyright mark.{" "}
              <Link href="/terms" className="underline" target="_blank">
                Terms
              </Link>
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary rounded-full px-5 py-2.5 text-sm font-semibold">
              Cancel
            </button>
            <button
              type="button"
              onClick={run}
              disabled={!region || !consent}
              className="btn-primary rounded-full px-5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
            >
              Clean up clip
            </button>
          </div>
        </div>
      )}

      {step === "processing" && (
        <div className="mt-6 space-y-3 py-6 text-center" role="status" aria-live="polite">
          <div className="mx-auto h-2 w-full max-w-md overflow-hidden rounded-full bg-surface-3">
            <div className="h-full w-1/3 animate-[editor-indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-accent to-accent-2" />
          </div>
          <p className="text-sm font-medium text-foreground">Reconstructing this clip frame by frame…</p>
          <p className="font-mono text-xs text-muted">
            {Math.floor(elapsed / 60000)}:{String(Math.floor((elapsed % 60000) / 1000)).padStart(2, "0")}
          </p>
          {elapsed > 45000 && <p className="text-xs text-muted">Longer or higher-resolution clips can take a few minutes. {IS_DESKTOP ? "Keep WipeClip open." : "Keep this tab open."}</p>}
        </div>
      )}

      {(step === "error" || step === "blocked") && (
        <div className="mt-6 space-y-4 text-center">
          <p className="text-sm font-semibold text-rose-600 dark:text-rose-400" role="alert">
            {error}
          </p>
          <div className="flex justify-center gap-2">
            {step === "blocked" && /credit/i.test(error ?? "") && (
              <Link href="/pricing" className="btn-primary rounded-full px-5 py-2.5 text-sm font-semibold">
                Get credits
              </Link>
            )}
            {step === "error" && frame && (
              <button type="button" onClick={() => setStep("select")} className="btn-primary rounded-full px-5 py-2.5 text-sm font-semibold">
                Try again
              </button>
            )}
            <button type="button" onClick={onClose} className="btn-secondary rounded-full px-5 py-2.5 text-sm font-semibold">
              Close
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
