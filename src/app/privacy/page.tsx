import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How WipeClip.co handles the files you upload and what data we collect.",
  alternates: { canonical: "/privacy" },
};

const updated = "August 19, 2026";

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-10 font-display text-xl font-bold tracking-tight">{children}</h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm leading-6 text-muted">{children}</p>;
}

export default function PrivacyPage() {
  return (
    <div className="flex flex-1 flex-col">
      <Navbar />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pt-32 pb-24">
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
        Privacy Policy
      </h1>
      <p className="mt-2 text-sm text-muted">Last updated: {updated}</p>

      <P>
        This policy explains what happens to your data when you use WipeClip.co
        (&quot;we&quot;, &quot;us&quot;). We built the Service to need as
        little of your data as possible.
      </P>

      <H2>1. The media you upload</H2>
      <P>
        When you upload a video or image, it is sent directly to our
        processing backend, held in a temporary location only for the
        duration of your request, and deleted immediately once the result is
        returned to your browser. We do not keep a copy, we do not use your
        media to train any model, and we do not view it manually except when
        strictly necessary to investigate a bug you&apos;ve reported or abuse
        of the Service.
      </P>

      <H2>2. Information collected automatically</H2>
      <P>
        Like most websites, our hosting and network infrastructure may log
        standard technical data for security and reliability purposes, for
        example IP address, browser type, and request timestamps. These logs
        are used only to operate and secure the Service and are retained for
        a limited period.
      </P>

      <H2>3. Cookies and analytics</H2>
      <P>
        The Service does not currently set tracking or advertising cookies.
        If we add analytics or essential functional cookies in the future,
        we will update this policy to describe what is collected and why.
      </P>

      <H2>4. Payment information</H2>
      <P>
        Payments for WipeClip.co plans and credit packs are securely processed
        by Lemon Squeezy, acting as our authorized Merchant of Record. We do
        not collect, store, or process your credit card numbers or raw billing
        details on our servers. All transactions are subject to Lemon
        Squeezy&apos;s Privacy Policy and Security Standards.
      </P>

      <H2>5. Sharing</H2>
      <P>
        We do not sell your data. We only share information with service
        providers who help us run the Service (such as hosting), under
        obligations consistent with this policy, or when required by law.
      </P>

      <H2>6. Your rights</H2>
      <P>
        Depending on where you live, you may have the right to access,
        correct, or delete personal data we hold about you, or to object to
        certain processing. Since we don&apos;t retain your uploaded media
        after processing, most requests will relate to the technical logs
        described in Section 2. Contact us at the address below to make a
        request.
      </P>

      <H2>7. Children</H2>
      <P>
        The Service is not directed at children under 13 (or the minimum age
        required in your jurisdiction) and we do not knowingly collect data
        from them.
      </P>

      <H2>8. Changes to this policy</H2>
      <P>
        We may update this policy as the Service evolves. Material changes
        will be reflected by updating the &quot;Last updated&quot; date
        above.
      </P>

      <H2>9. Contact</H2>
      <P>
        Questions about this policy or a data request can be sent to{" "}
        <a href="mailto:privacy@wipeclip.co" className="underline hover:text-foreground">
          privacy@wipeclip.co
        </a>
        .
      </P>
      </main>
      <Footer />
    </div>
  );
}
