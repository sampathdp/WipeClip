import type { Metadata } from "next";
import Logo from "@/components/Logo";

export const metadata: Metadata = {
  title: "Coming Soon",
  robots: { index: false, follow: false },
};

export default function UnderConstructionPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center relative overflow-hidden">
      <div
        aria-hidden
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-96 w-96 rounded-full bg-accent/6 blur-[120px] pointer-events-none -z-10 dark:bg-accent/20"
      />

      <Logo size={56} textSize="text-2xl" />

      <h1 className="font-display mt-8 text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
        We&apos;re putting on the finishing touches
      </h1>
      <p className="mt-4 max-w-md text-sm sm:text-base text-muted">
        WipeClip.co is almost ready. We&apos;re wrapping up a few things behind
        the scenes. Check back soon.
      </p>
    </div>
  );
}
