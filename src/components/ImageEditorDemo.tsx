"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import RegionSelector from "./RegionSelector";
import ImageCompareSlider from "./ImageCompareSlider";
import { createClient } from "@/lib/supabase/client";
import { trackEvent, useToolView } from "@/lib/analytics";
import {
  ApiError,
  AuthRequiredError,
  ContentBlockedError,
  InsufficientCreditsError,
  ProRequiredError,
  processImage,
  type Region,
} from "@/lib/toolsApi";

type Step = "idle" | "reading" | "select" | "processing" | "done" | "error" | "blocked";
type BlockReason = "content" | "credits" | "auth" | "pro";
type PlanState = "loading" | "pro" | "not-pro";

const MAX_BYTES = 25 * 1024 * 1024;
const TOOL = "image_object_remover";

export default function ImageEditorDemo() {
  useToolView(TOOL);
  const [planState, setPlanState] = useState<PlanState>("loading");
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [blockReason, setBlockReason] = useState<BlockReason | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [consent, setConsent] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // /api/credits 401s for a signed-out caller, so this checks sign-in
  // state client-side first (no network round-trip, reads the local
  // session) and skips the doomed request entirely when signed out -
  // straight to "not-pro", which is the correct outcome either way.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      if (!data.user) {
        setPlanState("not-pro");
        return;
      }
      fetch("/api/credits")
        .then((res) => (res.ok ? res.json() : null))
        .then((creditsData) => {
          if (!cancelled) setPlanState(creditsData?.plan === "pro" ? "pro" : "not-pro");
        })
        .catch(() => {
          if (!cancelled) setPlanState("not-pro");
        });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const reset = useCallback(() => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setStep("idle");
    setError(null);
    setBlockReason(null);
    setNaturalSize(null);
    setPreviewUrl(null);
    setRegion(null);
    setConsent(false);
    setResultUrl(null);
  }, [resultUrl, previewUrl]);

  const pickFile = useCallback(async (picked: File | undefined) => {
    if (!picked) return;
    trackEvent("file_selected", { tool: TOOL });
    if (!picked.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (picked.size > MAX_BYTES) {
      setError("File exceeds the 25MB limit.");
      return;
    }
    setError(null);
    setFile(picked);
    const url = URL.createObjectURL(picked);
    setPreviewUrl(url);
    setStep("reading");
    try {
      const img = new Image();
      const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => reject(new Error("Could not read that image."));
        img.src = url;
      });
      setNaturalSize(size);
      setStep("select");
      trackEvent("mask_started", { tool: TOOL });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that image.");
      setStep("error");
    }
  }, []);

  const process = useCallback(async () => {
    if (!file || !region) return;
    setStep("processing");
    setError(null);
    trackEvent("mask_completed", { tool: TOOL });
    trackEvent("processing_started", { tool: TOOL });
    try {
      const blob = await processImage(file, region);
      setResultUrl(URL.createObjectURL(blob));
      setStep("done");
      trackEvent("processing_completed", { tool: TOOL });
      window.dispatchEvent(new Event("credits:refresh"));
    } catch (e) {
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
      if (e instanceof AuthRequiredError) {
        setError(e.message);
        setBlockReason("auth");
        setStep("blocked");
        trackEvent("processing_failed", { tool: TOOL, error_category: "auth_required" });
        return;
      }
      if (e instanceof ProRequiredError) {
        setError(e.message);
        setBlockReason("pro");
        setStep("blocked");
        trackEvent("processing_failed", { tool: TOOL, error_category: "pro_required" });
        return;
      }
      setError(e instanceof ApiError ? e.message : "Processing failed. Try again.");
      setStep("error");
      trackEvent("processing_failed", { tool: TOOL, error_category: "processing_error" });
    }
  }, [file, region]);

  // Renders the real headline + a placeholder dropzone (same footprint as
  // the interactive one below) instead of a bare spinner card - this text
  // is already part of the server-rendered HTML since "loading" is the
  // initial state, so it paints without waiting on the client-side plan
  // check, and swapping to the real dropzone/upsell afterward causes no
  // layout shift.
  if (planState === "loading") {
    return (
      <div className="glass-card mx-auto max-w-3xl rounded-[2rem] p-6 sm:p-10 border border-cyan-500/20">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl text-foreground">
            AI Image <span className="text-gradient">Cleanup</span>
          </h2>
          <p className="mt-1.5 text-sm sm:text-base text-muted">
            Upload a photo you took, mark the unwanted object once, download the clean version.
          </p>
        </div>
        <div className="mt-8 flex w-full flex-col items-center justify-center gap-3 rounded-[1.75rem] border-2 border-dashed border-border px-6 py-14 text-center opacity-60">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-500/20 border-t-cyan-400" />
          <span className="text-sm font-medium text-muted">Checking your plan…</span>
        </div>
      </div>
    );
  }

  if (planState === "not-pro") {
    return (
      <div className="glass-card mx-auto max-w-3xl rounded-[2rem] p-6 sm:p-10 border border-cyan-500/20 text-center">
        <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl text-foreground">
          Image tool is a <span className="text-gradient">Pro</span> feature
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm sm:text-base text-muted">
          Object removal for images, and unattended access to auto-enhance, is included
          on the $23.99/mo Pro plan.
        </p>
        <Link href="/pricing" className="btn-primary mt-6 inline-flex rounded-full px-6 py-3 text-sm font-semibold">
          Upgrade to Pro
        </Link>
      </div>
    );
  }

  return (
    <div
      id="image-tool"
      className="glass-card mx-auto max-w-3xl scroll-mt-28 rounded-[2rem] p-6 sm:p-10 border border-cyan-500/20 shadow-[0_20px_50px_rgba(15,23,42,0.08)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.7)]"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl text-foreground">
            AI Image <span className="text-gradient">Cleanup</span>
          </h2>
          <p className="mt-1.5 text-sm sm:text-base text-muted">
            Upload a photo you took, mark the unwanted object once, download the clean version.
          </p>
        </div>
      </div>

      {step === "idle" && !file && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
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
              pickFile(e.dataTransfer.files?.[0]);
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
          <p className="text-base font-semibold text-foreground">Drop your image here, or click to browse</p>
          <p className="mt-1 text-xs sm:text-sm text-muted">PNG, JPG, WebP &bull; Up to 25MB</p>
          </button>
        </>
      )}

      {step === "reading" && (
        <div className="mt-8 flex flex-col items-center gap-4 rounded-[1.75rem] bg-surface-2/70 border border-border p-12 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500/20 border-t-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.4)]" />
          <p className="text-sm font-medium text-foreground">Reading image…</p>
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
            {error ?? "This image can't be processed here."}
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
            {(blockReason === "credits" || blockReason === "pro") && (
              <Link href="/pricing" className="btn-primary rounded-full px-5 py-2.5 text-sm font-semibold">
                {blockReason === "pro" ? "Upgrade to Pro" : "Buy more credits"}
              </Link>
            )}
            {blockReason === "auth" && (
              <Link href="/sign-in" className="btn-primary rounded-full px-5 py-2.5 text-sm font-semibold">
                Sign in
              </Link>
            )}
            <button onClick={reset} className="btn-secondary rounded-full px-5 py-2.5 text-sm font-semibold">
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
                {naturalSize ? `${naturalSize.width}×${naturalSize.height}` : ""}
              </p>
            </div>
            {step !== "processing" && (
              <button onClick={reset} className="shrink-0 text-xs font-semibold text-muted transition-colors hover:text-cyan-600">
                Start over
              </button>
            )}
          </div>

          {step === "select" && previewUrl && naturalSize && (
            <div className="mt-5">
              <RegionSelector
                previewUrl={previewUrl}
                naturalWidth={naturalSize.width}
                naturalHeight={naturalSize.height}
                onChange={setRegion}
              />

              <label className="mt-6 flex items-start gap-3 text-xs sm:text-sm text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-border bg-surface-3 accent-cyan-400 cursor-pointer"
                />
                <span>
                  I created this image or have the rights to edit it, and the area I marked
                  is not a watermark, logo or other ownership or copyright mark.{" "}
                  <Link href="/terms" className="underline hover:text-foreground text-cyan-600">
                    Terms of Service
                  </Link>
                </span>
              </label>

              <button
                onClick={process}
                disabled={!region || !consent}
                className="btn-primary mt-6 w-full rounded-full py-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clean Up Image
              </button>
            </div>
          )}

          {step === "processing" && (
            <div className="mt-6 flex flex-col items-center gap-4 py-8 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500/20 border-t-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.4)]" />
              <p className="text-sm font-medium text-foreground">Reconstructing the marked region…</p>
            </div>
          )}

          {step === "done" && resultUrl && (
            <div className="mt-6">
              {previewUrl && (
                <div className="mb-6">
                  <ImageCompareSlider beforeSrc={previewUrl} afterSrc={resultUrl} />
                </div>
              )}
              <div className="flex flex-col gap-3 sm:flex-row">
                <a
                  href={resultUrl}
                  download={`cleaned-${file.name.replace(/\.[^.]+$/, "")}.png`}
                  onClick={() => trackEvent("download_clicked", { tool: TOOL })}
                  className="flex-1 rounded-full bg-emerald-500 hover:bg-emerald-400 px-6 py-3.5 text-center text-sm font-bold text-black shadow-[0_0_25px_rgba(16,185,129,0.4)] transition-all flex items-center justify-center gap-2"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                  <span>Download Clean Image</span>
                </a>
                <button onClick={reset} className="btn-secondary rounded-full px-6 py-3.5 text-sm font-semibold">
                  Process Another
                </button>
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
    </div>
  );
}
