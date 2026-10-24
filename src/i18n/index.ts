import type { Lang } from "@/lib/i18n";
import { AI_CLEANUP_ENABLED } from "@/lib/features";
import type { Dict, LegalDict } from "./types";
import en from "./locales/en";
import de from "./locales/de";
import fr from "./locales/fr";
import es from "./locales/es";
import it from "./locales/it";
import nl from "./locales/nl";
import pl from "./locales/pl";
import enLegal from "./locales/en-legal";
import deLegal from "./locales/de-legal";
import frLegal from "./locales/fr-legal";
import esLegal from "./locales/es-legal";
import itLegal from "./locales/it-legal";
import nlLegal from "./locales/nl-legal";
import plLegal from "./locales/pl-legal";

const DICTS: Record<Lang, Dict> = { en, de, fr, es, it, nl, pl };
const LEGAL: Record<Lang, LegalDict> = { en: enLegal, de: deLegal, fr: frLegal, es: esLegal, it: itLegal, nl: nlLegal, pl: plLegal };

/** Server-side strings for a page. Client components read theirs through
 * I18nProvider (src/i18n/client.tsx). */
export function getDict(lang: Lang): Dict {
  return DICTS[lang];
}

export function getLegal(lang: Lang): LegalDict {
  return LEGAL[lang];
}

export { fmt } from "./format";

/** A tool's card title and description in this language. While AI cleanup
 * is on, the English catalog (src/lib/site-pages.ts) mentions it, so that
 * copy is used as is. */
export function toolCopy(lang: Lang, tool: { href: string; title: string; desc: string }): { title: string; desc: string } {
  if (AI_CLEANUP_ENABLED) return tool;
  return DICTS[lang].toolCatalog.items[tool.href] ?? tool;
}
