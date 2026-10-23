"use client";

import { useCallback, useState } from "react";
import VideoEditor, { type IncomingRecording } from "@/components/editor/VideoEditor";
import ScreenRecorder from "@/components/recorder/ScreenRecorder";
import ImageTools from "./ImageTools";
import type { RecordingBundle } from "@/lib/recorder/bundle";

/** The desktop app opens straight into the WipeClip editor, which ships
 * only here (the website just links to the download).
 *
 * The screen recorder (desktop only) opens over the editor, which stays
 * mounted underneath so an open project isn't lost; a finished recording
 * is handed to the editor as a new project. The image tools open over it
 * the same way.
 */
export default function DesktopEditorPage() {
  const [recording, setRecording] = useState(false);
  const [imageTools, setImageTools] = useState(false);
  const [incoming, setIncoming] = useState<IncomingRecording | null>(null);

  const openInEditor = useCallback((bundle: RecordingBundle) => {
    setIncoming({ key: Date.now(), bundle });
    setRecording(false);
  }, []);

  const imported = useCallback((key: number) => {
    // The editor shows its own error on the import screen if it failed.
    setIncoming((cur) => (cur?.key === key ? null : cur));
  }, []);

  return (
    <>
      <VideoEditor
        onRecord={() => setRecording(true)}
        onImageTools={() => setImageTools(true)}
        incomingRecording={incoming}
        onRecordingImported={imported}
        suspended={recording || imageTools}
      />
      {imageTools && <ImageTools onClose={() => setImageTools(false)} />}
      {recording && <ScreenRecorder onClose={() => setRecording(false)} onOpenInEditor={openInEditor} />}
    </>
  );
}
