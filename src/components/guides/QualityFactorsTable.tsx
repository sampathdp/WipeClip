const factors: { term: string; meaning: string; effect: string }[] = [
  {
    term: "Resolution",
    meaning: "The pixel dimensions of the frame, e.g. 1920×1080.",
    effect: "Sets the ceiling for detail, but a high-resolution file can still look worse than a lower-resolution one if other factors below are poor.",
  },
  {
    term: "Frame rate",
    meaning: "How many frames play per second.",
    effect: "Affects motion smoothness, not sharpness. Dropping it makes motion choppier, independent of resolution.",
  },
  {
    term: "Bitrate",
    meaning: "How much data is used to encode each second of video.",
    effect: "A major driver of visible quality. Two files at the same resolution can look very different if one uses a much lower bitrate.",
  },
  {
    term: "Codec",
    meaning: "The compression algorithm used to encode the video (e.g. H.264, H.265).",
    effect: "Different codecs need different bitrates to reach the same visual quality — the codec name alone doesn't tell you the result.",
  },
  {
    term: "Re-encoding",
    meaning: "Decompressing a video and compressing it again, which happens whenever a file is processed and re-exported.",
    effect: "Each re-encode is a fresh opportunity to introduce compression artifacts, even if resolution and frame rate stay identical.",
  },
  {
    term: "Compression",
    meaning: "The general process of reducing file size by discarding some information.",
    effect: "Heavier compression trades file size for visible quality — blockiness, softness, or banding in detailed or fast-moving areas.",
  },
  {
    term: "Reconstructed pixels",
    meaning: "The pixels WipeClip generates inside the marked region.",
    effect: "An estimate based on surrounding footage, not a copy of the original pixels — the one part of the frame that isn't simply preserved from the source.",
  },
  {
    term: "Local artifacts",
    meaning: "Visible imperfections confined to a specific area of the frame, rather than the whole image.",
    effect: "Where reconstruction quality actually shows up, if it's going to — confined to the marked region, not spread across the frame.",
  },
];

export default function QualityFactorsTable() {
  return (
    <div className="overflow-x-auto rounded-[1.75rem] border border-border/80">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <caption className="sr-only">Factors that affect video quality independent of resolution</caption>
        <thead>
          <tr className="bg-surface-2/80">
            <th scope="col" className="p-4 font-display text-sm font-bold text-foreground">Factor</th>
            <th scope="col" className="p-4 font-display text-sm font-bold text-foreground">What it means</th>
            <th scope="col" className="p-4 font-display text-sm font-bold text-foreground">How it affects quality</th>
          </tr>
        </thead>
        <tbody>
          {factors.map((f, i) => (
            <tr key={f.term} className={i % 2 === 0 ? "" : "bg-surface-2/30"}>
              <th scope="row" className="p-4 align-top font-semibold text-foreground border-t border-border/60">
                {f.term}
              </th>
              <td className="p-4 align-top border-t border-border/60 text-muted">{f.meaning}</td>
              <td className="p-4 align-top border-t border-border/60 text-muted">{f.effect}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
