import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Copyright / DMCA Policy",
  description:
    "How to report suspected copyright infringement involving WipeClip.co, and our policy on repeat offenders.",
  alternates: { canonical: "/dmca" },
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

export default function DmcaPage() {
  return (
    <div className="flex flex-1 flex-col">
      <Navbar />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pt-32 pb-24">
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
        Copyright / DMCA Policy
      </h1>
      <p className="mt-2 text-sm text-muted">Last updated: {updated}</p>

      <P>
        WipeClip.co is a self-serve editing tool: users upload their own media,
        we process it, and we return the result — we do not host, index, or
        make user content available to anyone else. Even so, we take
        copyright seriously and require every user to confirm they own or
        have permission to edit anything they upload (see our{" "}
        <Link href="/terms" className="underline hover:text-foreground">
          Terms of Service
        </Link>
        ).
      </P>

      <H2>1. Reporting suspected infringement</H2>
      <P>
        If you are a copyright owner, or authorized to act on one&apos;s
        behalf, and believe WipeClip.co has been used to infringe your work,
        send a notice to our designated agent below. To be effective, your
        notice should include, consistent with 17 U.S.C. § 512(c)(3):
      </P>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted">
        <li>a physical or electronic signature of the copyright owner or an authorized agent;</li>
        <li>identification of the copyrighted work claimed to have been infringed;</li>
        <li>identification of the material you claim is infringing, with enough detail for us to locate it;</li>
        <li>your contact information — address, phone number, and email;</li>
        <li>
          a statement that you have a good-faith belief the use is not
          authorized by the copyright owner, its agent, or the law; and
        </li>
        <li>
          a statement, under penalty of perjury, that the information in the
          notice is accurate and that you are authorized to act on the
          copyright owner&apos;s behalf.
        </li>
      </ul>

      <H2>2. Designated agent</H2>
      <P>
        [Insert designated DMCA agent name, mailing address, phone, and email
        here — and register the agent with the U.S. Copyright Office before
        launch if you intend to rely on DMCA safe-harbor protection.]
      </P>
      <P>
        Until then, reports can be sent to{" "}
        <a href="mailto:legal@wipeclip.co" className="underline hover:text-foreground">
          legal@wipeclip.co
        </a>
        .
      </P>

      <H2>3. Counter-notice</H2>
      <P>
        If you believe content or access was removed or disabled by mistake
        or misidentification, you may send a counter-notice with: your
        signature, identification of the material and its location before
        removal, a statement under penalty of perjury that you have a
        good-faith belief the material was removed in error, and your
        consent to the jurisdiction of the federal court in your district (or
        our jurisdiction if you are outside the U.S.).
      </P>

      <H2>4. Repeat infringers</H2>
      <P>
        We will terminate, in appropriate circumstances, the access of users
        who are determined to be repeat infringers.
      </P>
      </main>
      <Footer />
    </div>
  );
}
