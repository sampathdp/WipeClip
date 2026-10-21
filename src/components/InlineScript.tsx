"use client";

/** An inline <script> that runs during HTML parsing on a hard load (e.g. the
 * theme init in the root layout, so there's no flash of the wrong theme).
 * A Client Component so `typeof window` is checked in the browser too: when
 * React renders it there (soft navigation, error recovery, dev Strict Mode)
 * it becomes inert text/plain, which React doesn't warn about - scripts
 * React inserts never execute anyway. suppressHydrationWarning covers the
 * type mismatch. Pattern from Next's "Preventing flash before hydration" guide.
 */
export default function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
