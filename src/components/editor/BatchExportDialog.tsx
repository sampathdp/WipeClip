"use client";

import { useEffect, useRef, useState } from "react";
import { canExportAt, type Tier } from "@/lib/entitlements";
import { exportProject } from "@/lib/editor/exportProject";
import type { MediaSource, Project } from "@/lib/editor/types";
import { IS_DESKTOP, chooseExportFolder, revealExport, saveExportInFolder } from "@/lib/platform";
import { PlanRequiredError, type Resolution } from "@/lib/toolsApi";
import Dialog from "./Dialog";

export type BatchFormat = "project" | "vertical" | "square";

export interface BatchItem {
  id: string;
  title: string;
  /** A copy of the project holding only this highlight (highlightProject). */
  project: Project;
  fileName: string;
}

type Status = { kind: "waiting" } | { kind: "rendering" } | { kind: "saved"; path: string } | { kind: "failed"; message: string } | { kind: "skipped" };

/** Exports several highlights as separate files, one after the other, with
 * the same renderer as a single export. Desktop: one folder for all of them
 * (nothing there is replaced); website: one download each. Each copy is
 * reframed first when a vertical or square format is chosen. The project
 * itself never changes. */
export default function BatchExportDialog({
  items,
  sources,
  originalId,
  isSignedIn,
  tier,
  defaultFormat,
  reframe,
  onExported,
  onClose,
}: {
  items: BatchItem[];
  sources: Record<string, MediaSource>;
  originalId: string;
  isSignedIn: boolean;
  tier: Tier;
  defaultFormat: BatchFormat;
  /** The copy in that format, with notes on what reframing did. */
  reframe: (p: Project, format: BatchFormat) => { project: Project; notes: string[] };
  onExported: (count: number) => void;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<BatchFormat>(defaultFormat);
  const resolutions: Resolution[] = ["720p", "1080p"];
  const allowed = (r: Resolution) => (isSignedIn ? canExportAt(tier, r) : r === "720p");
  const [resolution, setResolution] = useState<Resolution>(() => [...resolutions].reverse().find(allowed) ?? "720p");
  const [running, setRunning] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [notes, setNotes] = useState<string[]>([]);
  const [lastPath, setLastPath] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const set = (id: string, s: Status) => setStatuses((prev) => ({ ...prev, [id]: s }));

  const start = async () => {
    const folder = await chooseExportFolder().catch((e) => {
      setNotes([typeof e === "string" ? e : "Couldn't open the folder."]);
      return null;
    });
    if (!folder) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setRunning(true);
    setNotes([]);
    setStatuses(Object.fromEntries(items.map((i) => [i.id, { kind: "waiting" } as Status])));
    let saved = 0;
    const seen = new Set<string>();
    for (const item of items) {
      if (ctrl.signal.aborted) {
        set(item.id, { kind: "skipped" });
        continue;
      }
      set(item.id, { kind: "rendering" });
      try {
        const { project, notes: n } = reframe(item.project, format);
        for (const x of n) if (!seen.has(x)) {
          seen.add(x);
          setNotes((prev) => [...prev, x]);
        }
        const blob = await exportProject(project, sources, originalId, resolution, ctrl.signal);
        if (!(blob instanceof Blob)) throw new Error("Export failed.");
        const res = await saveExportInFolder(folder, blob, item.fileName);
        if (res.status === "saved") {
          saved++;
          setLastPath(res.path);
          set(item.id, { kind: "saved", path: res.path });
        } else set(item.id, { kind: "skipped" });
      } catch (e) {
        if (ctrl.signal.aborted) {
          set(item.id, { kind: "skipped" });
          continue;
        }
        const message = e instanceof PlanRequiredError ? e.message : typeof e === "string" ? e : e instanceof Error && e.message.length < 160 ? e.message : "Export failed.";
        set(item.id, { kind: "failed", message });
        // A plan limit applies to every item: stop instead of failing each.
        if (e instanceof PlanRequiredError) ctrl.abort();
      }
    }
    if (saved) onExported(saved);
    setRunning(false);
    abort.current = null;
  };

  const done = !running && Object.keys(statuses).length > 0;
  const label = (s: Status | undefined) =>
    !s ? "" : s.kind === "waiting" ? "Waiting" : s.kind === "rendering" ? "Exporting…" : s.kind === "saved" ? "Saved" : s.kind === "skipped" ? "Not exported" : `Failed: ${s.message}`;

  return (
    <Dialog title={`Export ${items.length} highlight${items.length === 1 ? "" : "s"}`} onClose={running ? undefined : onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-xs text-muted">
          Each highlight becomes its own video file. Your project and recordings don&apos;t change.
          {IS_DESKTOP ? " You choose a folder once; files already in it are never replaced." : " Each file downloads separately."}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-semibold text-foreground">
            Format
            <select className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" value={format} disabled={running} onChange={(e) => setFormat(e.target.value as BatchFormat)}>
              <option value="project">Same as the project</option>
              <option value="vertical">Vertical 9:16</option>
              <option value="square">Square 1:1</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-foreground">
            Resolution
            <select className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm" value={resolution} disabled={running} onChange={(e) => setResolution(e.target.value as Resolution)}>
              {resolutions.map((r) => (
                <option key={r} value={r} disabled={!allowed(r)}>
                  {r}
                  {allowed(r) ? "" : " (needs a plan)"}
                </option>
              ))}
            </select>
          </label>
        </div>
        {format !== "project" && (
          <p className="text-[11px] text-muted">
            Reframing follows the recorded clicks and typing in each clip. Where they&apos;re spread too wide for the new shape, the whole picture is shown with a blurred
            background instead of cropping them away.
          </p>
        )}
        <ul className="max-h-60 space-y-1 overflow-y-auto rounded-xl border border-border p-2" aria-label="Highlights to export">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-foreground" title={i.fileName}>
                {i.title}
              </span>
              <span className={statuses[i.id]?.kind === "failed" ? "text-rose-500" : "text-muted"}>{label(statuses[i.id])}</span>
            </li>
          ))}
        </ul>
        {notes.length > 0 && (
          <ul className="space-y-1 text-[11px] text-muted">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {running ? (
            <button type="button" className="rounded-full border border-border px-4 py-2 text-sm font-semibold" onClick={() => abort.current?.abort()}>
              Stop after cancelling the current one
            </button>
          ) : (
            <>
              {done && lastPath && IS_DESKTOP && (
                <button type="button" className="rounded-full border border-border px-4 py-2 text-sm font-semibold" onClick={() => void revealExport(lastPath)}>
                  Show in folder
                </button>
              )}
              <button type="button" className="rounded-full border border-border px-4 py-2 text-sm font-semibold" onClick={onClose}>
                {done ? "Close" : "Cancel"}
              </button>
              {!done && (
                <button type="button" className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-bold text-black hover:bg-emerald-400" onClick={() => void start()}>
                  {IS_DESKTOP ? "Choose folder and export" : "Export"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
