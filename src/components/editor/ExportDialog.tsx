"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { canExportAt, premiumFeaturesUsed, TIER_LABELS, TIER_LIMITS, tierForResolution, type Tier } from "@/lib/entitlements";
import { trackEvent } from "@/lib/analytics";
import { PLANS } from "@/lib/credits";
import { DEFAULT_OUTPUT, exportProject, OUTPUT_EXT, type ExportOutput } from "@/lib/editor/exportProject";
import { saveLastExport } from "@/lib/editor/projectStore";
import { canvasSize, formatTime } from "@/lib/editor/timeline";
import type { MediaSource, Project } from "@/lib/editor/types";
import { ContentBlockedError, PlanRequiredError, type RenderProgress, type Resolution } from "@/lib/toolsApi";
import { IS_DESKTOP, notifyIfAway, revealExport, saveExportFile } from "@/lib/platform";
import Dialog from "./Dialog";
import { ExportIcon } from "./icons";
import PremiumBadge from "./PremiumBadge";
import ToolFeedback from "@/components/ToolFeedback";
import { sourceName } from "@/lib/editor/sourceFile";

const TOOL = "video_editor";
const TIERS: { key: Resolution; short: number }[] = [
  { key: "720p", short: 720 },
  { key: "1080p", short: 1080 },
  { key: "4k", short: 2160 },
];

const GIF_MAX_SECONDS = 60; // EDITOR_MAX_GIF_SECONDS in backend/app/config.py

