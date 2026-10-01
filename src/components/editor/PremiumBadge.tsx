/** Crown marker on a premium transition, filter or effect. Shown only to
 * users whose plan doesn't include premium features: they can still try
 * the item in the editor, and the export dialog asks them to upgrade or
 * remove it (see src/lib/entitlements.ts).
 */
export default function PremiumBadge({ className = "absolute right-1 top-1" }: { className?: string }) {
  return (
    <span
      title="Premium: included in Starter and Pro"
      aria-label="Premium"
      className={`${className} inline-flex h-4 items-center rounded-full bg-amber-400 px-1 text-black shadow-sm`}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M3 18l-1-11 6 5 4-8 4 8 6-5-1 11z" />
      </svg>
    </span>
  );
}
