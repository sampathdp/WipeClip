/** Voiceover recording from the microphone. The take is recorded with
 * MediaRecorder, then decoded and re-encoded as a mono 16-bit WAV: browser
 * recordings (WebM/MP4) often lack a duration header, which breaks seeking
 * in the preview and probing in the export, while a WAV plays and probes
 * the same everywhere.
 */

export interface VoiceoverSession {
  /** Ends the take; resolves to the WAV, or null if nothing was captured. */
  stop(): Promise<File | null>;
  /** Ends the take and throws it away. */
  cancel(): void;
  /** Current input level, 0..1, for a meter. */
  level(): number;
}

/** Longest take - keeps the WAV under the 50MB audio limit at 48kHz mono. */
export const MAX_VOICEOVER_SECONDS = 8 * 60;

export function voiceoverSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function" && typeof MediaRecorder !== "undefined";
}

/** Asks for the microphone and starts recording. Rejects with the
 * browser's error (NotAllowedError, NotFoundError, ...) if it can't. */
export async function startVoiceover(): Promise<VoiceoverSession> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);

  const release = () => {
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  recorder.start(250);

  return {
    async stop() {
      if (recorder.state !== "inactive") recorder.stop();
      await stopped;
      release();
      if (!chunks.length) return null;
      const blob = new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" });
      const decoder = new AudioContext();
      try {
        const buffer = await decoder.decodeAudioData(await blob.arrayBuffer());
        if (buffer.duration < 0.1) return null;
        return new File([encodeWav(buffer)], `Voiceover ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.wav`, {
          type: "audio/wav",
        });
      } finally {
        void decoder.close();
      }
    },
    cancel() {
      if (recorder.state !== "inactive") recorder.stop();
      release();
    },
    level() {
      analyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (const v of samples) peak = Math.max(peak, Math.abs(v));
      return Math.min(1, peak);
    },
  };
}

/** Mono 16-bit PCM WAV (channels averaged). */
export function encodeWav(buffer: AudioBuffer): Blob {
  const n = buffer.length;
  const rate = buffer.sampleRate;
  const mono = new Float32Array(n);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += data[i] / buffer.numberOfChannels;
  }
  const out = new DataView(new ArrayBuffer(44 + n * 2));
  const text = (at: number, s: string) => [...s].forEach((ch, i) => out.setUint8(at + i, ch.charCodeAt(0)));
  text(0, "RIFF");
  out.setUint32(4, 36 + n * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true); // PCM
  out.setUint16(22, 1, true); // mono
  out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  text(36, "data");
  out.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, mono[i]));
    out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([out.buffer], { type: "audio/wav" });
}
