import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How WipeClip.co handles the files you upload, your account and payment data, and your privacy rights.",
  alternates: { canonical: "/privacy" },
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

function UL({ children }: { children: React.ReactNode }) {
  return <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted">{children}</ul>;
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
        This policy explains what personal data WipeClip.co (&quot;we&quot;,
        &quot;us&quot;) collects when you use the website and the
        media-editing service it provides (the &quot;Service&quot;), why we
        collect it, and the choices you have. We built the Service to need as
        little of your data as possible.
      </P>
      <P>
        WipeClip.co is operated by Surage Sampath Dananjaya Peries, a sole
        trader at 115/A Gagabada Road, Hirana, Panadura, Sri Lanka, who is
        the controller responsible for your personal data.
      </P>

      <H2>1. The media you upload</H2>
      <P>
        When you use a tool that needs our servers (for example an AI tool or
        an export), your video or image is sent to our processing backend,
        held only for the duration of your request, and deleted once the
        result is returned to your browser; any temporary result is removed
        automatically within minutes. We do not keep a copy, we do not use
        your media to train any model, and we do not view it manually except
        when strictly necessary to investigate a bug you&apos;ve reported or
        abuse of the Service.
      </P>
      <P>
        Your editor project is saved only in your own browser (on your
        device) so a refresh doesn&apos;t lose your work. It is not sent to
        us, and on the website it is kept for up to 7 days or until you clear
        your browser data.
      </P>

      <H2>2. Your account</H2>
      <P>
        If you create an account, we store:
      </P>
      <UL>
        <li>
          your email address, and your name and profile picture if you sign in
          with Google (we never receive your Google password);
        </li>
        <li>
          your plan, when it ends, your AI credit balance and a history of how
          credits were added and used;
        </li>
        <li>
          your orders: what you bought, when, the amount and currency, and the
          payment provider&apos;s reference for the order;
        </li>
        <li>
          if you use the referral program, your referral code and who referred
          you; and
        </li>
        <li>
          any feedback or bug reports you send us, with the page and browser
          they were sent from.
        </li>
      </UL>
      <P>
        We use this to provide the Service: to sign you in, apply your plan
        and credits, record purchases, answer support requests and prevent
        abuse. The legal basis is performing our contract with you and, for
        security and fraud prevention, our legitimate interests.
      </P>

      <H2>3. Payment information</H2>
      <P>
        Payments are processed by Paddle.com, our Merchant of Record, for
        customers outside Sri Lanka, and by Payments.lk (a Payable company)
        for customers in Sri Lanka. You enter your card or other payment
        details only on their checkout; we never collect, see or store your
        card number. They share with us what we need to fulfil your order: the
        order reference, its status, the amount and currency, and a customer
        reference. They process your payment data under their own privacy
        policies, and Paddle, as Merchant of Record, is also responsible for
        the sales tax, invoices and receipts for its orders.
      </P>

      <H2>4. Information collected automatically</H2>
      <P>
        Our hosting and network providers log standard technical data for
        security and reliability, such as IP address, browser type and request
        timestamps. We also use your approximate country, derived from your IP
        address, to choose the right payment provider and show prices in your
        local currency. These logs are used only to operate and secure the
        Service and are kept for a limited period.
      </P>

      <H2>5. Cookies, local storage and analytics</H2>
      <P>
        We do not use advertising cookies or sell data to advertisers. We use:
      </P>
      <UL>
        <li>
          <strong>Essential cookies</strong> to keep you signed in. The Service
          does not work without them, so they don&apos;t need consent.
        </li>
        <li>
          <strong>Browser storage</strong> on your device for your editor
          project and recent results, as described above.
        </li>
        <li>
          <strong>Privacy-friendly analytics</strong> from our hosting provider,
          to count page views, measure page speed and see which steps of the
          site people use (for example opening the pricing page or starting a
          checkout). It does not use cookies, does not identify you personally
          and does not track you across other websites.
        </li>
      </UL>
      <P>
        The payment providers&apos; checkouts may set their own cookies when
        you open them, under their own policies.
      </P>

      <H2>6. Who we share data with</H2>
      <P>
        We do not sell your personal data. We share it only with service
        providers that help us run the Service, under contracts that require
        them to protect it and use it only for us:
      </P>
      <UL>
        <li>hosting, content delivery and security providers;</li>
        <li>our database and sign-in provider, which stores your account data;</li>
        <li>Google, only if you choose to sign in with Google;</li>
        <li>Paddle.com and Payments.lk, for payments, as described above; and</li>
        <li>authorities, when the law requires us to, or to protect our rights or the safety of others.</li>
      </UL>
      <P>
        Some of these providers process data outside the country where you
        live. Where the law requires it, we rely on appropriate safeguards
        such as standard contractual clauses.
      </P>

      <H2>7. How long we keep data</H2>
      <UL>
        <li>Uploaded media: only while it is being processed, as described in section 1.</li>
        <li>Account data: for as long as your account exists. When you ask us to delete your account, we delete it within 30 days.</li>
        <li>
          Order and payment records: as long as tax and accounting law requires
          (usually up to 7 years), even after your account is deleted.
        </li>
        <li>Technical logs: for a limited period, then deleted automatically.</li>
      </UL>

      <H2>8. Security</H2>
      <P>
        Data is encrypted in transit (HTTPS), access to our systems is
        restricted to the people who need it, and account data is protected by
        access rules in our database. No system is perfectly secure, but we
        work to protect your data and will notify you and the authorities of a
        breach where the law requires it.
      </P>

      <H2>9. Your rights</H2>
      <P>
        Depending on where you live, you may have the right to access the
        personal data we hold about you, correct it, delete it, receive a copy
        of it, or object to or restrict certain processing. To use any of these
        rights, or to delete your account, email us from the address on your
        account at the contact below. We respond within 30 days. You can also
        complain to the data protection authority in your country.
      </P>

      <H2>10. Children</H2>
      <P>
        The Service is not directed at anyone under 16 (or the minimum age
        required in your jurisdiction, if higher), and we do not knowingly
        collect their data. If you believe a child has given us personal data,
        contact us and we will delete it.
      </P>

      <H2>11. Changes to this policy</H2>
      <P>
        We may update this policy as the Service evolves, and will change the
        &quot;Last updated&quot; date above when we do. For material changes
        we will give notice on the website or by email.
      </P>

      <H2>12. Contact</H2>
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
