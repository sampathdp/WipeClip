import Link from "next/link";

/** Site-wide teaser for the upcoming desktop editor. */
export default function ServiceBanner() {
  return (
    <div
      role="status"
      className="w-full bg-accent px-4 py-2 text-center text-sm font-medium text-accent-foreground"
    >
      <span aria-hidden>✨ </span>
      The WipeClip editor is coming soon, packed with crazy new features.{" "}
      <Link href="/download" className="font-semibold underline underline-offset-2">
        Get notified
      </Link>
    </div>
  );
}
