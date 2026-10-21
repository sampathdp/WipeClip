"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";

/** Marks the funnel's purchase step when a checkout lands here with
 * ?plan=<key>. Analytics only - the webhook grants the plan. The query
 * string is stripped right after so a refresh or bookmark can't re-fire it. */
export default function PurchaseTracker() {
  useEffect(() => {
    const plan = new URLSearchParams(window.location.search).get("plan");
    if (plan) {
      trackEvent("purchase_completed", { plan });
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);
  return null;
}
