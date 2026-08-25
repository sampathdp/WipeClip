import BeforeAfterComparison from "./BeforeAfterComparison";
import TechnicalMetrics from "./TechnicalMetrics";
import ResearchMetadata from "./ResearchMetadata";
import type { ResearchTest, TestCategoryInfo } from "@/lib/researchData";

export default function TestResultCard({
  categoryInfo,
  test,
}: {
  categoryInfo: TestCategoryInfo;
  test?: ResearchTest;
}) {
  return (
    <div
      id={categoryInfo.key}
      className="scroll-mt-28 glass-card rounded-[2rem] p-8 sm:p-10 border border-border/80"
    >
      <h3 className="font-display text-xl font-bold tracking-tight text-foreground">
        {categoryInfo.label}
      </h3>
      <p className="mt-2 text-sm text-muted leading-relaxed">{categoryInfo.description}</p>

      {test ? (
        <div className="mt-6 space-y-5">
          <BeforeAfterComparison
            beforeMedia={test.beforeMedia}
            afterMedia={test.afterMedia}
            mediaType={test.mediaType}
          />
          <TechnicalMetrics test={test} />
          {test.resultNotes && (
            <p className="text-sm text-muted leading-relaxed">{test.resultNotes}</p>
          )}
          <ResearchMetadata testDate={test.testDate} softwareVersion={test.softwareVersion} />
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-dashed border-border bg-surface-2/40 p-6 text-center">
          <p className="text-sm text-muted leading-relaxed">
            Pending verification — no test has been published for this case yet. It will appear here
            once real before/after footage and measured results are available.
          </p>
        </div>
      )}
    </div>
  );
}
