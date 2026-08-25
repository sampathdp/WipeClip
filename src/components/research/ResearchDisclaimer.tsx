export default function ResearchDisclaimer({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`glass-card rounded-2xl border border-cyan-500/30 ${
        compact ? "p-4" : "p-6 sm:p-7"
      }`}
    >
      <p className={`font-semibold text-foreground ${compact ? "text-sm" : "text-base"}`}>
        No fabricated results
      </p>
      <p className="mt-1.5 text-sm text-muted leading-relaxed">
        Every number and clip on this page comes from a test that was actually run and recorded,
        never an estimate, an industry average, or a placeholder dressed up as a result. Where a test
        hasn&apos;t been run yet, this page says so instead of showing a number.
      </p>
    </div>
  );
}
