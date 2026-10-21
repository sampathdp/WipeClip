import { useEffect } from "react";
import { track } from "@vercel/analytics";

/**
 * Funnel event names for the SEO landing page -> tool -> signup -> purchase
 * path. Kept as a closed union so every call site is typo-checked at
 * compile time; add new names here rather than passing raw strings.
 */
export type FunnelEvent =
  | "tool_view"
  | "upload_clicked"
  | "file_selected"
  | "mask_started"
  | "mask_completed"
  | "processing_started"
  | "processing_completed"
  | "processing_failed"
  | "download_clicked"
  | "desktop_download_clicked"
  | "signup_started"
  | "signup_completed"
  | "pricing_viewed"
  | "checkout_started"
  | "purchase_completed";

export type AnalyticsProperties = Record<string, string | number | boolean | null | undefined>;

/**
 * Fire-and-forget wrapper around @vercel/analytics' custom-event track().
 * Analytics must never break the product flow it's attached to (upload,
 * processing, checkout, auth) - every call site treats this as best-effort
 * and never awaits or branches on it.
 */
export function trackEvent(name: FunnelEvent, properties?: AnalyticsProperties): void {
  try {
    track(name, properties);
  } catch {
    // Swallowed deliberately - see the note above.
  }
}

/** Current pathname, for a "route"/"source page" property. Never throws. */
export function currentPath(): string | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.location.pathname;
  } catch {
    return undefined;
  }
}

/**
 * Same-origin referring path (e.g. "/guides/how-ai-video-inpainting-works" for
 * a visitor who clicked through from that guide into the homepage tool).
 * Cross-origin referrers are dropped - only the path is ever read, and only
 * when it points back at this site. Never throws.
 */
export function landingPagePath(): string | undefined {
  try {
    if (typeof document === "undefined" || !document.referrer) return undefined;
    const ref = new URL(document.referrer);
    if (ref.origin !== window.location.origin) return undefined;
    return ref.pathname;
  } catch {
    return undefined;
  }
}

/**
 * Fires a single `tool_view` event on mount for a page that hosts an
 * interactive tool (as opposed to a plain SEO landing page that only links
 * to one). `tool` should be a stable, generic identifier - never a
 * filename or anything user-entered.
 */
export function useToolView(tool: string): void {
  useEffect(() => {
    trackEvent("tool_view", { tool, route: currentPath(), landing_page: landingPagePath() });
    // Intentionally mount-only: this marks a single page view, not a
    // re-fire on every state change within the tool.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
