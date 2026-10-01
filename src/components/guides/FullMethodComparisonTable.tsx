type Cell = { value: string; positive?: boolean; negative?: boolean };

const methods = ["Crop", "Blur", "Cover", "AI reconstruction"] as const;

const rows: { label: string; cells: Cell[] }[] = [
  {
    label: "Frame dimensions",
    cells: [
      { value: "Changed: cuts into the frame", negative: true },
      { value: "Preserved", positive: true },
      { value: "Preserved", positive: true },
      { value: "Preserved", positive: true },
    ],
  },
  {
    label: "Visible artifacts",
    cells: [
      { value: "No patch, but a permanent gap in the frame", negative: true },
      { value: "Obvious blurred box", negative: true },
      { value: "Obvious solid block", negative: true },
      { value: "Usually less visible, not guaranteed" },
    ],
  },
  {
    label: "Moving overlays",
    cells: [
      { value: "Doesn't track motion", negative: true },
      { value: "Needs a box re-drawn per frame", negative: true },
      { value: "Needs a box re-drawn per frame", negative: true },
      { value: "Tracks the region across frames", positive: true },
    ],
  },
  {
    label: "Static overlays",
    cells: [
      { value: "Works if the region is expendable" },
      { value: "Works, patch stays visible" },
      { value: "Works, patch stays visible" },
      { value: "Works well: a fixed, predictable region", positive: true },
    ],
  },
  {
    label: "Complex backgrounds",
    cells: [
      { value: "Unaffected: the area is just removed" },
      { value: "Unaffected, but still visibly blurred" },
      { value: "Unaffected, but still visibly blocked" },
      { value: "Can struggle: depends on nearby detail", negative: true },
    ],
  },
  {
    label: "Processing requirements",
    cells: [
      { value: "Minimal: basic video editing", positive: true },
      { value: "Minimal: basic video editing", positive: true },
      { value: "Minimal: basic video editing", positive: true },
      { value: "Higher: server-side reconstruction, takes measurable time", negative: true },
    ],
  },
  {
    label: "Typical failure case",
    cells: [
      { value: "Mark is large or moves: too much frame lost" },
      { value: "Mark is large or moves: stays partly visible" },
      { value: "Same as blur, and more visually intrusive" },
      { value: "Too little surrounding detail to rebuild from" },
    ],
  },
];

export default function FullMethodComparisonTable() {
  return (
    <div className="overflow-x-auto rounded-[1.75rem] border border-border/80">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <caption className="sr-only">
          Comparison of crop, blur, cover, and AI reconstruction for removing video overlays
        </caption>
        <thead>
          <tr className="bg-surface-2/80">
            <th scope="col" className="p-4 font-display text-sm font-bold text-foreground">
              Criteria
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
            <tr key={row.label} className={i % 2 === 0 ? "" : "bg-surface-2/30"}>
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
  );
}
