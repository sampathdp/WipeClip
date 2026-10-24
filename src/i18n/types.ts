import type en from "./locales/en";
import type enLegal from "./locales/en-legal";

/** Every language's dictionary has the English one's shape. */
export type Dict = typeof en;
export type ClientMessages = Dict["client"];
export type LegalDict = typeof enLegal;

/** One block of a legal page. Text supports [label](/path) links and
 * **bold**; `box` is a highlighted contact card. `ai` shows the block only
 * while the AI cleanup feature is on (true) or off (false). */
export type LegalBlock = ({ h: string } | { p: string } | { ul: string[] } | { box: string[] }) & { ai?: boolean };
