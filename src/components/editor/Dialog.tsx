"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { CloseIcon } from "./icons";

/** Minimal modal: Escape/backdrop close (unless `onClose` is omitted, e.g.
 * while a job is running), focus moved inside on open, kept inside while
 * open (Tab wraps) and restored after.
 */
export default function Dialog({
  title,
  onClose,
  wide,
  children,
}: {
  title: string;
  onClose?: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  // Tab stays inside the dialog (aria-modal promises the rest is inert).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const panel = panelRef.current;
      if (e.key !== "Tab" || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
        (el) => !el.hasAttribute("disabled") && el.offsetParent !== null
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = panel.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`glass-card max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl p-5 outline-none sm:rounded-3xl sm:p-6 ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"}`}
      >
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="font-display text-lg font-bold text-foreground">{title}</h2>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-full p-1.5 text-muted hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
            >
              <CloseIcon />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
