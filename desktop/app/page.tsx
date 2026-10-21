"use client";

import { useCallback, useState } from "react";
import VideoEditor, { type IncomingRecording } from "@/components/editor/VideoEditor";
import ScreenRecorder from "@/components/recorder/ScreenRecorder";
import type { RecordingBundle } from "@/lib/recorder/bundle";

/** The desktop app opens straight into the WipeClip editor, which ships
 * only here (the website just links to the download).
 *
 * The screen recorder (desktop only) opens over the editor, which stays
 * mounted underneath so an open project isn't lost; a finished recording
 * is handed to the editor as a new project.
 */
export default function DesktopEditorPage() {
  const [recording, setRecording] = useState(false);
  const [incoming, setIncoming] = useState<IncomingRecording | null>(null);
  const [projectOpen, setProjectOpen] = useState(false);

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
        incomingRecording={incoming}
        onRecordingImported={imported}
        suspended={recording}
        onProjectOpen={setProjectOpen}
      />
      {recording && <ScreenRecorder onClose={() => setRecording(false)} onOpenInEditor={openInEditor} editorHasProject={projectOpen} />}
    </>
  );
}
