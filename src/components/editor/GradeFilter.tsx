import { Fragment } from "react";
import { gradeOf, matrixValues, transferTable } from "@/lib/editor/look";
import type { Look } from "@/lib/editor/types";

/** SVG version of look.ts's grade: transfer -> matrix -> transfer -> matrix,
 * in sRGB (matching the 3D LUT the export bakes from the same math), plus a
 * sharpen kernel. Render inside an <svg><defs>; reference as url(#id). */
export default function GradeFilter({ id, look }: { id: string; look: Look }) {
  const g = gradeOf(look);
  const a = g.sharpness * 0.6;
  return (
    <filter id={id} colorInterpolationFilters="sRGB">
      {g.stages.map((st, i) => (
        <Fragment key={i}>
          <feComponentTransfer>
            <feFuncR type="table" tableValues={transferTable(st.t, 0)} />
            <feFuncG type="table" tableValues={transferTable(st.t, 1)} />
            <feFuncB type="table" tableValues={transferTable(st.t, 2)} />
          </feComponentTransfer>
          <feColorMatrix type="matrix" values={matrixValues(st.m)} />
        </Fragment>
      ))}
      {a > 0 && <feConvolveMatrix order="3" preserveAlpha="true" kernelMatrix={`0 ${-a} 0 ${-a} ${1 + 4 * a} ${-a} 0 ${-a} 0`} />}
    </filter>
  );
}
