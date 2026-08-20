"use client";

import { useEffect } from "react";

const STORAGE_KEY = "wipeclip_ref";

/** Mounted once, globally (see layout.tsx). Captures a `?ref=CODE` query
 * param on first touch and stashes it in localStorage until the visitor
 * actually signs up - claiming it happens later, in AuthStatus.tsx, the
 * first moment a session actually exists (covers password signup, magic
 * link, OAuth, and email-confirm redirects, since all of them funnel
 * through the same onAuthStateChange listener there).
 *
 * First-touch only: an existing stored code is never overwritten by a
 * later visit, so a user who already has a referral pending can't have it
 * silently swapped out by clicking a different share link before signing up.
 */
export default function ReferralCapture() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref && !localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, ref);
    }
  }, []);

  return null;
}
