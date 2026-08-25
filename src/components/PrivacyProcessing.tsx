import Link from "next/link";

const points = [
  "Your video is sent to our processing backend only for the duration of your request.",
  "It's held in a temporary location and deleted immediately once your result is returned. We don't keep a copy afterward.",
  "We don't use uploaded media to train any model.",
];

export default function PrivacyProcessing() {
  return (
    <section id="privacy" className="scroll-mt-28 py-24 relative">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-surface-2/90 border border-border px-3.5 py-1 text-xs font-semibold text-muted">
          Privacy &amp; Processing
        </div>
        <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
          What happens to your file
        </h2>

        <ul className="mt-10 space-y-4 text-left">
          {points.map((p) => (
            <li key={p} className="glass-card flex items-start gap-3 rounded-2xl p-5">
              <span className="mt-0.5 text-cyan-600 font-bold">✓</span>
              <span className="text-sm sm:text-base text-muted leading-relaxed">{p}</span>
            </li>
          ))}
        </ul>

        <p className="mt-6 text-xs text-muted">
          Full details in our{" "}
          <Link href="/privacy" className="underline hover:text-foreground">
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link href="/terms" className="underline hover:text-foreground">
            Terms of Service
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
