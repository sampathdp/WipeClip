"use client";

import { createContext, useCallback, useContext } from "react";
import enClient from "./locales/en-client";
import { localeHref, type Lang } from "@/lib/i18n";
import type { ClientMessages } from "./types";

type I18n = { lang: Lang; t: ClientMessages };

// English is the default, so components outside a translated page (the
// desktop app, the English pages) need no provider.
const I18nContext = createContext<I18n>({ lang: "en", t: enClient });

/** Gives client components the current language's strings. Only the
 * translated route tree renders it; the messages travel once per page. */
export function I18nProvider({ lang, messages, children }: { lang: Lang; messages: ClientMessages; children: React.ReactNode }) {
  return <I18nContext.Provider value={{ lang, t: messages }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}

/** A server error's message: the server's own English text on English
 * pages, the translation for its code elsewhere when there is one. */
export function useErrorText(): (e: { message: string; code?: string }) => string {
  const { lang, t } = useI18n();
  return useCallback(
    (e: { message: string; code?: string }) => (lang !== "en" && e.code && t.tool.errors[e.code]) || e.message,
    [lang, t],
  );
}

/** Maps an English internal path to the current language's version. */
export function useLocaleHref(): (href: string) => string {
  const { lang } = useI18n();
  return useCallback((href: string) => localeHref(lang, href), [lang]);
}
