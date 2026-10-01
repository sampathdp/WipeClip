"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ImageCompareSlider from "./ImageCompareSlider";
import SignInModal from "./SignInModal";
import { createClient } from "@/lib/supabase/client";
import { clearPendingResult, loadPendingResult, savePendingResult } from "@/lib/resultCache";
import { trackEvent, useToolView } from "@/lib/analytics";
import {
  ApiError,
  ContentBlockedError,
  InsufficientCreditsError,
  sharpenImage,
  type SharpenStrength,
} from "@/lib/toolsApi";

type Step = "idle" | "select" | "processing" | "done" | "error" | "blocked";
type BlockReason = "content" | "credits";

const MAX_BYTES = 25 * 1024 * 1024;
const TOOL = "photo_sharpener";

const STRENGTH_OPTIONS: { key: SharpenStrength; label: string }[] = [
  { key: "light", label: "Light" },
  { key: "standard", label: "Standard" },
  { key: "strong", label: "Strong" },
];

export default function PhotoSharpenerDemo() {
  useToolView(TOOL);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [blockReason, setBlockReason] = useState<BlockReason | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [strength, setStrength] = useState<SharpenStrength>("standard");
  const [consent, setConsent] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [showSignInModal, setShowSignInModal] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setIsSignedIn(Boolean(data.user)));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsSignedIn(Boolean(session?.user));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!isSignedIn || step !== "idle") return;
    let cancelled = false;
    loadPendingResult().then((pending) => {
      if (cancelled || !pending) return;
      setFile(new File([pending.originalBlob], pending.filename));
      setPreviewUrl(URL.createObjectURL(pending.originalBlob));
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
    setFile(null);
    setStep("idle");
    setError(null);
    setBlockReason(null);
    setPreviewUrl(null);
    setStrength("standard");
    setConsent(false);
    setResultUrl(null);
    void clearPendingResult();
  }, [resultUrl, previewUrl]);

  const pickFile = useCallback((picked: File | undefined) => {
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
    setPreviewUrl(URL.createObjectURL(picked));
    setStep("select");
  }, []);

  const process = useCallback(async () => {
    if (!file) return;
    setStep("processing");
    setError(null);
    trackEvent("processing_started", { tool: TOOL, strength });
    try {
      const blob = await sharpenImage(file, strength);
      setResultUrl(URL.createObjectURL(blob));
      setStep("done");
      trackEvent("processing_completed", { tool: TOOL, strength });
      window.dispatchEvent(new Event("credits:refresh"));
      if (!isSignedIn) {
        void savePendingResult({ filename: file.name, originalBlob: file, resultBlob: blob });
      }
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
      setError(e instanceof ApiError ? e.message : "Processing failed. Try again.");
      setStep("error");
      trackEvent("processing_failed", { tool: TOOL, error_category: "processing_error" });
    }
  }, [file, strength, isSignedIn]);

  return (
    <div
      id="upload"
      className="glass-card mx-auto max-w-3xl scroll-mt-28 rounded-[2rem] p-6 sm:p-10 border border-cyan-500/20 shadow-[0_20px_50px_rgba(15,23,42,0.08)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.7)]"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl text-foreground">
            Try it now: <span className="text-gradient">Sharpen Photo</span>
          </h2>
          <p className="mt-1.5 text-sm sm:text-base text-muted">
            Upload a photo, pick a strength, download the crisper version.
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
          <p className="text-base font-semibold text-foreground">Drop your photo here, or click to browse</p>
          <p className="mt-1 text-xs sm:text-sm text-muted">PNG, JPG, WebP &bull; Up to 25MB</p>
          </button>
        </>
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
            {blockReason === "credits" && (
              <Link href="/pricing" className="btn-primary rounded-full px-5 py-2.5 text-sm font-semibold">
                Buy more credits
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
            </div>
            {step !== "processing" && (
              <button onClick={reset} className="shrink-0 text-xs font-semibold text-muted transition-colors hover:text-cyan-600">
                Start over
              </button>
            )}
          </div>

          {step === "select" && previewUrl && (
            <div className="mt-5">
              <div className="flex h-80 items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt="Selected photo"
                  className="max-h-full max-w-full rounded-2xl border border-border object-contain"
                />
              </div>

              <p className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Strength</p>
              <div className="grid grid-cols-3 gap-2.5">
                {STRENGTH_OPTIONS.map((opt) => {
                  const active = strength === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setStrength(opt.key)}
                      className={`rounded-xl p-3 text-center transition-all border ${
                        active
                          ? "bg-cyan-50 border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.25)]"
                          : "bg-surface-3/50 border-border hover:border-border-light"
                      }`}
                    >
                      <span className={`block text-sm font-bold ${active ? "text-cyan-600" : "text-foreground"}`}>
                        {opt.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              <label className="mt-6 flex items-start gap-3 text-xs sm:text-sm text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-border bg-surface-3 accent-cyan-400 cursor-pointer"
                />
                <span>
                  I own this image, or have permission to edit it.{" "}
                  <Link href="/terms" className="underline hover:text-foreground text-cyan-600">
                    Terms of Service
                  </Link>
                </span>
              </label>

              <button
                onClick={process}
                disabled={!consent}
                className="btn-primary mt-6 w-full rounded-full py-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
              >
                Sharpen Photo Now
              </button>
            </div>
          )}

          {step === "processing" && (
            <div className="mt-6 flex flex-col items-center gap-4 py-8 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500/20 border-t-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.4)]" />
              <p className="text-sm font-medium text-foreground">Sharpening…</p>
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
                {isSignedIn ? (
                  <a
                    href={resultUrl}
                    download={`sharpened-${file.name.replace(/\.[^.]+$/, "")}.png`}
                    onClick={() => trackEvent("download_clicked", { tool: TOOL })}
                    className="flex-1 rounded-full bg-emerald-500 hover:bg-emerald-400 px-6 py-3.5 text-center text-sm font-bold text-black shadow-[0_0_25px_rgba(16,185,129,0.4)] transition-all flex items-center justify-center gap-2"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                    </svg>
                    <span>Download Sharpened Photo</span>
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
                <button onClick={reset} className="btn-secondary rounded-full px-6 py-3.5 text-sm font-semibold">
                  Process Another
                </button>
              </div>

              <div className="mt-6 rounded-2xl border border-cyan-500/20 bg-cyan-50/70 p-4 text-center">
                <p className="text-xs sm:text-sm text-muted">
                  Also need to remove an object, timestamp or caption from your own photo or video?{" "}
                  <Link href="/" className="font-semibold text-cyan-600 underline hover:text-cyan-700">
                    Try WipeClip.co&apos;s AI cleanup free
                  </Link>
                </p>
              </div>
            </div>
          )}

          {step === "error" && (
            <button
              onClick={process}
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
