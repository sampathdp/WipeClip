"use client";

import { useEffect, useState } from "react";
import { previewMixer } from "@/lib/editor/audioMixer";
import { LIMIT_CEILING, LOUDNESS_TARGETS } from "@/lib/editor/loudness";
import { MAX_VIDEO_VOLUME, VIDEO_TRACK, loudnessStale, masterOf, meterFraction, type MeterLevel } from "@/lib/editor/mix";
import type { AudioClip, LoudnessTarget, MasterAudio, Project } from "@/lib/editor/types";
import { SliderField, type Gesture } from "./Panels";

/** The mix: the clips' own sound and every audio track as rows with a
 * level meter, volume, mute and solo, and the master with loudness
 * normalization. Meters read the preview's mixer (audioMixer.ts) while
 * this panel is open, so they show what is heard - after volume, fades,
 * ducking and the master gain. */
export default function MixerPanel({
  project,
  solo,
  onSolo,
  onMaster,
  onTrack,
  onMeasure,
  measuring,
  gesture,
}: {
  project: Project;
  solo: ReadonlySet<string>;
  onSolo: (key: string) => void;
  onMaster: (patch: Partial<MasterAudio>) => void;
  onTrack: (id: string, patch: Partial<AudioClip>) => void;
  /** Measures the mix's loudness and sets the target and its gain. */
  onMeasure: (target: Exclude<LoudnessTarget, "off">) => void;
  measuring: boolean;
  gesture: Gesture;
}) {
  const m = masterOf(project);
  const levels = useLevels();
  const stale = loudnessStale(project);
  const target = m.loudness === "off" ? null : LOUDNESS_TARGETS[m.loudness];

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Mix</p>
      <TrackRow
        label="Video sound"
        level={levels.tracks.get(VIDEO_TRACK)}
        volume={m.videoVolume}
        max={MAX_VIDEO_VOLUME}
        muted={m.videoMuted}
        soloed={solo.has(VIDEO_TRACK)}
        onVolume={(v) => onMaster({ videoVolume: v })}
        onMute={() => onMaster({ videoMuted: !m.videoMuted })}
        onSolo={() => onSolo(VIDEO_TRACK)}
        gesture={gesture}
      />
      {project.audio.map((a) => (
        <TrackRow
          key={a.id}
          label={a.label}
          level={levels.tracks.get(a.id)}
          volume={a.volume}
          max={2}
          muted={a.muted}
          soloed={solo.has(a.id)}
          onVolume={(v) => onTrack(a.id, { volume: v })}
          onMute={() => onTrack(a.id, { muted: !a.muted })}
          onSolo={() => onSolo(a.id)}
          gesture={gesture}
        />
      ))}
      {solo.size > 0 && <p className="text-[11px] text-muted">Solo is for listening only. The export includes every track that isn&apos;t muted.</p>}

      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center justify-between text-xs font-medium text-foreground">
          <span>Master</span>
          <Meter level={levels.master} wide />
        </div>
        <label className="block text-xs font-medium text-foreground">
          Loudness
          <select
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-accent-2 focus:outline-none"
            value={m.loudness}
            onChange={(e) => {
              const loudness = e.target.value as LoudnessTarget;
              if (loudness === "off") onMaster({ loudness, gainDb: 0 });
              else onMeasure(loudness);
            }}
            aria-label="Loudness"
          >
            <option value="off">Off</option>
            {(Object.keys(LOUDNESS_TARGETS) as (keyof typeof LOUDNESS_TARGETS)[]).map((k) => (
              <option key={k} value={k}>
                {LOUDNESS_TARGETS[k].label} ({LOUDNESS_TARGETS[k].lufs} LUFS)
              </option>
            ))}
          </select>
        </label>
        {target && <p className="text-[11px] text-muted">{target.hint}.</p>}
        {target && (
          <div className="rounded-lg border border-border bg-surface-2/60 p-2 text-[11px] text-muted" role="status">
            {measuring ? (
              "Measuring the mix…"
            ) : m.measured ? (
              <>
                Measured {m.measured.lufs.toFixed(1)} LUFS, peak {m.measured.peakDb.toFixed(1)} dBFS. Gain {m.gainDb >= 0 ? "+" : ""}
                {m.gainDb.toFixed(1)} dB, to about {(m.measured.lufs + m.gainDb).toFixed(1)} LUFS
                {m.measured.lufs + m.gainDb < target.lufs - 0.5 ? " (raised as far as the peaks allow)" : ""}.
                {stale && <span className="mt-1 block font-semibold text-foreground">The mix changed since it was measured.</span>}
              </>
            ) : (
              "Not measured yet."
            )}
            {!measuring && (
              <button type="button" className="ml-1 font-semibold text-accent-2 hover:underline" onClick={() => m.loudness !== "off" && onMeasure(m.loudness)}>
                {m.measured ? "Measure again" : "Measure"}
              </button>
            )}
          </div>
        )}
        <p className="text-[11px] text-muted">
          A limiter keeps the export just under full scale (-1 dBFS), so the mix never clips. The preview plays the same gain.
        </p>
      </div>
    </div>
  );
}

