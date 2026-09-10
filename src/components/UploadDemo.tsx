"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import RegionSelector from "./RegionSelector";
import VideoCompareSlider from "./VideoCompareSlider";
import SignInModal from "./SignInModal";
import { createClient } from "@/lib/supabase/client";
import { clearPendingResult, loadPendingResult, savePendingResult } from "@/lib/resultCache";
import { trackEvent, useToolView } from "@/lib/analytics";
import {
  ContentBlockedError,
  InsufficientCreditsError,
  detectWatermark,
  probeVideo,
  processVideo,
  type Region,
  type Resolution,
  type VideoInfo,
  type WatermarkCandidate,
} from "@/lib/toolsApi";

// Below this, the detector's own signal is too weak to prefill with -
// let the user mark the region manually instead of guessing wrong.
const WATERMARK_SUGGESTION_MIN_CONFIDENCE = 0.45;

type Step = "idle" | "probing" | "select" | "processing" | "done" | "error" | "blocked";
type BlockReason = "content" | "credits";
type Mode = "remove" | "replace";

const MAX_BYTES = 300 * 1024 * 1024;
const TOOL = "video_watermark_remover";

const RESOLUTION_OPTIONS: { key: Resolution; label: string; minHeight: number; credits: number }[] = [
  { key: "720p", label: "720p HD", minHeight: 720, credits: 1 },
  { key: "1080p", label: "1080p FHD", minHeight: 1080, credits: 2 },
  { key: "4k", label: "4K Ultra", minHeight: 2160, credits: 4 },
];

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UploadDemo() {
  useToolView(TOOL);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [blockReason, setBlockReason] = useState<BlockReason | null>(null);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [suggestion, setSuggestion] = useState<WatermarkCandidate | null>(null);
  const [mode, setMode] = useState<Mode>("remove");
  const [resolution, setResolution] = useState<Resolution>("720p");
  const [logo, setLogo] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [queue, setQueue] = useState<File[]>([]);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [showSignInModal, setShowSignInModal] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // The Process button sits at the bottom of a tall panel, so after
  // clicking it the viewport is left scrolled past the progress bar /
  // result that replace the controls. Pull the panel back into view on
  // each of those transitions.
  useEffect(() => {
    if (step === "processing" || step === "done" || step === "blocked" || step === "error") {
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [step]);

  // Processing itself needs no account (see /api/process's anonymous path)
  // - only the download at the end is gated on being signed in (see the
  // "done" step below), so this tracks sign-in state to flip that gate.
  // onAuthStateChange also fires when another tab/the SignInModal signs the
  // visitor in, without this component needing to know how that happened.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setIsSignedIn(Boolean(data.user));
      if (!data.user) setIsPro(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsSignedIn(Boolean(session?.user));
      if (!session?.user) setIsPro(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Batch upload (multi-file select/drop) is a Pro-plan feature; free/starter
  // keep the single-file flow untouched below. Only checked once signed in -
  // /api/credits 401s for a signed-out caller, so calling it unconditionally
  // on every page load (this component sits on the homepage) would fire a
  // doomed request on every anonymous visit for no reason. isPro's "false"
  // side is reset from the auth effect above (in its own callbacks, not
  // here) - this effect only ever needs to move it to true.
  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    fetch("/api/credits")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setIsPro(data?.plan === "pro");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isSignedIn]);

  // Restores an anonymous result that was saved to IndexedDB right before
  // sign-in (see resultCache.ts + the save call in process() below) - the
  // whole reason that exists is that most sign-in paths (magic link,
  // Google OAuth, the Navbar's own "Sign in" link) do a real page
  // navigation, which throws away this component's state and invalidates
  // any blob: URL. Only fires when nothing else is going on (idle), so it
  // can't clobber a file the visitor is actively working on in this tab.
  useEffect(() => {
    if (!isSignedIn || step !== "idle") return;
    let cancelled = false;
    loadPendingResult().then((pending) => {
      if (cancelled || !pending) return;
      setFile(new File([pending.originalBlob], pending.filename));
      setOriginalUrl(URL.createObjectURL(pending.originalBlob));
      setResultUrl(URL.createObjectURL(pending.resultBlob));
      setStep("done");
      clearPendingResult();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  const reset = useCallback(() => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    setFile(null);
    setStep("idle");
    setError(null);
    setBlockReason(null);
    setVideoInfo(null);
    setPreviewUrl(null);
    setOriginalUrl(null);
    setRegion(null);
    setSuggestion(null);
    setMode("remove");
    setResolution("720p");
    setLogo(null);
    setConsent(false);
    setProgress(0);
    setElapsedMs(0);
    setResultUrl(null);
    setQueue([]);
    void clearPendingResult();
  }, [resultUrl, previewUrl, originalUrl]);

  const pickFile = useCallback(async (picked: File | undefined) => {
    if (!picked) return;
    if (!picked.type.startsWith("video/")) {
      setError("Please choose a video file.");
      return;
    }
    if (picked.size > MAX_BYTES) {
      setError("File exceeds the 300MB limit.");
      return;
    }
    setError(null);
    setFile(picked);
    setOriginalUrl(URL.createObjectURL(picked));
    setStep("probing");
    try {
      const [{ info, previewUrl: url }, candidates] = await Promise.all([
        probeVideo(picked),
        detectWatermark(picked),
      ]);
      setVideoInfo(info);
      setPreviewUrl(url);
      const top = candidates[0];
      setSuggestion(top && top.confidence >= WATERMARK_SUGGESTION_MIN_CONFIDENCE ? top : null);
      setStep("select");
      trackEvent("mask_started", { tool: TOOL });
    } catch (e) {
      if (e instanceof ContentBlockedError) {
        setError(e.message);
        setBlockReason("content");
        setStep("blocked");
        return;
      }
      setError(e instanceof Error ? e.message : "Could not read that video.");
      setStep("error");
    }
  }, []);

  // Multi-file entry point: Pro users can select/drop several files at
  // once - the first is processed through the normal single-file flow
  // below, the rest wait in `queue` and are offered one at a time from the
  // "done" screen via processNextInQueue. Non-Pro (or a single file) just
  // behaves like pickFile always did.
  const pickFiles = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      trackEvent("file_selected", { tool: TOOL });
      const files = Array.from(list);
      if (isPro && files.length > 1) {
        setQueue(files.slice(1));
      }
      pickFile(files[0]);
    },
    [isPro, pickFile]
  );

  const processNextInQueue = useCallback(() => {
    if (queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    pickFile(next);
  }, [queue, pickFile]);

  const process = useCallback(async () => {
    if (!file || !region) return;
    setStep("processing");
    setProgress(0);
    setElapsedMs(0);
    setError(null);
    trackEvent("mask_completed", { tool: TOOL, mode });
    trackEvent("processing_started", { tool: TOOL, mode, resolution });

    // Indeterminate: the backend processes the whole clip before it
    // responds, so there's no real percentage to read. Ease asymptotically
    // toward ~97% and keep inching so a multi-minute job (long clip / Pro
    // quality) never looks frozen; the await below snaps it to 100. The
    // elapsed clock is the honest signal the user actually watches.
    const startedAt = Date.now();
    timerRef.current = setInterval(() => {
      setProgress((p) => (p < 97 ? p + Math.max(0.15, (97 - p) * 0.03) : p));
      setElapsedMs(Date.now() - startedAt);
    }, 600);

    // Hard ceiling: the frame-by-frame backend can run for minutes, but if
    // it wedges entirely the request would otherwise hang forever (no
    // natural timeout now that the undici header timeout is lifted in
    // /api/process). Well clear of the backend's own worst case.
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 20 * 60 * 1000);

    try {
      const blob = await processVideo(file, mode, region, resolution, logo, controller.signal);
      clearTimeout(abortTimer);
      if (timerRef.current) clearInterval(timerRef.current);
      setProgress(100);
      setResultUrl(URL.createObjectURL(blob));
      setStep("done");
      trackEvent("processing_completed", { tool: TOOL, mode, resolution });
      window.dispatchEvent(new Event("credits:refresh"));
      // Anonymous result: save it so it survives whatever sign-in path the
      // visitor takes at the download step (see resultCache.ts) - signed-in
      // results don't need this, the download link already works immediately.
      if (!isSignedIn) {
        void savePendingResult({ filename: file.name, originalBlob: file, resultBlob: blob });
      }
    } catch (e) {
      clearTimeout(abortTimer);
      if (timerRef.current) clearInterval(timerRef.current);
      if (e instanceof DOMException && e.name === "AbortError") {
        setError(
          "Processing is taking too long — this clip may be too long or too high-resolution. Try a shorter clip or a lower output resolution."
        );
        setStep("error");
        trackEvent("processing_failed", { tool: TOOL, error_category: "timeout" });
        return;
      }
      if (e instanceof ContentBlockedError) {
        setError(e.message);
        setBlockReason("content");
        setStep("blocked");
        trackEvent("processing_failed", { tool: TOOL, error_category: "content_policy" });
        return;
      }
      if (e instanceof InsufficientCreditsError) {
        setError(e.message);
        setBlockReason("credits");
        setStep("blocked");
        trackEvent("processing_failed", { tool: TOOL, error_category: "insufficient_credits" });
        return;
      }
      setError(e instanceof Error ? e.message : "Processing failed. Try again.");
      setStep("error");
      trackEvent("processing_failed", { tool: TOOL, error_category: "processing_error" });
    }
  }, [file, region, mode, resolution, logo, isSignedIn]);

  return (
    <div
      ref={panelRef}
      id="upload"
      className="glass-card mx-auto max-w-3xl scroll-mt-28 rounded-[2rem] p-6 sm:p-10 border border-cyan-500/20 shadow-[0_20px_50px_rgba(15,23,42,0.08)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.7)]"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl text-foreground">
            Try it now: <span className="text-gradient">Clean Up a Clip</span>
          </h2>
          <p className="mt-1.5 text-sm sm:text-base text-muted">
            Upload a clip you own, mark the overlay once, download the clean version. Zero files stored.
          </p>
        </div>
      </div>

      {step === "idle" && !file && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            multiple={isPro}
            className="hidden"
            onChange={(e) => pickFiles(e.target.files)}
          />
          <button
            type="button"
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              pickFiles(e.dataTransfer.files);
            }}
            onClick={() => {
              trackEvent("upload_clicked", { tool: TOOL });
              inputRef.current?.click();
            }}
            className={`mt-8 flex w-full cursor-pointer flex-col items-center justify-center rounded-[1.75rem] border-2 border-dashed px-6 py-14 text-center transition-all ${
              isDragOver
                ? "border-cyan-400 bg-cyan-50 scale-[1.01] shadow-[0_0_30px_rgba(34,211,238,0.25)]"
                : "border-border hover:border-cyan-500/50 hover:bg-surface-2/40 hover:shadow-[0_0_20px_rgba(124,92,255,0.15)]"
            }`}
          >
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-accent/20 to-accent-2/20 border border-cyan-400/30 text-cyan-600 shadow-[0_0_20px_rgba(34,211,238,0.2)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 16V4m0 0L7 9m5-5l5 5M5 20h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="text-base font-semibold text-foreground">
            {isPro ? "Drop your videos here, or click to browse" : "Drop your video here, or click to browse"}
          </p>
          <p className="mt-1 text-xs sm:text-sm text-muted">
            MP4, MOV, WebM &bull; Up to 300MB{isPro ? " each &bull; batch upload enabled" : ""}
          </p>
          </button>
        </>
      )}

      {step === "probing" && (
        <div className="mt-8 flex flex-col items-center gap-4 rounded-[1.75rem] bg-surface-2/70 border border-border p-12 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500/20 border-t-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.4)]" />
          <p className="text-sm font-medium text-foreground">Reading video metadata &amp; frames…</p>
        </div>
      )}

      {step === "blocked" && (
        <div className="mt-8 flex flex-col items-center gap-3 rounded-[1.75rem] bg-surface-2/80 border border-border p-8 text-center">
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
              blockReason === "content" ? "bg-rose-500/20 text-rose-600 border border-rose-500/30" : "bg-accent/20 text-accent border border-accent/30"
            }`}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className={`font-semibold text-base ${blockReason === "content" ? "text-rose-600" : "text-foreground"}`}>
            {error ?? "This video can't be processed here."}
          </p>

          {blockReason === "content" && (
            <p className="max-w-md text-xs sm:text-sm text-muted">
              WipeClip.co doesn&apos;t process explicit or adult content. See our{" "}
              <Link href="/terms" className="underline hover:text-foreground">
                Terms of Service
              </Link>
              .
            </p>
          )}

          <div className="mt-4 flex flex-wrap justify-center gap-3">
            {blockReason === "credits" && (
              <>
                <button
                  onClick={() => setStep("select")}
                  className="btn-primary rounded-full px-5 py-2.5 text-sm font-semibold"
                >
                  Try a lower resolution
                </button>
                <Link
                  href="/pricing"
                  className="btn-secondary rounded-full px-5 py-2.5 text-sm font-semibold"
                >
                  Buy more credits
                </Link>
              </>
            )}
            <button
              onClick={reset}
              className="btn-secondary rounded-full px-5 py-2.5 text-sm font-semibold"
            >
              Choose a different file
            </button>
          </div>
        </div>
      )}

      {file && (step === "select" || step === "processing" || step === "done" || step === "error") && (
        <div className="mt-8 rounded-[1.75rem] bg-surface-2/70 border border-border p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-4">
            <div className="min-w-0">
              <p className="truncate font-semibold text-foreground">{file.name}</p>
              <p className="text-xs sm:text-sm text-muted mt-0.5">
                {formatBytes(file.size)}
                {videoInfo
                  ? ` · ${videoInfo.width}×${videoInfo.height} · ${videoInfo.duration.toFixed(1)}s`
                  : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {queue.length > 0 && (
                <span className="rounded-full bg-surface-3/80 border border-border px-2.5 py-1 text-[11px] font-mono text-muted">
                  +{queue.length} queued
                </span>
              )}
              {step !== "processing" && (
                <button
                  onClick={reset}
                  className="text-xs font-semibold text-muted transition-colors hover:text-cyan-600"
                >
                  Start over
                </button>
              )}
            </div>
          </div>

          {step === "select" && previewUrl && videoInfo && (
            <div className="mt-5">
              <RegionSelector
                previewUrl={previewUrl}
                naturalWidth={videoInfo.width}
                naturalHeight={videoInfo.height}
                suggestion={suggestion}
                onChange={setRegion}
              />

              {/* Mode Toggle */}
              <div className="mt-6 flex rounded-xl bg-surface-3/80 p-1 border border-border text-sm">
                <button
                  onClick={() => setMode("remove")}
                  className={`flex-1 rounded-lg py-2.5 font-medium transition-all ${
                    mode === "remove"
                      ? "bg-accent text-white shadow-[0_0_15px_rgba(124,92,255,0.4)]"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  Remove Overlay
                </button>
                <button
                  onClick={() => setMode("replace")}
                  className={`flex-1 rounded-lg py-2.5 font-medium transition-all ${
                    mode === "replace"
                      ? "bg-accent text-white shadow-[0_0_15px_rgba(124,92,255,0.4)]"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  Replace with My Logo
                </button>
              </div>

              {mode === "replace" && (
                <div className="mt-3">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => setLogo(e.target.files?.[0] ?? null)}
                  />
                  <button
                    onClick={() => logoInputRef.current?.click()}
                    className="btn-secondary w-full rounded-xl px-4 py-3 text-sm text-left flex items-center justify-between"
                  >
                    <span className={logo ? "text-foreground font-medium" : "text-muted"}>
                      {logo ? logo.name : "Choose a replacement logo image (PNG)"}
                    </span>
                    <span className="text-xs text-cyan-600 font-semibold">Browse</span>
                  </button>
                </div>
              )}

              {/* Resolution options */}
              <p className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Output resolution</p>
              <div className="grid grid-cols-3 gap-2.5">
                {RESOLUTION_OPTIONS.map((opt) => {
                  const needsSignIn = !isSignedIn && opt.key !== "720p";
                  const tooSmall = !!videoInfo && videoInfo.height < opt.minHeight;
                  const disabled = needsSignIn || tooSmall;
                  const active = resolution === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      disabled={disabled}
                      onClick={() => setResolution(opt.key)}
                      title={
                        needsSignIn
                          ? "Sign in to unlock higher resolutions"
                          : tooSmall
                            ? "Source video isn't high enough resolution for this option"
                            : undefined
                      }
                      className={`rounded-xl p-3 text-center transition-all border ${
                        active
                          ? "bg-cyan-50 border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.25)]"
                          : "bg-surface-3/50 border-border hover:border-border-light"
                      } ${disabled ? "cursor-not-allowed opacity-30" : ""}`}
                    >
                      <span className={`block text-sm font-bold ${active ? "text-cyan-600" : "text-foreground"}`}>
                        {opt.label}
                      </span>
                      <span className="block text-[11px] text-muted mt-0.5 font-mono">
                        {needsSignIn ? "sign in" : `${opt.credits} credit${opt.credits > 1 ? "s" : ""}`}
                      </span>
                    </button>
                  );
                })}
              </div>
              {!isSignedIn && (
                <p className="mt-2.5 text-xs text-muted">
                  Free preview at 720p, no account needed.{" "}
                  <button
                    type="button"
                    onClick={() => setShowSignInModal(true)}
                    className="underline hover:text-foreground text-cyan-600"
                  >
                    Sign in
                  </button>{" "}
                  for 1080p/4K and to download.
                </p>
              )}

              {/* Consent check */}
              <label className="mt-6 flex items-start gap-3 text-xs sm:text-sm text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-border bg-surface-3 accent-cyan-400 cursor-pointer"
                />
                <span>
                  I own this video, or have permission to edit it, and won&apos;t
                  use WipeClip.co to infringe copyright or violate a platform&apos;s
                  terms of service.{" "}
                  <Link href="/terms" className="underline hover:text-foreground text-cyan-600">
                    Terms of Service
                  </Link>
                </span>
              </label>

              {/* Process Button */}
              <button
                onClick={process}
                disabled={!region || !consent || (mode === "replace" && !logo)}
                className="btn-primary mt-6 w-full rounded-full py-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
              >
                {mode === "remove" ? "Clean Up Video Now" : "Replace Overlay Now"}
              </button>
            </div>
          )}

          {step === "processing" && (
            <div className="mt-6 py-4">
              <div className="h-3 w-full overflow-hidden rounded-full bg-surface-3 border border-border">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent via-cyan-400 to-accent-2 transition-all duration-300 shadow-[0_0_15px_rgba(34,211,238,0.5)]"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs sm:text-sm text-muted">
                <span>Inpainting frames using motion awareness…</span>
                <span className="font-mono font-bold text-cyan-600">
                  {Math.floor(elapsedMs / 60000)}:
                  {String(Math.floor((elapsedMs % 60000) / 1000)).padStart(2, "0")}
                </span>
              </div>
              {elapsedMs > 45000 && (
                <p className="mt-2 text-xs text-muted">
                  Still working — a longer or higher-resolution clip is reconstructed frame by frame
                  and can take several minutes. Keep this tab open.
                </p>
              )}
            </div>
          )}

          {step === "done" && resultUrl && (
            <div className="mt-6">
              {originalUrl && (
                <div className="mb-6">
                  <VideoCompareSlider beforeSrc={originalUrl} afterSrc={resultUrl} />
                </div>
              )}
              <div className="flex flex-col gap-3 sm:flex-row">
                {isSignedIn ? (
                  <a
                    href={resultUrl}
                    download={`unmarked-${file.name}`}
                    onClick={() => trackEvent("download_clicked", { tool: TOOL })}
                    className="flex-1 rounded-full bg-emerald-500 hover:bg-emerald-400 px-6 py-3.5 text-center text-sm font-bold text-black shadow-[0_0_25px_rgba(16,185,129,0.4)] transition-all flex items-center justify-center gap-2"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                    </svg>
                    <span>Download Clean Video</span>
                  </a>
                ) : (
                  <button
                    onClick={() => setShowSignInModal(true)}
                    className="flex-1 rounded-full bg-emerald-500 hover:bg-emerald-400 px-6 py-3.5 text-center text-sm font-bold text-black shadow-[0_0_25px_rgba(16,185,129,0.4)] transition-all flex items-center justify-center gap-2"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="4" y="10" width="16" height="10" rx="2" />
                      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                    </svg>
                    <span>Sign In to Download</span>
                  </button>
                )}
                {queue.length > 0 ? (
                  <button
                    onClick={processNextInQueue}
                    className="btn-primary rounded-full px-6 py-3.5 text-sm font-semibold"
                  >
                    Next file ({queue.length} left)
                  </button>
                ) : (
                  <button
                    onClick={reset}
                    className="btn-secondary rounded-full px-6 py-3.5 text-sm font-semibold"
                  >
                    Process Another
                  </button>
                )}
              </div>
            </div>
          )}

          {step === "error" && (
            <button
              onClick={() => (region ? process() : pickFile(file))}
              className="mt-6 w-full rounded-full bg-rose-500/20 border border-rose-500/40 px-5 py-3 text-sm font-semibold text-rose-600 hover:bg-rose-500/30 transition-all"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {error && step !== "blocked" && (
        <p className="mt-4 text-center text-xs sm:text-sm font-medium text-rose-600">{error}</p>
      )}

      <SignInModal open={showSignInModal} onClose={() => setShowSignInModal(false)} />
    </div>
  );
}
