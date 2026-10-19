"use client";

import MiniPlayer from "@/components/recorder/MiniPlayer";

/** The recording mini player window (opened by recorder_mini in
 * src-tauri/src/lib.rs while a screen recording runs). */
export default function MiniPage() {
  return <MiniPlayer />;
}
