"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isLocale, languageAlternates, LOCALE_INFO, LOCALES, localizedPath } from "@/lib/i18n";

const OPTIONS = [{ code: "en", name: "English" }, ...LOCALES.map((l) => ({ code: l, name: LOCALE_INFO[l].name }))];

/** Navbar language picker. Links to the same page in the chosen language
 * when it is translated; English-only pages fall back to each language's
 * index page. */
export default function LanguageSwitcher() {
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const first = pathname.split("/")[1] ?? "";
  const current = isLocale(first) ? first : "en";
  const alternates = languageAlternates(pathname);
  const hrefFor = (code: string) =>
    alternates?.[code] ?? (isLocale(code) ? localizedPath(code, "") : "/");

  const item =
    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Change language"
        className="inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-full border border-border bg-surface-2/80 px-2.5 text-xs font-semibold uppercase text-foreground transition-colors hover:border-cyan-500/40"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
        </svg>
        <span className="hidden sm:inline">{current}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-12 z-[60] w-48 rounded-2xl border border-border bg-background/95 p-2 shadow-2xl backdrop-blur-xl"
          onClick={() => setOpen(false)}
        >
          {OPTIONS.map(({ code, name }) => (
            <Link
              key={code}
              role="menuitem"
              href={hrefFor(code)}
              hrefLang={code}
              lang={code}
              aria-current={code === current ? "true" : undefined}
              className={item + (code === current ? " font-semibold text-cyan-600 dark:text-cyan-300" : "")}
            >
              {name}
              <span className="text-xs uppercase text-muted">{code}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
