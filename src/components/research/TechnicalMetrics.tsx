import type { ResearchTest } from "@/lib/researchData";

export default function TechnicalMetrics({ test }: { test: ResearchTest }) {
  const stats: { label: string; value: string }[] = [
    { label: "Input", value: test.inputResolution },
    { label: "Output", value: test.outputResolution },
    { label: "FPS in/out", value: `${test.inputFPS}/${test.outputFPS}` },
    { label: "Clip length", value: test.clipDuration },
    { label: "Processing time", value: test.processingTime },
    { label: "Overlay size", value: test.watermarkSize },
    { label: "Background", value: test.backgroundType },
    { label: "Camera movement", value: test.cameraMovement },
    { label: "Visible artifacts", value: test.visibleArtifacts },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {stats.map((s) => (
        <span
          key={s.label}
          className="rounded-full bg-surface-3/80 border border-border px-3 py-1.5 text-xs font-mono text-muted"
        >
          <span className="font-semibold text-foreground">{s.label}:</span> {s.value}
        </span>
      ))}
    </div>
  );
}
