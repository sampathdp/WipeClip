import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import PurchaseTracker from "./PurchaseTracker";

export const metadata: Metadata = {
  title: "Welcome",
  robots: { index: false, follow: false },
};

/** Where both checkouts (Paddle and Payments.lk) send the buyer after a
 * successful payment (successUrl in /api/checkout). The webhook, not this
 * page, grants the plan, so it can take a few seconds to show up. */
export default function WelcomePage() {
  return (
    <div className="flex flex-1 flex-col min-h-screen">
      <Navbar />
      <main className="flex flex-1 flex-col items-center justify-center px-6 pt-36 pb-28 text-center relative overflow-hidden">
        <div
          aria-hidden
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-96 w-96 rounded-full bg-accent/6 blur-[120px] pointer-events-none -z-10 dark:bg-accent/20"
        />
        <PurchaseTracker />
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
          Thanks, your payment went through
        </h1>
        <p className="mt-4 max-w-md text-sm sm:text-base text-muted">
          Your plan and AI credits are being added to your account and should appear within a minute. A receipt is on
          its way to your email.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/editor" className="btn-primary rounded-full px-6 py-3 text-sm font-bold">
            Open the editor
          </Link>
          <Link href="/profile" className="btn-secondary rounded-full px-6 py-3 text-sm font-semibold">
            View your plan
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
