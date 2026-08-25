import type { ResearchTest } from "@/lib/researchData";

export default function BenchmarkTable({ tests }: { tests: ResearchTest[] }) {
  if (tests.length === 0) {
    return (
      <div className="glass-card rounded-[1.75rem] border border-border/80 p-8 text-center">
        <p className="text-sm text-muted leading-relaxed">
          No verified benchmark data has been published yet. Numbers will appear here once tests are
          run and confirmed.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[1.75rem] border border-border/80">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <thead>
          <tr className="bg-surface-2/80">
            <th scope="col" className="p-4 font-display text-sm font-bold text-foreground">Test</th>
            <th scope="col" className="p-4 font-display text-sm font-bold text-foreground">Input</th>
            <th scope="col" className="p-4 font-display text-sm font-bold text-foreground">Output</th>
            <th scope="col" className="p-4 font-display text-sm font-bold text-foreground">FPS in/out</th>
            <th scope="col" className="p-4 font-display text-sm font-bold text-foreground">Clip length</th>
            <th scope="col" className="p-4 font-display text-sm font-bold text-foreground">Processing time</th>
          </tr>
        </thead>
        <tbody>
          {tests.map((t, i) => (
            <tr key={t.id} className={i % 2 === 0 ? "" : "bg-surface-2/30"}>
              <th scope="row" className="p-4 align-top font-semibold text-foreground border-t border-border/60">
                {t.testName}
              </th>
              <td className="p-4 align-top border-t border-border/60 text-muted">{t.inputResolution}</td>
              <td className="p-4 align-top border-t border-border/60 text-muted">{t.outputResolution}</td>
              <td className="p-4 align-top border-t border-border/60 text-muted">
                {t.inputFPS}/{t.outputFPS}
              </td>
              <td className="p-4 align-top border-t border-border/60 text-muted">{t.clipDuration}</td>
              <td className="p-4 align-top border-t border-border/60 text-muted">{t.processingTime}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
