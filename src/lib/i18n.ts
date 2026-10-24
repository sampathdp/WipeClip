/** Translated landing pages for European visitors. English stays at the
 * root with no prefix; each other language lives under /<locale> with its
 * own slugs, since people search in their own words ("hintergrund
 * entfernen", not "remove background"). */

export const LOCALES = ["de", "fr", "es"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_INFO: Record<Locale, { name: string; ogLocale: string }> = {
  de: { name: "Deutsch", ogLocale: "de_DE" },
  fr: { name: "Français", ogLocale: "fr_FR" },
  es: { name: "Español", ogLocale: "es_ES" },
};

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/** English path -> its slug in each language. An empty slug is the
 * language's index page (/de, /fr). */
export const TRANSLATED_PATHS: Record<string, Record<Locale, string>> = {
  "/download": { de: "", fr: "", es: "" },
  "/remove-background": { de: "hintergrund-entfernen", fr: "supprimer-arriere-plan", es: "quitar-fondo" },
  "/sharpen-image": { de: "bild-schaerfen", fr: "rendre-photo-nette", es: "enfocar-foto" },
  "/extract-video-frame": { de: "standbild-aus-video", fr: "extraire-image-video", es: "extraer-fotograma-video" },
};

export function localizedPath(locale: Locale, slug: string): string {
  return slug ? `/${locale}/${slug}` : `/${locale}`;
}

/** hreflang map for a page that exists in several languages, keyed by any
 * of its versions' paths. Undefined for English-only pages. */
export function languageAlternates(path: string): Record<string, string> | undefined {
  for (const [enPath, slugs] of Object.entries(TRANSLATED_PATHS)) {
    const versions = LOCALES.map((l) => localizedPath(l, slugs[l]));
    if (enPath !== path && !versions.includes(path)) continue;
    const languages: Record<string, string> = { en: enPath, "x-default": enPath };
    LOCALES.forEach((l, i) => (languages[l] = versions[i]));
    return languages;
  }
  return undefined;
}
