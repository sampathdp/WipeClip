import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Refund Policy",
  description:
    "WipeClip.co refund policy: a full refund of any paid plan within 14 days of purchase, for any reason.",
  alternates: { canonical: "/refund-policy" },
};

const updated = "October 21, 2026";

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 font-display text-xl font-bold tracking-tight">{children}</h2>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm leading-6 text-muted">{children}</p>;
}

export default function RefundPolicyPage() {
  return (
    <div className="flex flex-1 flex-col">
      <Navbar />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pt-32 pb-24">
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Refund Policy</h1>
        <p className="mt-2 text-sm text-muted">Last updated: {updated}</p>

        <P>
          This policy covers every paid purchase on WipeClip.co: the Lite, Starter and Pro plans, sold as one-time
          payments for 30 days or 1 year. It forms part of our{" "}
          <Link href="/terms" className="underline hover:text-foreground">
            Terms of Service
          </Link>
          .
        </P>

        <H2>1. 14-day refund, no questions asked</H2>
        <P>
          You can request a full refund of any paid purchase within 14 days of purchase, for any reason. We
          refund the full amount you paid, to the original payment method.
        </P>

        <H2>2. After 14 days</H2>
        <P>
          Refunds requested more than 14 days after purchase are at our discretion. We will always consider a
          request where the Service did not work as described, for example repeated failed exports or AI jobs
          that we could not fix.
        </P>

        <H2>3. What happens when you are refunded</H2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted">
          <li>A refunded plan ends immediately and your account returns to the free plan.</li>
          <li>AI credits included with the refunded purchase are removed from your balance.</li>
          <li>Your projects, and credits from other purchases, are not affected.</li>
        </ul>

        <H2>4. Plans don&apos;t renew automatically</H2>
        <P>
          Paid plans are prepaid for 30 days or 365 days and end on their own. You are never
          charged again unless you choose to buy another period, so there is nothing to cancel.
        </P>

        <H2>5. Failed jobs</H2>
        <P>
          If an AI job fails because of a problem on our side, the credits it used are returned to your balance
          automatically. You don&apos;t need to request this.
        </P>

        <H2>6. How to request a refund</H2>
        <P>
          Email{" "}
          <a href="mailto:support@wipeclip.co" className="underline hover:text-foreground">
            support@wipeclip.co
          </a>{" "}
          from the address on your account, with the date of purchase and the plan you bought. We reply
          within 2 business days, and approved refunds are processed within 5 business days. Your bank may take
          a few more days to show the refund.
        </P>
        <P>
          Purchases made outside Sri Lanka are sold by our reseller Paddle.com, the Merchant of Record for those
          orders, and refunds for them are issued through Paddle to your original payment method. You can also
          contact Paddle directly using the link in your purchase receipt. Purchases made in Sri Lanka through
          Payments.lk are refunded in Sri Lankan rupees (LKR) to the original payment method.
        </P>

        <H2>7. Your legal rights</H2>
        <P>
          This policy is in addition to, and does not limit, any rights you have under the consumer protection
          laws of the country where you live.
        </P>
      </main>
      <Footer />
    </div>
  );
}
