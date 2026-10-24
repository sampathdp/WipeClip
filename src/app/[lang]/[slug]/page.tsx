import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LocalizedPage from "@/components/LocalizedPage";
import { buildPageMetadata } from "@/lib/seo";
import { isLocale, LOCALES, localizedPath } from "@/lib/i18n";
import { PAGES } from "@/lib/i18n-content";

export const dynamicParams = false;

export function generateStaticParams() {
  return LOCALES.flatMap((lang) =>
    Object.keys(PAGES[lang])
      .filter(Boolean)
      .map((slug) => ({ lang, slug })),
  );
}

function find(lang: string, slug: string) {
  return isLocale(lang) && slug ? PAGES[lang][slug] : undefined;
}

export async function generateMetadata({ params }: PageProps<"/[lang]/[slug]">): Promise<Metadata> {
  const { lang, slug } = await params;
  const page = find(lang, slug);
  if (!page || !isLocale(lang)) return {};
  return buildPageMetadata({
    title: page.title,
    description: page.description,
    path: localizedPath(lang, slug),
    locale: lang,
  });
}

export default async function Page({ params }: PageProps<"/[lang]/[slug]">) {
  const { lang, slug } = await params;
  const page = find(lang, slug);
  if (!page || !isLocale(lang)) notFound();
  return <LocalizedPage locale={lang} page={page} />;
}
