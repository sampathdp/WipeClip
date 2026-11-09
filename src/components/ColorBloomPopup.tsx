"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { COLORBLOOM_IMAGES, COLORBLOOM_PATH, COLORBLOOM_STORE_URL } from "@/lib/colorbloom";
import { stripLang } from "@/lib/i18n";

const STORAGE_KEY = "wipeclip_colorbloom_seen";
// Matches WelcomeModal's key: on a first homepage visit that popup goes
// first and this one waits until it is closed.
const WELCOME_KEY = "wipeclip_welcome_seen";
export const WELCOME_CLOSED_EVENT = "wipeclip:welcome-closed";
const OPEN_DELAY_MS = 2500;
const AFTER_WELCOME_DELAY_MS = 800;

function welcomeSeen(): boolean {
  try {
    return localStorage.getItem(WELCOME_KEY) === "1";
  } catch {
    return true; // WelcomeModal skips itself when storage is blocked
  }
}

/** Once-per-session announcement for ColorBloom, the studio's coloring app.
 * Skipped on the ColorBloom page itself and on admin/auth pages. */
export default function ColorBloomPopup() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (navigator.webdriver) return;
    const path = stripLang(pathname);
    if (path.startsWith(COLORBLOOM_PATH) || path.startsWith("/admin") || path.startsWith("/auth") || path === "/under-construction") return;

    let seen: string | null;
    try {
      seen = sessionStorage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (seen === "1") return;

    let timer = 0;
    const show = (delay: number) => {
      timer = window.setTimeout(() => {
        try {
          sessionStorage.setItem(STORAGE_KEY, "1");
        } catch {}
        setOpen(true);
      }, delay);
    };

    const welcomePending = path === "/" && !welcomeSeen();
    if (!welcomePending) {
      show(OPEN_DELAY_MS);
      return () => window.clearTimeout(timer);
    }
    const onWelcomeClosed = () => show(AFTER_WELCOME_DELAY_MS);
    window.addEventListener(WELCOME_CLOSED_EVENT, onWelcomeClosed, { once: true });
    return () => {
      window.removeEventListener(WELCOME_CLOSED_EVENT, onWelcomeClosed);
      window.clearTimeout(timer);
    };
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) return null;
  const close = () => setOpen(false);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={close}>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="colorbloom-popup-heading"
        className="glass-card relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[2rem] border border-pink-500/25 p-0 shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
      >
        <button
          onClick={close}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="relative">
          <Image
            src={COLORBLOOM_IMAGES.feature}
            alt="ColorBloom, mindful coloring and art"
            width={1024}
            height={572}
            className="block aspect-[1024/572] w-full object-cover"
          />
          <span className="absolute left-3 top-3 rounded-full bg-pink-500 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-white shadow-lg">
            New app
          </span>
        </div>

        <div className="space-y-4 px-6 pb-6 pt-5">
          <div className="flex items-center gap-3">
            <Image src={COLORBLOOM_IMAGES.icon} alt="" width={48} height={48} className="h-12 w-12 rounded-xl" />
            <div>
              <h2 id="colorbloom-popup-heading" className="font-display text-xl font-extrabold tracking-tight text-foreground">
                ColorBloom is live!
              </h2>
              <p className="text-xs text-muted">From Codeplay Studios, the makers of WipeClip</p>
            </div>
          </div>

          <p className="text-sm leading-relaxed text-muted">
            Our new mindful coloring app for Android. Color mandalas, draw symmetry art and turn your work into HD
            wallpapers. Free, works offline, no ads.
          </p>

          <div className="flex flex-col gap-2.5 sm:flex-row">
            <a
              href={COLORBLOOM_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={close}
              className="flex-1 rounded-full bg-gradient-to-r from-pink-500 to-violet-500 px-5 py-2.5 text-center text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(236,72,153,0.7)] hover:opacity-95"
            >
              Get it free
            </a>
            <Link
              href={COLORBLOOM_PATH}
              onClick={close}
              className="flex-1 rounded-full border border-border px-5 py-2.5 text-center text-sm font-semibold text-foreground hover:bg-surface-2/80"
            >
              Learn more
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
