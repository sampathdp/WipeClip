export default function DirectAnswer({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-6">
      <div className="glass-card rounded-2xl border border-cyan-500/30 p-6 sm:p-7">
        <p className="text-xs font-semibold uppercase tracking-wider text-cyan-600">Short answer</p>
        <p className="mt-2 text-sm sm:text-base leading-relaxed text-foreground">{children}</p>
      </div>
    </div>
  );
}
