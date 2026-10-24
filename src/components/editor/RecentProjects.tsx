"use client";

import { useState } from "react";
import type { ProjectSummary } from "@/lib/editor/projectStore";
import { formatTime } from "@/lib/editor/timeline";
import { TrashIcon } from "./icons";

/** How many projects show before "Show all". */
const COLLAPSED = 4;

function size(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

function savedLabel(t: number): string {
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const d = new Date(t);
  const today = new Date();
  return d.toDateString() === today.toDateString() ? `today ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : d.toLocaleDateString();
}

/** Saved projects on the start screen: open, rename, delete. */
export default function RecentProjects({
  projects,
  onOpen,
  onRename,
  onDelete,
  className = "mt-6",
}: {
  className?: string;
  projects: ProjectSummary[];
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (p: ProjectSummary) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  if (!projects.length) return null;
  const shown = showAll ? projects : projects.slice(0, COLLAPSED);

  const commit = () => {
    if (!editing) return;
    const name = editing.name.trim();
    const before = projects.find((p) => p.id === editing.id)?.name;
    setEditing(null);
    if (name && name !== before) onRename(editing.id, name);
  };

  return (
    <section className={className} aria-labelledby="recent-projects">
      <h2 id="recent-projects" className="text-sm font-semibold text-foreground">
        Recent projects
      </h2>
      <ul className="mt-2 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface/60">
        {shown.map((p) => (
          <li key={p.id} className="flex items-center gap-3 p-2.5">
            <button
              type="button"
              onClick={() => onOpen(p.id)}
              disabled={!!p.problem}
              aria-label={`Open ${p.name}`}
              className="h-11 w-20 shrink-0 overflow-hidden rounded-lg bg-surface-2 disabled:opacity-50"
            >
              {p.thumb && (
                // eslint-disable-next-line @next/next/no-img-element -- a stored data URL
                <img src={p.thumb} alt="" className="h-full w-full object-cover" />
              )}
            </button>
            <div className="min-w-0 flex-1">
              {editing?.id === p.id ? (
                <input
                  autoFocus
                  value={editing.name}
                  maxLength={120}
                  aria-label="Project name"
                  onChange={(e) => setEditing({ id: p.id, name: e.target.value })}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit();
                    if (e.key === "Escape") setEditing(null);
                  }}
                  className="w-full rounded-md border border-accent-2 bg-transparent px-1 text-sm font-semibold text-foreground focus:outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing({ id: p.id, name: p.name })}
                  title="Rename"
                  className="block max-w-full truncate text-left text-sm font-semibold text-foreground hover:underline"
                >
                  {p.name}
                </button>
              )}
              <p className="truncate text-xs text-muted">
                {p.problem ?? (
                  <>
                    {p.clips} clip{p.clips === 1 ? "" : "s"} · {formatTime(p.duration)}
                    {p.bytes !== null && <> · {size(p.bytes)}</>} · saved {savedLabel(p.savedAt)}
                  </>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpen(p.id)}
              disabled={!!p.problem}
              className="btn-primary shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              Open
            </button>
            <button
              type="button"
              onClick={() => onDelete(p)}
              aria-label={`Delete ${p.name}`}
              title="Delete project"
              className="shrink-0 rounded-full p-1.5 text-muted hover:bg-rose-500/10 hover:text-rose-600"
            >
              <TrashIcon width={16} height={16} />
            </button>
          </li>
        ))}
      </ul>
      {projects.length > COLLAPSED && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-xs font-semibold text-muted underline hover:text-foreground">
          {showAll ? "Show fewer" : `Show all ${projects.length} projects`}
        </button>
      )}
    </section>
  );
}