function TrackRow({
  label,
  level,
  volume,
  max,
  muted,
  soloed,
  onVolume,
  onMute,
  onSolo,
  gesture,
}: {
  label: string;
  level?: Held;
  volume: number;
  max: number;
  muted: boolean;
  soloed: boolean;
  onVolume: (v: number) => void;
  onMute: () => void;
  onSolo: () => void;
  gesture: Gesture;
}) {
  const toggle = (on: boolean) =>
    `rounded px-1.5 py-0.5 text-[10px] font-bold ${on ? "bg-accent-2 text-white" : "border border-border text-muted hover:text-foreground"}`;
  return (
    <div className="rounded-lg border border-border p-2">
      <div className="mb-1 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground" title={label}>
          {label}
        </span>
        <Meter level={muted ? undefined : level} />
        <button type="button" className={toggle(muted)} onClick={onMute} aria-pressed={muted} title={muted ? "Unmute (exported)" : "Mute (exported)"}>
          M
        </button>
        <button type="button" className={toggle(soloed)} onClick={onSolo} aria-pressed={soloed} title="Solo: hear only this (preview only)">
          S
        </button>
      </div>
      <SliderField
        label={`${label} volume`}
        value={Math.round(volume * 100)}
        min={0}
        max={max * 100}
        neutral={100}
        format={(v) => `${v}%`}
        onChange={(v) => onVolume(v / 100)}
        gesture={gesture}
      />
    </div>
  );
}

/** A peak meter with an RMS bar, -60..0 dBFS; red at -1 dBFS and above
 * (where the limiter works), with a short peak hold. */
function Meter({ level, wide = false }: { level?: Held | null; wide?: boolean }) {
  const peak = level?.peak ?? 0;
  const held = level?.hold ?? 0;
  const hot = held >= LIMIT_CEILING;
  const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  return (
    <span
      className={`relative inline-block h-2 overflow-hidden rounded-sm bg-surface-3 ${wide ? "w-32" : "w-20"}`}
      role="meter"
      aria-label="Level"
      aria-valuemin={-60}
      aria-valuemax={0}
      aria-valuenow={Number.isFinite(db) ? Math.round(db) : -60}
      title={Number.isFinite(db) ? `${db.toFixed(1)} dBFS peak` : "Silent"}
    >
      <span className="absolute inset-y-0 left-0 bg-emerald-500/50" style={{ width: `${meterFraction(level?.rms ?? 0) * 100}%` }} />
      <span className="absolute inset-y-0 left-0 bg-emerald-500" style={{ width: `${meterFraction(peak) * 100}%`, opacity: 0.6 }} />
      <span className={`absolute inset-y-0 w-0.5 ${hot ? "bg-rose-500" : "bg-foreground/70"}`} style={{ left: `calc(${meterFraction(held) * 100}% - 1px)` }} />
    </span>
  );
}

/** A meter reading plus the highest peak of the last HOLD_MS. */
type Held = MeterLevel & { hold: number };
const HOLD_MS = 1200;

/** Levels from the preview mixer, refreshed every animation frame. */
function useLevels(): { tracks: Map<string, Held>; master: Held | null } {
  const [levels, setLevels] = useState<{ tracks: Map<string, Held>; master: Held | null }>({ tracks: new Map(), master: null });
  useEffect(() => {
    let raf = 0;
    const holds = new Map<string, { value: number; at: number }>();
    const held = (key: string, l: MeterLevel, now: number): Held => {
      const h = holds.get(key);
      const next = !h || l.peak >= h.value || now - h.at > HOLD_MS ? { value: l.peak, at: now } : h;
      holds.set(key, next);
      return { ...l, hold: next.value };
    };
    const tick = (now: number) => {
      const mixer = previewMixer();
      if (mixer.engaged) {
        const { tracks, master } = mixer.levels();
        setLevels({
          tracks: new Map([...tracks].map(([k, l]) => [k, held(k, l, now)])),
          master: master ? held("master", master, now) : null,
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return levels;
}
