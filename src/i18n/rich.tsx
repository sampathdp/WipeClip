import { Fragment } from "react";

/** fmt() for sentences with markup inside: rich("See our {terms}.", { terms: <Link …/> }).
 * Placeholders without a value are left as written. */
export function rich(template: string, vars: Record<string, React.ReactNode>): React.ReactNode {
  return template.split(/(\{\w+\})/).map((part, i) => {
    const key = part.match(/^\{(\w+)\}$/)?.[1];
    return <Fragment key={i}>{key && key in vars ? vars[key] : part}</Fragment>;
  });
}