/** File type, quality and frame rate of the export. */
function OutputOptions({ output, onChange, total, locked }: { output: ExportOutput; onChange: (o: ExportOutput) => void; total: number; locked: boolean }) {
  const select = "w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground";
  // Premium choices are marked for plans without them (entitlements.ts PREMIUM).
  const pro = (label: string) => (locked ? `${label} · Premium` : label);
  return (
    <div className="grid grid-cols-3 gap-2 text-xs">
      <label className="space-y-1">
        <span className="font-semibold uppercase tracking-wider text-muted">Format</span>
        <select className={select} value={output.format} onChange={(e) => onChange({ ...output, format: e.target.value as ExportOutput["format"] })}>
          <option value="mp4">MP4 video</option>
          <option value="gif" disabled={total > GIF_MAX_SECONDS}>
            {pro("GIF")}
            {total > GIF_MAX_SECONDS ? ` (max ${GIF_MAX_SECONDS}s)` : ""}
          </option>
          <option value="audio">{pro("Audio only (M4A)")}</option>
        </select>
      </label>
      <label className="space-y-1">
        <span className="font-semibold uppercase tracking-wider text-muted">Quality</span>
        <select className={select} value={output.quality} disabled={output.format !== "mp4"} onChange={(e) => onChange({ ...output, quality: e.target.value as ExportOutput["quality"] })}>
          <option value="standard">Standard</option>
          <option value="high">{pro("High")}</option>
          <option value="max">{pro("Best (bigger file)")}</option>
        </select>
      </label>
      <label className="space-y-1">
        <span className="font-semibold uppercase tracking-wider text-muted">Frame rate</span>
        <select
          className={select}
          value={output.fps ?? ""}
          disabled={output.format !== "mp4"}
          onChange={(e) => onChange({ ...output, fps: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Original</option>
          {[24, 25, 30, 50, 60].map((f) => (
            <option key={f} value={f}>
              {f > 30 ? pro(`${f} fps`) : `${f} fps`}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

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
  tier,
  initialResult,
  onClose,
  onSignIn,
}: {
  project: Project;
  sources: Record<string, MediaSource>;
  originalId: string;
  total: number;
  isSignedIn: boolean;
  tier: Tier;
  initialResult: Blob | null;
  onClose: () => void;
  onSignIn: () => void;
}) {
  const original = sources[originalId];
  // Output follows the canvas (its aspect at the original's short side).
  const canvas = canvasSize(project.canvas.aspect, original.width, original.height);
  const shortSide = Math.min(canvas.width, canvas.height);
  // A tier is only offered if it actually yields more pixels than the one below.
  const available = TIERS.filter((t, i) => i === 0 || shortSide > TIERS[i - 1].short);
  const allowed = (r: Resolution) => (isSignedIn ? canExportAt(tier, r) : r === "720p");
  const [output, setOutput] = useState<ExportOutput>(DEFAULT_OUTPUT);
  const [resolution, setResolution] = useState<Resolution>(
    () => [...available].reverse().find((t) => allowed(t.key))?.key ?? "720p"
  );
  const limits = TIER_LIMITS[tier];
  const premium = limits.premiumEffects
    ? []
    : premiumFeaturesUsed({ ...project, format: output.format, quality: output.quality, fps: output.fps ?? undefined, fpsChosen: output.fps !== null });
  const [state, setState] = useState<"setup" | "rendering" | "done" | "error">(initialResult ? "done" : "setup");
  const [error, setError] = useState<{ message: string; upgrade?: boolean } | null>(null);
  const [result, setResult] = useState<{ blob: Blob; url: string } | null>(() =>
    initialResult ? { blob: initialResult, url: URL.createObjectURL(initialResult) } : null
  );
  const [elapsed, setElapsed] = useState(0);
  /** Progress the local engine reports (desktop); null = unknown. */
  const [render, setRender] = useState<RenderProgress | null>(null);
  /** `elapsed` when rendering proper began, for the time-left estimate. */
  const [renderFrom, setRenderFrom] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    return () => {
      if (result) URL.revokeObjectURL(result.url);
    };
  }, [result]);

  const start = async () => {
    setState("rendering");
    setError(null);
    setRender(null);
    setRenderFrom(null);
    cancelledRef.current = false;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - started), 500);
    const controller = new AbortController();
    abortRef.current = controller;
    const hardStop = setTimeout(() => controller.abort(), 20 * 60 * 1000);
    trackEvent("processing_started", { tool: TOOL, resolution });
    try {
      const blob = await exportProject(
        project,
        sources,
        originalId,
        isSignedIn ? resolution : "720p",
        controller.signal,
        (p) => {
          setRender(p);
          if (p.phase === "rendering") setRenderFrom((from) => from ?? Date.now() - started);
        },
        output
      );
      setResult({ blob, url: URL.createObjectURL(blob) });
      setState("done");
      void notifyIfAway("Export finished", `"${filename}" is ready to save in WipeClip.`);
      trackEvent("processing_completed", { tool: TOOL, resolution });
      // Survives a sign-in redirect, so an anonymous export isn't lost
      // (and re-rendered) just to download it.
      if (!isSignedIn) void saveLastExport(blob);
    } catch (e) {
      if (cancelledRef.current) {
        setState("setup");
        return;
      }
      console.error("[editor] export failed", e);
      void notifyIfAway("Export failed", "Open WipeClip to see why. Your project is safe.");
      if (controller.signal.aborted) {
        setError({ message: "Export took too long. Try a shorter video or a lower resolution. Your project is safe." });
      } else if (e instanceof PlanRequiredError) {
        setError({ message: e.message, upgrade: true });
      } else if (e instanceof ContentBlockedError) {
        setError({ message: e.message });
      } else if (e instanceof TypeError) {
        setError({ message: "Network problem during export. Check your connection and try again. Your project is safe." });
      } else {
        const msg = e instanceof Error ? e.message : "";
        setError({
          message:
            /limit|sign in|too long|too large|upgrade/i.test(msg) && msg.length < 160
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

  const filename = `wipeclip-${sourceName(original).replace(/\.[^.]+$/, "")}-edit.${OUTPUT_EXT[output.format]}`;

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
              <p className="text-muted">Layers</p>
              <p className="font-semibold text-foreground">{project.overlays.length + project.audio.length + project.effects.length}</p>
            </div>
          </div>
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Resolution</p>
            <div className="grid gap-2" role="radiogroup" aria-label="Export resolution">
              {available.map((t) => {
                const size = outputSize(canvas.width, canvas.height, t.short);
                const locked = !allowed(t.key);
                const lockLabel = !isSignedIn ? "sign in" : `${TIER_LABELS[tierForResolution(t.key)]} plan`;
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
                      {locked ? lockLabel : isSignedIn ? "included" : "free preview"}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-muted">
              Frame rate matches your original; the aspect ratio follows your canvas. Videos are never upscaled.
            </p>
            {isSignedIn && limits.maxResolution !== "4k" && (
              <p className="mt-2 text-xs text-muted">
                Your {TIER_LABELS[tier]} plan exports up to {limits.maxResolution}.{" "}
                <Link href="/pricing" className="font-semibold text-accent underline">
                  Upgrade
                </Link>{" "}
                for {tier === "free" ? "1080p or 4K" : "4K"}.
              </p>
            )}
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
          <OutputOptions output={output} onChange={setOutput} total={total} locked={!limits.premiumEffects} />
          {limits.exportBranding && premium.length === 0 && (
            <p className="text-xs text-muted">
              Free exports include a small &quot;Made with WipeClip&quot; mark in the corner.{" "}
              <Link href="/pricing" className="font-semibold text-accent underline">
                Upgrade
              </Link>{" "}
              to remove it.
            </p>
          )}
          {premium.length > 0 && (
            <div className="rounded-xl border border-amber-400/50 bg-amber-400/10 p-3 text-xs">
              <p className="flex items-center gap-1.5 font-semibold text-foreground">
                <PremiumBadge className="shrink-0" /> This project uses premium features
              </p>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-muted">
                {premium.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <p className="mt-2 text-muted">Any paid plan (from Lite, {PLANS.lite.priceLabel} for 30 days) exports them. Or swap them for free ones.</p>
            </div>
          )}
          {premium.length > 0 ? (
            <Link href="/pricing" className="btn-primary flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold">
              See plans
            </Link>
          ) : (
            <button type="button" onClick={start} className="btn-primary flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold">
              <ExportIcon width={16} height={16} /> Export
            </button>
          )}
        </div>
      )}

      {state === "rendering" && (
        <div className="space-y-3 py-8 text-center" role="status" aria-live="polite">
          <div
            className="mx-auto h-2 w-full max-w-sm overflow-hidden rounded-full bg-surface-3"
            role="progressbar"
            aria-label="Export progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={render?.progress != null ? Math.round(render.progress * 100) : undefined}
          >
            {render?.progress != null ? (
              <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2 transition-[width] duration-500" style={{ width: `${Math.max(2, render.progress * 100)}%` }} />
            ) : (
              <div className="h-full w-1/3 animate-[editor-indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-accent to-accent-2" />
            )}
          </div>
          <p className="text-sm font-medium text-foreground">
            {render?.phase === "checking"
              ? "Checking your videos…"
              : render?.progress != null
                ? `Rendering your video… ${Math.floor(render.progress * 100)}%`
                : "Rendering your video…"}
          </p>
          <p className="font-mono text-xs text-muted">
            {clock(elapsed)}
            {render?.progress != null && renderFrom !== null && render.progress > 0.03 && (
              <> · about {clock(((elapsed - renderFrom) * (1 - render.progress)) / render.progress)} left</>
            )}
          </p>
          <p className="text-xs text-muted">
            {IS_DESKTOP ? "Rendering on this computer. Keep WipeClip open; you'll get a notification when it's done." : "Uploading, then applying every cut, transition and sticker. Keep this tab open."}
          </p>
          <button
            type="button"
            onClick={() => {
              cancelledRef.current = true;
              abortRef.current?.abort();
            }}
            className="btn-secondary rounded-full px-4 py-2 text-xs font-semibold"
          >
            Cancel export
          </button>
        </div>
      )}

      {state === "done" && result && (
        <div className="space-y-4">
          {output.format === "gif" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={result.url} alt="Exported GIF" className="max-h-[50dvh] w-full rounded-xl bg-black object-contain" />
          ) : output.format === "audio" ? (
            <audio src={result.url} controls className="w-full" />
          ) : (
            <video src={result.url} controls playsInline className="max-h-[50dvh] w-full rounded-xl bg-black" />
          )}
          {isSignedIn && IS_DESKTOP ? (
            <DesktopSaveButton blob={result.blob} filename={filename} />
          ) : isSignedIn ? (
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
          <ToolFeedback tool={TOOL} className="" />
        </div>
      )}

      {state === "error" && error && (
        <div className="space-y-4 py-4 text-center">
          <p className="text-sm font-semibold text-rose-600 dark:text-rose-400" role="alert">
            {error.message}
          </p>
          <div className="flex justify-center gap-2">
            {error.upgrade ? (
              <Link href="/pricing" className="btn-primary rounded-full px-5 py-2.5 text-sm font-semibold">
                See plans
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

/** Desktop app: "Save MP4" opens the OS save dialog instead of a browser
 * download (see saveExportFile in src/lib/platform). */
function DesktopSaveButton({ blob, filename }: { blob: Blob; filename: string }) {
  const [state, setState] = useState<{ kind: "idle" | "saving" } | { kind: "saved"; path: string } | { kind: "error"; message: string }>({
    kind: "idle",
  });

  const save = async () => {
    setState({ kind: "saving" });
    trackEvent("download_clicked", { tool: TOOL });
    try {
      const res = await saveExportFile(blob, filename);
      setState(res.status === "saved" ? { kind: "saved", path: res.path } : { kind: "idle" });
    } catch (e) {
      console.error("[editor] save failed", e);
      setState({ kind: "error", message: typeof e === "string" ? e : e instanceof Error ? e.message : "Couldn't save the file." });
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={save}
        disabled={state.kind === "saving"}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-emerald-500 py-3 text-sm font-bold text-black hover:bg-emerald-400 disabled:opacity-60"
      >
        <ExportIcon width={16} height={16} /> {state.kind === "saving" ? "Saving…" : "Save MP4…"}
      </button>
      {state.kind === "saved" && (
        <p className="text-center text-xs text-muted" role="status">
          Saved to <span className="break-all font-mono">{state.path}</span>{" "}
          <button type="button" onClick={() => void revealExport(state.path)} className="font-semibold text-accent underline">
            Show in folder
          </button>
        </p>
      )}
      {state.kind === "error" && (
        <p className="text-center text-xs font-semibold text-rose-600 dark:text-rose-400" role="alert">
          {state.message} Your export is still here - try another folder.
        </p>
      )}
    </div>
  );
}

/** m:ss for a duration in milliseconds. */
function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
