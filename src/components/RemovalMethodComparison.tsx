import Link from "next/link";

type Cell = { value: string; positive?: boolean; negative?: boolean };

const methods = ["Crop", "Blur", "Cover", "AI reconstruction"] as const;

const rows: { label: string; cells: Cell[] }[] = [
  {
    label: "Preserves frame dimensions",
    cells: [
      { value: "No — cuts into the frame", negative: true },
      { value: "Yes", positive: true },
      { value: "Yes", positive: true },
      { value: "Yes", positive: true },
    ],
  },
  {
    label: "Leaves a visible patch",
    cells: [
      { value: "No patch, but permanently loses that part of the frame", negative: true },
      { value: "Yes — an obvious blurred box", negative: true },
      { value: "Yes — a solid block", negative: true },
      { value: "Usually less visible, but not guaranteed" },
    ],
  },
  {
    label: "Works on a moving overlay",
    cells: [
      { value: "No", negative: true },
      { value: "Poor — needs a fixed box", negative: true },
      { value: "Poor — needs a fixed box", negative: true },
      { value: "Yes — tracks the marked region", positive: true },
    ],
  },
  {
    label: "Setup effort",
    cells: [
      { value: "Low", positive: true },
      { value: "Low", positive: true },
      { value: "Low", positive: true },
      { value: "Low — mark once", positive: true },
    ],
  },
  {
    label: "Difficult, busy backgrounds",
    cells: [
      { value: "Unaffected — the area is just removed" },
      { value: "Unaffected, but still visibly blurred" },
      { value: "Unaffected, but still visibly blocked" },
      { value: "Can struggle — depends on nearby detail to rebuild from", negative: true },
    ],
  },
];

export default function RemovalMethodComparison() {
  return (
    <section id="comparison" className="scroll-mt-28 py-24 relative">
      <div className="mx-auto max-w-5xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-surface-2/90 border border-border px-3.5 py-1 text-xs font-semibold text-muted">
            AI Reconstruction vs Blur vs Crop
          </div>
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
            How the four approaches compare
          </h2>
          <p className="mt-4 text-muted text-base leading-relaxed">
            No single method wins on every measure — reconstruction trades a visible patch for
            depending on how much surrounding detail there is to work with.
          </p>
        </div>

        <div className="mt-12 overflow-x-auto rounded-[1.75rem] border border-border/80">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <caption className="sr-only">
              Comparison of crop, blur, cover, and AI reconstruction for removing a video overlay
            </caption>
            <thead>
              <tr className="bg-surface-2/80">
                <th scope="col" className="p-4 font-display text-sm font-bold text-foreground">
                  Method
                </th>
                {methods.map((m) => (
                  <th
                    key={m}
                    scope="col"
                    className={`p-4 font-display text-sm font-bold ${
                      m === "AI reconstruction" ? "text-cyan-600" : "text-foreground"
                    }`}
                  >
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.label} className={i % 2 === 0 ? "bg-transparent" : "bg-surface-2/30"}>
                  <th
                    scope="row"
                    className="p-4 align-top font-semibold text-foreground border-t border-border/60"
                  >
                    {row.label}
                  </th>
                  {row.cells.map((cell, j) => (
                    <td
                      key={j}
                      className={`p-4 align-top border-t border-border/60 text-muted ${
                        cell.positive ? "text-emerald-600" : cell.negative ? "text-rose-600" : ""
                      }`}
                    >
                      {cell.value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-6 text-center text-sm text-muted">
          <Link href="/guides/ai-inpainting-vs-blur-vs-crop" className="underline hover:text-foreground text-cyan-600">
            Read the full comparison guide
          </Link>
        </p>
      </div>
    </section>
  );
}
