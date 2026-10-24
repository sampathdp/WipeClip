import { notFound } from "next/navigation";
import InlineScript from "@/components/InlineScript";
import { I18nProvider } from "@/i18n/client";
import { getDict } from "@/i18n";
import { isLocale, LOCALES } from "@/lib/i18n";

// Only the listed languages exist; anything else at /<x> is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

/** Every translated page: the same pages as the English root, with this
 * language's strings for the client components inside them. */
export default async function LangLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return (
    <I18nProvider lang={lang} messages={getDict(lang).client}>
      {/* The root layout renders <html lang="en">; correct it on a full load. */}
      <InlineScript html={`document.documentElement.lang=${JSON.stringify(lang)};`} />
      {children}
    </I18nProvider>
  );
}
