import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@/lib/i18n";

/** The language of a /[lang]/... route, or a 404 for anything else. */
export async function pageLang(params: Promise<{ lang: string }>): Promise<Locale> {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return lang;
}
