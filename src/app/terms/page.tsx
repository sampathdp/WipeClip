import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { AI_CLEANUP_ENABLED } from "@/lib/features";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms that govern your use of WipeClip.co, including acceptable use, content ownership, and liability.",
  alternates: { canonical: "/terms" },
};

const updated = "October 21, 2026";

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
        use of WipeClip.co, including the website and the media-editing
        service it provides (the &quot;Service&quot;). WipeClip.co is a
        product of Codeplay Studios, operated by Surage Sampath Dananjaya
        Peries trading as Codeplay Studios, 115/A Gagabada Road, Hirana,
        Panadura, Sri Lanka
        (&quot;WipeClip.co&quot;, &quot;we&quot;, &quot;us&quot;, or
        &quot;our&quot;). By uploading a file or
        otherwise using the Service, you agree to these Terms. If you do not
        agree, do not use the Service.
      </P>

      <H2>1. What the Service does</H2>
      {AI_CLEANUP_ENABLED ? (
        <P>
          WipeClip.co is a desktop video editor for Windows and macOS with AI object removal.
          You mark an unwanted object in a file you provide (for example a
          passer-by, a stray cable, or a lens smudge) and the Service
          reconstructs that region using automated image/video processing.
          You choose the region; the Service is intended only for content you
          own or have permission to edit.
        </P>
      ) : (
        <P>
          WipeClip.co is a desktop video editor for Windows and macOS with automated captions
          and photo tools (background removal, sharpening and frame capture).
          The Service is intended only for content you own or have permission
          to edit.
        </P>
      )}

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
          you will not use the Service to remove, obscure, or alter any
          ownership mark, copyright notice, copyright management
          information, provenance metadata, or required disclosure mark; and
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
        <li>remove or obscure any mark identifying the owner or source of content;</li>
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

      <H2>6. Accounts</H2>
      <P>
        Some features need an account. You are responsible for keeping access
        to your account (including the email or sign-in method you use)
        secure and for all activity under it. Tell us promptly at{" "}
        <a href="mailto:support@wipeclip.co" className="underline hover:text-foreground">
          support@wipeclip.co
        </a>{" "}
        if you believe your account has been used without your permission.
        One person may not create multiple accounts to obtain extra free
        credits or referral rewards.
      </P>

      <H2>7. Paid Plans, Credits & Refund Policy</H2>
      <P>
        WipeClip.co offers a free plan and paid plans (Lite, Starter and Pro),
        each sold as a one-time payment for 30 days or for 1 year. What each
        plan includes and costs is listed on the{" "}
        <Link href="/pricing" className="underline hover:text-foreground">
          pricing page
        </Link>
        . The price shown at checkout, including any applicable taxes, is the
        price you pay. We may change prices or plan contents for future
        purchases; a change never affects a period you have already paid for.
      </P>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted">
        <li>
          <strong>Billing:</strong> Customers outside Sri Lanka buy through
          our online reseller Paddle.com, which is the Merchant of Record for
          those orders and also handles related customer service inquiries
          and returns; those purchases are subject to Paddle&apos;s buyer
          terms. Customers in Sri Lanka pay through Payments.lk (a Payable
          company) in Sri Lankan rupees (LKR), subject to Payments.lk&apos;s
          customer terms and privacy policy.
        </li>
        <li>
          <strong>Plans &amp; Renewal:</strong> Paid plans are prepaid for 30
          days or 365 days and do not renew automatically. You are never
          charged again unless you choose to buy another period, so there is
          no subscription to cancel. Buying the same plan again before it ends
          adds the new period to the time left. When a plan ends, your account
          returns to the free plan; your projects and remaining AI credits are
          kept.
        </li>
        <li>
          <strong>Credits:</strong> AI credits are used by the AI tools (
          {AI_CLEANUP_ENABLED ? "object cleanup, " : ""}background removal, sharpening); editing and exporting in
          the video editor never use credits. Credits included with a plan are
          added when you buy it and do not expire. Credits have no cash value
          and cannot be transferred, sold or exchanged for money, except as
          part of a refund under the Refund Policy. If an AI job fails due to
          an internal server error, the credits it used are returned to your
          balance automatically.
        </li>
        <li>
          <strong>Refund Policy:</strong> You can request a full refund of any
          paid purchase within 14 days of purchase, for any reason. After
          14 days, refunds are at our discretion. A refunded plan ends and its
          remaining credits are removed. See the full{" "}
          <Link href="/refund-policy" className="underline hover:text-foreground">
            Refund Policy
          </Link>
          . To request a refund, contact us at{" "}
          <a href="mailto:support@wipeclip.co" className="underline hover:text-foreground">
            support@wipeclip.co
          </a>
          .
        </li>
      </ul>

      <H2>8. Intellectual property &amp; Trademarks</H2>
      <P>
        We retain all rights in the Service itself, including its software,
        design, and branding. You retain all rights in the content you
        upload; we claim no ownership over it and use it solely to provide
        the Service to you.
      </P>
      <P>
        Any third-party names or trademarks referenced on the website are the
        property of their respective owners. Their
        mention does not imply any affiliation, sponsorship, or endorsement.
      </P>

      <H2>9. Copyright complaints</H2>
      <P>
        If you believe content processed through the Service infringes your
        copyright, see our{" "}
        <Link href="/dmca" className="underline hover:text-foreground">
          Copyright / DMCA Policy
        </Link>
        .
      </P>

      <H2>10. Availability and changes to the Service</H2>
      <P>
        We work to keep the Service available and reliable, but we do not
        guarantee that it will be uninterrupted or error-free. We may change,
        add or remove features, and may carry out maintenance that makes the
        Service temporarily unavailable. Your editor project is saved only in
        your browser on your device, for recovery after a refresh, and on the
        website is kept there for up to 7 days. Clearing your browser data
        removes it, so export and keep your own copies of anything important.
      </P>

      <H2>11. AI-generated results</H2>
      <P>
        The AI tools produce results automatically, and those results can be
        imperfect or differ from what you expect. Review every result before
        you publish or rely on it. You are responsible for how you use the
        output.
      </P>

      <H2>12. Disclaimer of warranties</H2>
      <P>
        To the maximum extent permitted by law, the Service is provided
        &quot;as is&quot; and &quot;as available&quot; without warranties of
        any kind, express or implied, including merchantability, fitness for
        a particular purpose, and non-infringement. We do not warrant that
        processing results will be error-free or meet your expectations.
      </P>

      <H2>13. Limitation of liability</H2>
      <P>
        To the maximum extent permitted by law, WipeClip.co will not be liable
        for any indirect, incidental, special, consequential, or punitive
        damages, or any loss of data, revenue, or goodwill, arising from your
        use of the Service. Our total liability for any claim arising from
        the Service will not exceed the amount you paid us, if any, in the
        twelve months before the claim arose.
      </P>
      <P>
        Nothing in these Terms excludes or limits any liability that cannot
        be excluded or limited by law, or any rights you have as a consumer
        under the mandatory laws of the country where you live.
      </P>

      <H2>14. Indemnification</H2>
      <P>
        To the extent permitted by law, you agree to indemnify and hold
        WipeClip.co harmless from any claim, loss, liability, or expense
        (including reasonable legal fees) brought by a third party and arising
        from your content, your misuse of the Service, or your violation of
        these Terms.
      </P>

      <H2>15. Termination</H2>
      <P>
        You can stop using the Service at any time, and ask us to delete your
        account as described in our Privacy Policy. We may suspend or
        terminate your access to the Service for conduct that violates these
        Terms or is otherwise harmful to us, other users, or third parties.
        Where we terminate an account that has a paid plan without a breach
        of these Terms on your part, we will refund the unused part of that
        plan.
      </P>

      <H2>16. Changes to these Terms</H2>
      <P>
        We may update these Terms from time to time, and will change the
        &quot;Last updated&quot; date above when we do. For material changes
        we will give reasonable notice on the website or by email before they
        take effect. Continued use of the Service after a change becomes
        effective constitutes acceptance of the revised Terms.
      </P>

      <H2>17. Governing law &amp; Dispute resolution</H2>
      <P>
        These Terms and any dispute arising out of or related to them are
        governed by the laws of Sri Lanka, without giving effect to any
        conflict of law principles. The courts of Sri Lanka have jurisdiction
        over any such dispute. If you are a consumer, this does not take away
        the protection of the mandatory laws of the country where you live, or
        your right to bring a claim in its courts.
      </P>
      <P>
        Before starting any formal proceedings, please contact us at{" "}
        <a href="mailto:legal@wipeclip.co" className="underline hover:text-foreground">
          legal@wipeclip.co
        </a>{" "}
        so we can try to resolve the issue informally.
      </P>

      <H2>18. General</H2>
      <P>
        These Terms, together with the Privacy Policy, Refund Policy and
        Copyright / DMCA Policy they refer to, are the entire agreement
        between you and us about the Service. If any part of these Terms is
        found unenforceable, the rest remains in effect. If we do not enforce
        a provision right away, we have not waived it.
      </P>

      <H2>19. Contact</H2>
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
