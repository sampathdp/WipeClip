"use client";

import { useEffect, useState } from "react";

/** One request per page, however many places show the count. */
let countRequest: Promise<number | null> | null = null;

function fetchDownloadCount(): Promise<number | null> {
  countRequest ??= fetch("/api/downloads")
    .then((r) => (r.ok ? r.json() : null))
    .then((c: { total?: number } | null) => (typeof c?.total === "number" ? c.total : null))
    .catch(() => null);
  return countRequest;
}

/** Total installer downloads (/api/downloads), or null until known or if
 * unavailable - callers then show nothing. */
export function useDownloadCount(): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    fetchDownloadCount().then((n) => live && setCount(n));
    return () => {
      live = false;
    };
  }, []);
  return count;
}
