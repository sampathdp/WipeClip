/** Site languages. English stays at the root with no prefix; every other
 * language mirrors the same pages under /<locale> with the same slugs
 * (/fr/pricing, /de/remove-background). */

export const LOCALES = ["de", "fr", "es", "it", "nl", "pl"] as const;
export type Locale = (typeof LOCALES)[number];

/** English plus every translated language. */
export const LANGS = ["en", ...LOCALES] as const;
export type Lang = (typeof LANGS)[number];

export const LANG_INFO: Record<Lang, { name: string; ogLocale: string }> = {
  en: { name: "English", ogLocale: "en_US" },
  de: { name: "Deutsch", ogLocale: "de_DE" },
  fr: { name: "Français", ogLocale: "fr_FR" },
  es: { name: "Español", ogLocale: "es_ES" },
  it: { name: "Italiano", ogLocale: "it_IT" },
  nl: { name: "Nederlands", ogLocale: "nl_NL" },
  pl: { name: "Polski", ogLocale: "pl_PL" },
};

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/** Pages that exist in every language. Anything else (admin, auth, API,
 * the switched-off AI cleanup pages) stays English-only at its one path. */
export const LOCALIZED_PATHS = [
  "/",
  "/download",
  "/about",
  "/pricing",
  "/tools",
  "/remove-background",
  "/sharpen-image",
  "/extract-video-frame",
  "/feedback",
  "/privacy",
  "/terms",
  "/refund-policy",
  "/dmca",
  "/sign-in",
  "/profile",
  "/history",
  "/referrals",
  "/welcome",
] as const;

function isLocalizedPath(path: string): boolean {
  return (LOCALIZED_PATHS as readonly string[]).includes(path);
}

/** The language a pathname is in, from its first segment. */
export function langOf(pathname: string): Lang {
  const first = pathname.split("/")[1] ?? "";
  return isLocale(first) ? first : "en";
}

/** A pathname without its language prefix: /fr/pricing -> /pricing. */
export function stripLang(pathname: string): string {
  const lang = langOf(pathname);
  if (lang === "en") return pathname || "/";
  return pathname.slice(lang.length + 1) || "/";
}

/** An internal link in the given language: /pricing -> /fr/pricing,
 * /#faq -> /fr#faq. Untranslated pages and external URLs pass through. */
export function localeHref(lang: Lang, href: string): string {
  if (lang === "en" || !href.startsWith("/")) return href;
  const cut = href.search(/[?#]/);
  const path = cut === -1 ? href : href.slice(0, cut);
  const rest = cut === -1 ? "" : href.slice(cut);
  if (!isLocalizedPath(path)) return href;
  return (path === "/" ? `/${lang}` : `/${lang}${path}`) + rest;
}

/** hreflang map for an English path that exists in every language. */
export function languageAlternates(enPath: string): Record<string, string> | undefined {
  if (!isLocalizedPath(enPath)) return undefined;
  const languages: Record<string, string> = { "x-default": enPath };
  for (const l of LANGS) languages[l] = localeHref(l, enPath);
  return languages;
}

/** The first translated pages used their own slugs per language. They now
 * live at the English slug; next.config redirects the old URLs. */
export const LEGACY_SLUGS: Record<string, Record<Locale, string>> = {
  "/remove-background": {
    de: "hintergrund-entfernen",
    fr: "supprimer-arriere-plan",
    es: "quitar-fondo",
    it: "rimuovere-sfondo",
    nl: "achtergrond-verwijderen",
    pl: "usun-tlo",
  },
  "/sharpen-image": {
    de: "bild-schaerfen",
    fr: "rendre-photo-nette",
    es: "enfocar-foto",
    it: "rendere-nitida-foto",
    nl: "foto-verscherpen",
    pl: "wyostrz-zdjecie",
  },
  "/extract-video-frame": {
    de: "standbild-aus-video",
    fr: "extraire-image-video",
    es: "extraer-fotograma-video",
    it: "estrarre-fotogramma-video",
    nl: "frame-uit-video-halen",
    pl: "wyodrebnij-klatke-z-wideo",
  },
};
