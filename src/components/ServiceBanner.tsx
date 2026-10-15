import { BACKEND_DISABLED, BACKEND_DISABLED_MESSAGE } from "@/lib/toolsApi";

/** Site-wide notice shown while the AI backend is switched off
 * (NEXT_PUBLIC_BACKEND_DISABLED=true). Renders nothing otherwise. */
export default function ServiceBanner() {
  if (!BACKEND_DISABLED) return null;
  return (
    <div
      role="status"
      className="w-full bg-accent px-4 py-2 text-center text-sm font-medium text-accent-foreground"
    >
      <span aria-hidden>🚧 </span>
      Service under construction. {BACKEND_DISABLED_MESSAGE}
    </div>
  );
}
