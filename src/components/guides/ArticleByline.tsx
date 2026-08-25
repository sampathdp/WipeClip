export default function ArticleByline({
  publishedDate,
  updatedDate,
}: {
  publishedDate: string;
  updatedDate: string;
}) {
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="mx-auto max-w-3xl px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted font-mono border-t border-border/60 pt-4">
        <span>By WipeClip.co</span>
        <span className="text-border">&middot;</span>
        <span>Published {fmt(publishedDate)}</span>
        {updatedDate !== publishedDate && (
          <>
            <span className="text-border">&middot;</span>
            <span>Updated {fmt(updatedDate)}</span>
          </>
        )}
      </div>
    </div>
  );
}
