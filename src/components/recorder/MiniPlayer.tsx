"use client";

/** The recording mini player (desktop app, Windows): a small always-on-top
 * window (label "recorder-mini", route /mini/) opened by the recorder while
 * it records. It shows what is being recorded, the time, and Pause/Marker/
 * Stop. The window is excluded from screen capture (src-tauri lib.rs
 * recorder_mini), so it never shows up in the video.
 *
 * State comes from the recorder window as "recorder://mini-state" events;
 * buttons go back as "recorder://mini-action" events (stop only ever stops,
 * unlike the start/stop hotkey).
 */
import { useEffect, useRef, useState } from "react";
import { capturePreview, MINI_STATE_EVENT, sendMiniAction, type MiniState } from "@/lib/platform/recorder";
import { formatDuration } from "@/lib/recorder/clock";
import { isLowEndMachine } from "@/lib/platform";
import { PauseIcon, PlayIcon } from "@/components/editor/icons";

/** Preview refresh: a GPU readback of the recorded frame each time, so
 * slower on a modest computer (isLowEndMachine), where it competes with
 * the encoder. */
const PREVIEW_MS = 250;
const PREVIEW_MS_LOW_END = 500;

function draw(canvas: HTMLCanvasElement, img: ImageData) {
  if (canvas.width !== img.width || canvas.height !== img.height) {
    canvas.width = img.width;
    canvas.height = img.height;
  }
  canvas.getContext("2d")?.putImageData(img, 0, 0);
}

export default function MiniPlayer() {
  const [state, setState] = useState<MiniState>({ elapsedMs: 0, status: "recording" });
  const [hasFrame, setHasFrame] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let off: (() => void) | undefined;
    let cancelled = false;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<MiniState>(MINI_STATE_EVENT, (e) => setState(e.payload)).then((fn) => {
        if (cancelled) fn();
        else off = fn;
      })
    );
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    void (async () => {
      const every = (await isLowEndMachine()) ? PREVIEW_MS_LOW_END : PREVIEW_MS;
      while (!stopped) {
        if (!document.hidden) {
          try {
            const img = await capturePreview(608, 342);
            if (stopped) return;
            if (canvasRef.current) draw(canvasRef.current, img);
            setHasFrame(true);
          } catch {
            // not started yet, or just stopped
          }
        }
        await new Promise((r) => setTimeout(r, every));
      }
    })();
    return () => {
      stopped = true;
    };
  }, []);

  const paused = state.status === "paused";
  const stopping = state.status === "stopping";

  return (
    <div className="flex h-screen select-none flex-col overflow-hidden border border-white/10 bg-[#0b0c12] text-white">
      <div data-tauri-drag-region className="flex h-8 shrink-0 cursor-move items-center gap-2 px-3 text-xs">
        <span
          data-tauri-drag-region
          className={`h-2.5 w-2.5 rounded-full ${paused ? "bg-amber-400" : "animate-pulse bg-rose-500"}`}
          aria-hidden
        />
        <span data-tauri-drag-region className="font-semibold tabular-nums">
          {stopping ? "Saving…" : paused ? `Paused · ${formatDuration(state.elapsedMs)}` : formatDuration(state.elapsedMs)}
        </span>
        <span data-tauri-drag-region className="ml-auto text-[10px] text-white/50" title="This window never shows up in the recording">
          Not in the video
        </span>
      </div>
      <div data-tauri-drag-region className="relative mx-2 min-h-0 flex-1 overflow-hidden rounded-md bg-black">
        <canvas ref={canvasRef} data-tauri-drag-region className="h-full w-full object-contain" />
        {!hasFrame && (
          <span data-tauri-drag-region className="absolute inset-0 flex items-center justify-center text-[11px] text-white/50">
            Waiting for the first frame…
          </span>
        )}
      </div>
      <div className="flex h-12 shrink-0 items-center justify-center gap-2 px-3">
        <button
          type="button"
          disabled={stopping}
          onClick={() => void sendMiniAction("pause")}
          className="flex h-8 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-semibold hover:bg-white/20 disabled:opacity-40"
          aria-label={paused ? "Resume" : "Pause"}
        >
          {paused ? <PlayIcon className="h-3.5 w-3.5" /> : <PauseIcon className="h-3.5 w-3.5" />}
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          disabled={stopping}
          onClick={() => void sendMiniAction("marker")}
          className="h-8 rounded-full bg-white/10 px-3 text-xs font-semibold hover:bg-white/20 disabled:opacity-40"
        >
          Marker
        </button>
        <button
          type="button"
          disabled={stopping}
          onClick={() => void sendMiniAction("stop")}
          className="flex h-8 items-center gap-1.5 rounded-full bg-rose-600 px-3 text-xs font-semibold hover:bg-rose-500 disabled:opacity-40"
        >
          <span className="h-2.5 w-2.5 rounded-[2px] bg-white" aria-hidden />
          Stop
        </button>
      </div>
    </div>
  );
}
