/** Microphone check before recording: a few seconds of the selected
 * microphone, judged for what spoils a recording - too quiet, distorted
 * (too loud), a noisy room, or no speech at all. The take is recorded
 * through the same stream the recording will use (with the browser's echo
 * cancellation, noise suppression and gain control), so it sounds the way
 * the recording will. Pure - see tests/desktop/micCheck.test.ts. */

export const MIC_CHECK_SECONDS = 5;

const FRAME_SEC = 0.02;

export type MicIssue = "no-speech" | "quiet" | "loud" | "clipping" | "noisy";

export interface MicReport {
  /** dBFS: typical speech (90th percentile of 20 ms frames), the room
   * between words (10th percentile), and the loudest sample. */
  speechDb: number;
  floorDb: number;
  peakDb: number;
  /** Frames with 3+ samples at full scale. */
  clippedFrames: number;
  issues: MicIssue[];
  /** One sentence for the user. */
  verdict: string;
  /** Things to try, one per issue. */
  tips: string[];
}

const db = (v: number) => 20 * Math.log10(Math.max(1e-9, v));

/** Thresholds, dBFS. Speech recorded for video sits around -25..-12 dBFS;
 * below -38 it's buried in noise once brought up, and a room louder than
 * -50 dBFS (or within 20 dB of the speech) is heard in every pause. */
export const QUIET_DB = -38;
export const LOUD_DB = -6;
export const NOISY_FLOOR_DB = -50;
export const MIN_SNR_DB = 20;

export function analyzeMic(samples: Float32Array, rate: number): MicReport {
  const frame = Math.max(1, Math.round(rate * FRAME_SEC));
  const n = Math.floor(samples.length / frame);
  const levels = new Float32Array(n);
  let peak = 0;
  let clippedFrames = 0;
  for (let f = 0; f < n; f++) {
    let sum = 0;
    let clipped = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) {
      const v = samples[i];
      const a = v < 0 ? -v : v;
      sum += v * v;
      if (a > peak) peak = a;
      if (a >= 0.99) clipped++;
    }
    levels[f] = db(Math.sqrt(sum / frame));
    if (clipped >= 3) clippedFrames++;
  }
  const sorted = Float32Array.from(levels).sort();
  const pct = (p: number) => (n ? sorted[Math.min(n - 1, Math.floor(n * p))] : -180);
  const speechDb = pct(0.9);
  const floorDb = pct(0.1);
  const peakDb = db(peak);
  // Speech: frames well above the room; a check needs a second of them.
  const speaking = levels.filter((l) => l > floorDb + 12).length * FRAME_SEC;

  const issues: MicIssue[] = [];
  const tips: string[] = [];
  if (n === 0 || speechDb < -70) {
    issues.push("no-speech");
    tips.push("No sound came in. Check that the right microphone is chosen and that it isn't muted (some headsets have a mute switch).");
  } else if (speaking < 1) {
    issues.push("no-speech");
    tips.push("We didn't hear speech. Run the check again and talk the whole time, as you would in the video.");
  } else {
    if (clippedFrames > 0) {
      issues.push("clipping");
      tips.push("Your voice hit the maximum level and distorts. Move back from the microphone or lower its input level in your system's sound settings.");
    } else if (peakDb > LOUD_DB && speechDb > -12) {
      issues.push("loud");
      tips.push("Very close to the maximum: a laugh or a loud word will distort. Move back a little or lower the input level.");
    }
    if (speechDb < QUIET_DB) {
      issues.push("quiet");
      tips.push("Your voice is quiet. Move closer to the microphone (a hand's width or two) or raise its input level in your system's sound settings.");
    }
    if (floorDb > NOISY_FLOOR_DB || speechDb - floorDb < MIN_SNR_DB) {
      issues.push("noisy");
      tips.push("There's a lot of background sound between words. Turn off fans, close windows, or move closer to the microphone so your voice is louder than the room.");
    }
  }
  const verdict =
    issues.length === 0
      ? `Sounds good: your voice is clear (${Math.round(speechDb)} dB) and ${speechDb - floorDb >= 60 ? "it's silent between words" : `the room is ${Math.round(speechDb - floorDb)} dB quieter`}.`
      : issues.includes("no-speech")
        ? "We couldn't check your voice."
        : issues.includes("clipping")
          ? "Too loud: it distorts."
          : issues.includes("quiet") && issues.includes("noisy")
            ? "Quiet, with a noisy room."
            : issues.includes("quiet")
              ? "A bit quiet."
              : issues.includes("loud")
                ? "Close to too loud."
                : "Noisy room.";
  return { speechDb, floorDb, peakDb, clippedFrames, issues, verdict, tips };
}
