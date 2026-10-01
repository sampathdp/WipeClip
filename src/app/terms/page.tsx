import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms that govern your use of WipeClip.co, including acceptable use, content ownership, and liability.",
  alternates: { canonical: "/terms" },
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

export default function TermsPage() {
  return (
    <div className="flex flex-1 flex-col">
      <Navbar />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pt-32 pb-24">
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
        Terms of Service
      </h1>
      <p className="mt-2 text-sm text-muted">Last updated: {updated}</p>

      <P>
        These Terms of Service (&quot;Terms&quot;) govern your access to and
        use of WipeClip.co (&quot;WipeClip.co&quot;, &quot;we&quot;, &quot;us&quot;,
        or &quot;our&quot;), including the website and the media-editing
        service it provides (the &quot;Service&quot;). By uploading a file or
        otherwise using the Service, you agree to these Terms. If you do not
        agree, do not use the Service.
      </P>

      <H2>1. What the Service does</H2>
      <P>
        WipeClip.co is an AI video and image cleanup tool. You mark a region
        of a file you provide and the Service reconstructs or replaces it
        (for example a logo, watermark, caption, timestamp, or another
        unwanted object) using automated image/video processing, so you can
        restore a clean version of footage you own or are authorized to
        edit. You choose the region; the Service does not automatically
        detect or target any specific brand&apos;s mark.
      </P>

      <H2>2. Eligibility</H2>
      <P>
        You must be at least 16 years old, or the age of legal majority in
        your jurisdiction if higher, and able to form a binding contract to
        use the Service.
      </P>

      <H2>3. Your content and your responsibility</H2>
      <P>
        You are solely responsible for the media you upload. By using the
        Service you represent and warrant that:
      </P>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted">
        <li>
          you own the content, or you have the rights and any necessary
          permission from the rights holder to edit it in the way you are
          using the Service for;
        </li>
        <li>
          your use does not infringe any copyright, trademark, right of
          publicity, or other intellectual property or legal right of any
          person or entity;
        </li>
        <li>
          your use does not circumvent, remove, or alter copyright management
          information, provenance metadata, or a required disclosure mark in
          a way that facilitates copyright infringement or violates
          applicable law; and
        </li>
        <li>
          your use complies with the terms of service of any platform the
          content came from or will be published to.
        </li>
      </ul>
      <P>
        WipeClip.co is a general-purpose retouching tool intended for lawful
        personal and professional editing: cleaning up your own footage,
        removing incidental artifacts, or retouching assets you have
        permission to modify. It is not intended, and must not be used, to
        help you republish someone else&apos;s copyrighted work as your own,
        misrepresent AI-generated content as authentic, or evade a
        platform&apos;s labeling or provenance requirements for deceptive
        purposes.
      </P>

      <H2>4. Prohibited use</H2>
      <P>You agree not to use the Service to:</P>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted">
        <li>process content you do not own and do not have permission to edit;</li>
        <li>infringe or facilitate infringement of any intellectual property right;</li>
        <li>violate any applicable law, including copyright, trademark, or AI-disclosure law;</li>
        <li>upload unlawful, defamatory, or content depicting a real person without their consent (including non-consensual intimate imagery);</li>
        <li>upload sexually explicit or adult content;</li>
        <li>attempt to abuse, overload, scrape, or reverse-engineer the Service; or</li>
        <li>resell or redistribute the Service without our written permission.</li>
      </ul>
      <P>
        We use automated screening to detect explicit content before
        processing and reject uploads it flags. This screening is a
        heuristic safeguard, not a guarantee. We may still reject content in
        error or fail to catch content that violates these Terms, and we may
        suspend or terminate access for violations detected by other means.
      </P>

      <H2>5. Processing and retention</H2>
      <P>
        Files you upload are processed to generate your output and are then
        deleted; we do not retain a copy of your input or output files after
        your processing request completes. See our{" "}
        <Link href="/privacy" className="underline hover:text-foreground">
          Privacy Policy
        </Link>{" "}
        for details.
      </P>

      <H2>6. Paid Plans, Credits & Refund Policy</H2>
      <P>
        WipeClip.co offers a free plan and paid plans (Lite, Starter and Pro,
        each available monthly or yearly), plus one-time AI credit packs. What
        each plan includes is listed on the{" "}
        <Link href="/pricing" className="underline hover:text-foreground">
          pricing page
        </Link>
        .
      </P>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted">
        <li>
          <strong>Billing:</strong> Paid transactions are processed by
          Payments.lk (a Payable company) and charged in Sri Lankan rupees
          (LKR). When purchasing a plan, you agree to Payments.lk&apos;s
          customer terms and privacy policy.
        </li>
        <li>
          <strong>Plans &amp; Renewal:</strong> Paid plans are prepaid for 30
          days (monthly) or 365 days (yearly) and do not renew automatically.
          Buying the same plan again before it ends adds the new period to the
          time left. When a plan ends, your account returns to the free plan;
          your projects and purchased credits are kept.
        </li>
        <li>
          <strong>Credits:</strong> AI credits are used by the AI tools (object
          cleanup, background removal, sharpening); editing and exporting in
          the video editor never use credits. Credits included with a plan are
          added when you buy it; purchased credits never expire and have no
          cash value. If an AI job fails due to an internal server error, the
          credits it used are returned to your balance automatically.
        </li>
        <li>
          <strong>Refund Policy:</strong> We offer a 14-day refund window for paid
          purchases if you have not used more than 20% of your purchased credits
          and have experienced unresolved technical difficulties with the Service.
          To request a refund, contact us at{" "}
          <a href="mailto:support@wipeclip.co" className="underline hover:text-foreground">
            support@wipeclip.co
          </a>
          .
        </li>
      </ul>

      <H2>7. Intellectual property &amp; Trademarks</H2>
      <P>
        We retain all rights in the Service itself, including its software,
        design, and branding. You retain all rights in the content you
        upload; we claim no ownership over it and use it solely to provide
        the Service to you.
      </P>
      <P>
        All third-party product names, logos, and trademarks mentioned on the
        website are the property of their respective owners. Their
        mention does not imply any affiliation, sponsorship, or endorsement.
      </P>

      <H2>8. Copyright complaints</H2>
      <P>
        If you believe content processed through the Service infringes your
        copyright, see our{" "}
        <Link href="/dmca" className="underline hover:text-foreground">
          Copyright / DMCA Policy
        </Link>
        .
      </P>

      <H2>9. Disclaimer of warranties</H2>
      <P>
        The Service is provided &quot;as is&quot; and &quot;as available&quot;
        without warranties of any kind, express or implied, including
        merchantability, fitness for a particular purpose, and
        non-infringement. We do not warrant that processing results will be
        error-free or meet your expectations.
      </P>

      <H2>10. Limitation of liability</H2>
      <P>
        To the maximum extent permitted by law, WipeClip.co will not be liable
        for any indirect, incidental, special, consequential, or punitive
        damages, or any loss of data, revenue, or goodwill, arising from your
        use of the Service. Our total liability for any claim arising from
        the Service will not exceed the amount you paid us, if any, in the
        twelve months before the claim arose.
      </P>

      <H2>11. Indemnification</H2>
      <P>
        You agree to indemnify and hold WipeClip.co harmless from any claim,
        loss, liability, or expense (including reasonable legal fees) arising
        from your content, your use of the Service, or your violation of
        these Terms.
      </P>

      <H2>12. Termination</H2>
      <P>
        We may suspend or terminate your access to the Service at any time,
        with or without notice, for conduct that violates these Terms or is
        otherwise harmful to us, other users, or third parties.
      </P>

      <H2>13. Changes to these Terms</H2>
      <P>
        We may update these Terms from time to time. Continued use of the
        Service after a change becomes effective constitutes acceptance of
        the revised Terms.
      </P>

      <H2>14. Governing law &amp; Dispute resolution</H2>
      <P>
        These Terms and any dispute arising out of or related to them shall be
        governed by and construed in accordance with the laws applicable in your
        country of residence or operation, without giving effect to any conflict
        of law principles. Any legal action or proceeding arising under these
        Terms will be brought exclusively in the courts of competent
        jurisdiction.
      </P>

      <H2>15. Contact</H2>
      <P>
        Questions about these Terms can be sent to{" "}
        <a href="mailto:legal@wipeclip.co" className="underline hover:text-foreground">
          legal@wipeclip.co
        </a>
        .
      </P>
      </main>
      <Footer />
    </div>
  );
}
