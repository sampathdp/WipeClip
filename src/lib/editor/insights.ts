/** Smart editing suggestions from the recording's interaction events and
 * the audio analysis. Pure - see tests/desktop/tutorial.test.ts.
 *
 * Everything is a suggestion with a reason the user can check. Wording is
 * deliberately hedged: repeated clicks or repeated click sequences are
 * *signs* of a problem or a retake, never treated as proof of a mistake,
 * and silence while the user is working on screen is a review item (it is
 * usually part of the demonstration), never a proposed cut.
 */
import { cutRangeFor, type AudioReport, type SilenceSettings } from "./audioAnalysis.ts";
import { timelineTimeOf } from "./camera.ts";
import { formatTime, type Layout } from "./timeline.ts";
import type { EditSuggestion } from "./types.ts";
import type { InteractionEvent } from "../recorder/format.ts";

export interface Act {
  t: number; // timeline seconds
  kind: "click" | "key" | "scroll" | "move" | "window" | "marker";
  x: number;
  y: number;
  label?: string;
}

/** Recording events placed on the timeline through every clip that shows
 * them (a trimmed-away moment has no timeline time and is dropped). */
export function interactionTimeline(lay: Layout, sourceId: string, events: InteractionEvent[]): Act[] {
  const out: Act[] = [];
  for (const c of lay.clips) {
    if (c.clip.sourceId !== sourceId || c.clip.freeze !== null) continue;
    for (const e of events) {
      const t = timelineTimeOf(c, e.t / 1000);
      if (t === null) continue;
      if (e.type === "button" && e.down) out.push({ t, kind: "click", x: e.x, y: e.y, label: e.button });
      else if (e.type === "move") out.push({ t, kind: "move", x: e.x, y: e.y });
      else if (e.type === "scroll") out.push({ t, kind: "scroll", x: e.x, y: e.y });
      else if (e.type === "key") out.push({ t, kind: "key", x: NaN, y: NaN, label: e.combo });
      else if (e.type === "window") out.push({ t, kind: "window", x: NaN, y: NaN, label: e.app });
      else if (e.type === "marker") out.push({ t, kind: "marker", x: NaN, y: NaN, label: e.label });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

export interface InsightSettings {
  silence: SilenceSettings;
  /** No interaction this long (s) while talking is worth a look. */
  idle: number;
  aspect: number;
}

const near = (a: Act, b: Act, r: number, aspect: number) => Math.hypot(a.x - b.x, (a.y - b.y) / aspect) < r;

function overlaps(acts: Act[], start: number, end: number, kinds: Act["kind"][]) {
  return acts.some((a) => a.t >= start && a.t <= end && kinds.includes(a.kind));
}

/** A silence where the picture changes at least this share of the time is
 * footage (a video playing, a build, a game), not dead time. */
export const MOVING_SHARE = 0.25;

/** Silences that could become cuts (not at times of on-screen work): the
 * ranges whose picture is worth checking (see `motion` in suggestEdits). */
export function cutCandidates(audio: AudioReport, acts: Act[] | null): { start: number; end: number }[] {
  return audio.silences.filter((sil) => !(acts && overlaps(acts, sil.start, sil.end, ["click", "key", "scroll"])));
}

/** `motion(start, end)`: share of that timeline range in which the picture
 * changes, null when unknown (no local engine, no file on disk). */
export function suggestEdits(
  input: { lay: Layout; acts: Act[] | null; audio: AudioReport | null; motion?: (start: number, end: number) => number | null },
  s: InsightSettings,
  ids: () => string
): EditSuggestion[] {
  const { lay, acts, audio, motion } = input;
  const total = lay.total;
  const out: EditSuggestion[] = [];
  const add = (x: Omit<EditSuggestion, "id" | "status">) => out.push({ ...x, id: ids(), status: "pending" });
  const working = (a: number, b: number) => !!acts && overlaps(acts, a, b, ["click", "key", "scroll"]);

  // --- audio ---------------------------------------------------------------
  if (audio) {
    for (const sil of audio.silences) {
      const len = sil.end - sil.start;
      if (working(sil.start, sil.end)) {
        add({
          kind: "silence",
          start: sil.start,
          end: sil.end,
          title: `${len.toFixed(1)} s without speech while you work on screen`,
          detail: "Probably part of the demonstration, so it isn't suggested as a cut. Speed it up or add a caption if it feels slow.",
          action: "review",
          confidence: "low",
        });
        continue;
      }
      const moving = motion?.(sil.start, sil.end) ?? null;
      if (moving !== null && moving >= MOVING_SHARE) {
        add({
          kind: "silence",
          start: sil.start,
          end: sil.end,
          title: `${len.toFixed(1)} s without speech, but the picture keeps changing`,
          detail: `The picture changes for about ${Math.round(moving * 100)}% of it (a video, an animation, a game?), so it isn't suggested as a cut. Watch it before deciding.`,
          action: "review",
          confidence: "low",
        });
        continue;
      }
      const range = cutRangeFor(sil, s.silence.keep, total);
      if (!range) continue;
      const edge = range.start === 0 || range.end === total;
      const idle = acts !== null;
      add({
        kind: idle ? "dead-time" : "silence",
        start: range.start,
        end: range.end,
        title: edge
          ? `${len.toFixed(1)} s of silence at the ${range.start === 0 ? "start" : "end"}`
          : idle
            ? `${len.toFixed(1)} s of dead time (no speech, no clicks or typing)`
            : `${len.toFixed(1)} s pause in speech`,
        detail: edge
          ? "Usually safe to trim."
          : `Cutting keeps ${s.silence.keep.toFixed(2)} s of pause on each side so speech doesn't sound clipped. Check that nothing important happens on screen first.`,
        action: "cut",
        confidence: edge || len >= 4 ? "high" : len >= 2.5 ? "medium" : "low",
      });
    }
    for (const c of audio.clipping) {
      add({
        kind: "clipping",
        start: c.start,
        end: Math.max(c.end, c.start + 0.3),
        title: "Audio clipping (distortion)",
        detail:
          "The recording hit its maximum level here, so the loudest sounds are flattened and distorted. Turning the volume down doesn't undo that. On an audio track (a microphone or voiceover), select it and use Clean up > Repair distortion in the desktop app; if it's heavy, re-record this part.",
        action: "review",
        confidence: "high",
      });
    }
    for (const l of audio.loud) {
      add({
        kind: "loud",
        start: l.start,
        end: Math.max(l.end, l.start + 0.3),
        title: "Sudden loud sound",
        detail: "Much louder than the speech around it - a knock, cough or notification? Listen and lower or cut it if it's unwanted.",
        action: "review",
        confidence: "medium",
      });
    }
    for (const q of audio.quiet) {
      add({
        kind: "quiet",
        start: q.start,
        end: q.end,
        title: "Very quiet speech",
        detail: "Barely above the background noise. Raise the volume of this part, or check the microphone.",
        action: "review",
        confidence: "medium",
      });
    }
  }

  if (!acts) return sortSuggestions(out);
  const clicks = acts.filter((a) => a.kind === "click" && Number.isFinite(a.x));

  // --- idle while talking ------------------------------------------------------
  const busy = acts.filter((a) => a.kind !== "window" && a.kind !== "marker");
  // Moves only count when they actually go somewhere.
  const meaningful: Act[] = [];
  for (const a of busy) {
    const last = meaningful[meaningful.length - 1];
    if (a.kind !== "move" || !last || !Number.isFinite(last.x) || Math.hypot(a.x - last.x, a.y - last.y) > 0.02) meaningful.push(a);
  }
  const bounds = [0, ...meaningful.map((a) => a.t), total];
  for (let i = 1; i < bounds.length; i++) {
    const [a, b] = [bounds[i - 1], bounds[i]];
    if (b - a < s.idle) continue;
    const silentShare = audio
      ? audio.silences.reduce((n, sil) => n + Math.max(0, Math.min(b, sil.end) - Math.max(a, sil.start)), 0) / (b - a)
      : 0;
    if (silentShare > 0.6) continue; // already a silence suggestion
    add({
      kind: "idle",
      start: a,
      end: b,
      title: `${(b - a).toFixed(0)} s without mouse or keyboard activity`,
      detail: audio ? "You're talking but nothing happens on screen. Fine for explanations; consider a zoom, annotation or tightening it." : "Nothing happens on screen here. Check whether it can be shortened.",
      action: "review",
      confidence: "low",
    });
  }

  // --- repeated clicks on one spot --------------------------------------------
  for (let i = 0; i < clicks.length; ) {
    let j = i + 1;
    while (j < clicks.length && clicks[j].t - clicks[i].t <= 2.5 && near(clicks[j], clicks[i], 0.02, s.aspect)) j++;
    const count = j - i;
    if (count >= 3) {
      add({
        kind: "repeated-clicks",
        start: Math.max(0, clicks[i].t - 0.5),
        end: clicks[j - 1].t + 0.5,
        title: `${count} clicks on the same spot in ${(clicks[j - 1].t - clicks[i].t).toFixed(1)} s`,
        detail: "Repeated clicking can mean the app was slow to respond. If there's waiting here, you could cut or speed it up.",
        action: "review",
        confidence: "low",
      });
      i = j;
    } else i++;
  }

  // --- the same click sequence done twice: a possible retake -----------------
  const K = 3;
  for (let i = 0; i + K <= clicks.length; i++) {
    for (let j = i + K; j + K <= clicks.length; j++) {
      const gap = clicks[j].t - clicks[i + K - 1].t;
      if (gap < 3) continue;
      if (gap > 120) break;
      let same = true;
      for (let k = 0; k < K && same; k++) same = near(clicks[i + k], clicks[j + k], 0.03, s.aspect);
      if (!same) continue;
      const start = Math.max(0, clicks[i].t - 1);
      const end = Math.max(start + 0.5, clicks[j].t - 0.5);
      if (!out.some((o) => o.kind === "possible-retake" && o.start < end && o.end > start)) {
        add({
          kind: "possible-retake",
          start,
          end,
          title: `Steps at ${formatTime(clicks[i].t)} seem to be repeated at ${formatTime(clicks[j].t)}`,
          detail: `${K}+ clicks in the same places, in the same order. If the first attempt went wrong, cutting it leaves only the second. If both are intended, reject this.`,
          action: "cut",
          confidence: "low",
        });
      }
      i += K - 1;
      break;
    }
  }

  // --- long navigation without clicking ----------------------------------------
  const moves = acts.filter((a) => a.kind === "move");
  for (let i = 0; i < moves.length; ) {
    let travel = 0;
    let j = i + 1;
    while (j < moves.length && moves[j].t - moves[i].t <= 8) {
      travel += Math.hypot(moves[j].x - moves[j - 1].x, moves[j].y - moves[j - 1].y);
      j++;
    }
    const end = moves[j - 1].t;
    if (end - moves[i].t >= 5 && travel > 3 && !overlaps(acts, moves[i].t, end, ["click", "key"])) {
      add({
        kind: "navigation",
        start: moves[i].t,
        end,
        title: "Long pointer movement without clicking",
        detail: "Searching around the screen? A focus zoom, an arrow, or speeding this up can make it easier to follow.",
        action: "review",
        confidence: "low",
      });
      i = j;
    } else i += Math.max(1, Math.floor((j - i) / 2));
  }
  const windows = acts.filter((a) => a.kind === "window");
  for (let i = 0; i + 4 <= windows.length; i++) {
    if (windows[i + 3].t - windows[i].t <= 10) {
      add({
        kind: "navigation",
        start: windows[i].t,
        end: windows[i + 3].t + 0.5,
        title: "Several app switches in a few seconds",
        detail: "Quick switching between windows can be hard to follow. Consider a chapter or a caption explaining where you're going.",
        action: "review",
        confidence: "low",
      });
      i += 3;
    }
  }

  // --- milestones ------------------------------------------------------------------
  for (const m of acts.filter((a) => a.kind === "marker")) {
    add({
      kind: "milestone",
      start: m.t,
      end: m.t + 0.5,
      title: m.label || "Marker",
      detail: "A marker you added while recording - a natural chapter start.",
      action: "review",
      confidence: "high",
    });
  }
  return sortSuggestions(out);
}

function sortSuggestions(list: EditSuggestion[]) {
  return list.sort((a, b) => a.start - b.start);
}

/** Cut suggestions the user accepted, as non-overlapping ranges, latest
 * first - applying them back to front keeps earlier ranges valid. */
export function acceptedCuts(list: EditSuggestion[]): { start: number; end: number; ids: string[] }[] {
  const cuts = list.filter((s) => s.status === "accepted" && s.action === "cut").sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number; ids: string[] }[] = [];
  for (const c of cuts) {
    const last = merged[merged.length - 1];
    if (last && c.start <= last.end) {
      last.end = Math.max(last.end, c.end);
      last.ids.push(c.id);
    } else merged.push({ start: c.start, end: c.end, ids: [c.id] });
  }
  return merged.reverse();
}

/** What "Preview the result" skips: the pending cut suggestions as sorted,
 * merged timeline ranges. Playback jumps over them; nothing is removed. */
export function previewSkips(list: EditSuggestion[]): { start: number; end: number }[] {
  const cuts = list.filter((s) => s.status === "pending" && s.action === "cut" && s.end > s.start).sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  for (const c of cuts) {
    const last = out[out.length - 1];
    if (last && c.start <= last.end) last.end = Math.max(last.end, c.end);
    else out.push({ start: c.start, end: c.end });
  }
  return out;
}

/** Where playback at `t` continues when skipping `ranges`: the end of the
 * range `t` is in, else `t`. A range's last 10 ms doesn't count, so
 * landing on its end never jumps again. */
export function skipTarget(ranges: { start: number; end: number }[], t: number): number {
  for (const r of ranges) {
    if (t < r.start) break;
    if (t < r.end - 0.01) return r.end;
  }
  return t;
}
