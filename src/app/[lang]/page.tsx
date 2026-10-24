import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LocalizedPage from "@/components/LocalizedPage";
import { buildPageMetadata } from "@/lib/seo";
import { isLocale, LOCALES, localizedPath } from "@/lib/i18n";
import { PAGES } from "@/lib/i18n-content";

// Only the listed languages exist; anything else at /<x> is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: PageProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const page = PAGES[lang][""];
  return buildPageMetadata({
    title: page.title,
    description: page.description,
    path: localizedPath(lang, ""),
    locale: lang,
  });
}

export default async function Page({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return <LocalizedPage locale={lang} page={PAGES[lang][""]} />;
}
