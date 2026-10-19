"use client";

/** In-app picker for what to record (Windows native capture): displays and
 * app windows with live-ish thumbnails, instead of the system's share
 * dialog. */
import { useCallback, useEffect, useRef, useState } from "react";
import { captureSources, captureThumbnail, type NativeCaptureSource } from "@/lib/platform/recorder";

const THUMB_W = 400;
const THUMB_H = 225;

export function imageDataUrl(img: ImageData): string {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0);
  return c.toDataURL("image/jpeg", 0.8);
}

export default function SourcePicker({ onPick, disabled }: { onPick: (s: NativeCaptureSource) => void; disabled?: boolean }) {
  const [tab, setTab] = useState<"monitor" | "window">("monitor");
  const [sources, setSources] = useState<NativeCaptureSource[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const gen = ++generation.current;
    setError(null);
    try {
      const list = await captureSources();
      if (gen !== generation.current) return;
      setSources(list);
      // One at a time: each is a GDI copy of a whole display or window.
      for (const s of list) {
        if (s.minimized) continue;
        try {
          const url = imageDataUrl(await captureThumbnail(s.id, THUMB_W, THUMB_H));
          if (gen !== generation.current) return;
          setThumbs((t) => ({ ...t, [s.id]: url }));
        } catch {
          // closed meanwhile, or nothing to show
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't list screens and windows.");
    }
  }, []);

  useEffect(() => {
    const gen = generation;
    queueMicrotask(() => void load());
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      gen.current++;
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const shown = (sources ?? []).filter((s) => s.kind === tab);
  const count = (k: NativeCaptureSource["kind"]) => (sources ?? []).filter((s) => s.kind === k).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div role="tablist" className="inline-flex rounded-full border border-border bg-surface p-0.5 text-xs font-semibold">
          {(["monitor", "window"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`rounded-full px-3 py-1.5 ${tab === k ? "bg-accent-2 text-white" : "text-muted hover:text-foreground"}`}
            >
              {k === "monitor" ? "Entire screen" : "Window"}
              {sources && <span className="ml-1 opacity-70">{count(k)}</span>}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => void load()} className="ml-auto text-xs font-semibold text-accent-2 underline">
          Refresh
        </button>
      </div>
      {error && <p className="text-xs text-rose-500">{error}</p>}
      {!sources && !error && <p className="py-10 text-center text-xs text-muted">Looking for screens and windows…</p>}
      {sources && shown.length === 0 && (
        <p className="py-10 text-center text-xs text-muted">{tab === "window" ? "No app windows are open." : "No displays found."}</p>
      )}
      <div className="grid max-h-[360px] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
        {shown.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={disabled || s.minimized}
            onClick={() => onPick(s)}
            title={s.minimized ? "Restore this window to record it" : s.name}
            className="group flex min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-surface p-1.5 text-left hover:border-accent-2/60 hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
              {thumbs[s.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbs[s.id]} alt="" className="h-full w-full object-contain" />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center text-[11px] text-white/60">{s.minimized ? "Minimized" : "…"}</span>
              )}
            </div>
            <div className="min-w-0 px-0.5">
              <div className="truncate text-xs font-semibold text-foreground">{s.name}</div>
              <div className="truncate text-[11px] text-muted">
                {s.kind === "monitor" ? `${s.bounds.width}×${s.bounds.height}` : (s.app ?? "App window")}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
