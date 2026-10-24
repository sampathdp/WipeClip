/** Fills {name} placeholders: fmt("{n} credits", { n: 3 }) -> "3 credits". */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}
