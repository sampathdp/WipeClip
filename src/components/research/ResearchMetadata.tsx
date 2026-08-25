export default function ResearchMetadata({
  testDate,
  softwareVersion,
}: {
  testDate: string;
  softwareVersion: string;
}) {
  const formatted = new Date(testDate).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted font-mono">
      <span>Tested {formatted}</span>
      <span className="text-border">&middot;</span>
      <span>WipeClip {softwareVersion}</span>
      <span className="text-border">&middot;</span>
      <span>WipeClip.co Research</span>
    </div>
  );
}
