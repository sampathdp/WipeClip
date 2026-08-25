import { RESEARCH_TESTS, TEST_CATEGORIES } from "@/lib/researchData";
import TestResultCard from "./TestResultCard";

export default function EvidenceGallery() {
  return (
    <div className="grid gap-6">
      {TEST_CATEGORIES.map((cat) => (
        <TestResultCard
          key={cat.key}
          categoryInfo={cat}
          test={RESEARCH_TESTS.find((t) => t.category === cat.key)}
        />
      ))}
    </div>
  );
}
