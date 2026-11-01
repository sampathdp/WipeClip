"use client";

import { useEffect, useSyncExternalStore } from "react";
import { checkUpdatesNow, getServerUpdateSnapshot, getUpdateSnapshot, startUpdateChecks, subscribeUpdates } from "@/lib/platform/updates";

/** Desktop footer: "Version 0.1.2 · Check for updates". The result of a
 * manual check shows inline; a found update also opens the banner at the top
 * (DesktopShell). */
export default function AppVersion() {
  const { version, status, manual, update } = useSyncExternalStore(subscribeUpdates, getUpdateSnapshot, getServerUpdateSnapshot);

  useEffect(() => startUpdateChecks(), []);

  let result: string | null = null;
  if (status === "available" && update) result = `WipeClip ${update.version} is available`;
  else if (manual && status === "upToDate") result = "You're up to date";
  else if (manual && status === "error") result = "Couldn't check for updates";

  return (
    <>
      {version ? `Version ${version}` : "Version"}
      {" · "}
      {status === "checking" && manual ? (
        <span>Checking…</span>
      ) : (
        <button type="button" className="underline hover:text-foreground" onClick={() => void checkUpdatesNow(true)}>
          Check for updates
        </button>
      )}
      {result && <span className={status === "available" ? "font-semibold text-accent" : undefined}>{` · ${result}`}</span>}
    </>
  );
}
