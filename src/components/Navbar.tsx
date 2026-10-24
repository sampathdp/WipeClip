"use client";

import { useState } from "react";
import Link from "next/link";
import AuthStatus from "./AuthStatus";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";
import { AI_CLEANUP_ENABLED } from "@/lib/features";

const links = [
  { href: "/download", label: "Download" },
  ...(AI_CLEANUP_ENABLED ? [{ href: "/#how-it-works", label: "How It Works" }] : []),
  { href: "/about", label: "About" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed top-0 inset-x-0 z-50 glass">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" className="inline-flex items-center" onClick={() => setOpen(false)}>
          <Logo size={34} textSize="text-lg" />
        </Link>

        <div className="hidden items-center gap-8 text-sm font-medium text-muted md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/tools"
            aria-label="Free Tools"
            className="group inline-flex shrink-0 items-center gap-1.5 rounded-full border border-cyan-400/50 bg-gradient-to-r from-accent-2/20 to-accent/20 px-2.5 py-2 text-xs font-bold text-cyan-700 shadow-[0_0_15px_rgba(34,211,238,0.2)] transition-all hover:scale-[1.04] hover:border-cyan-400 hover:shadow-[0_0_22px_rgba(34,211,238,0.35)] dark:text-cyan-300 sm:px-3.5"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 transition-transform group-hover:rotate-12">
              <path d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
            </svg>
            <span className="hidden sm:inline">Free Tools</span>
          </Link>
          <ThemeToggle />
          <AuthStatus />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2/80 text-foreground md:hidden"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {open ? <path d="M18 6 6 18M6 6l12 12" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </nav>

      {open && (
        <div className="border-t border-border/60 bg-background/95 backdrop-blur-xl px-4 py-4 md:hidden">
          <div className="flex flex-col gap-1 text-sm font-medium text-muted">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-xl px-3 py-3 transition-colors hover:bg-surface-2/80 hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
