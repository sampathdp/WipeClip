import Link from "next/link";
import Logo from "./Logo";
import { AI_CLEANUP_ENABLED } from "@/lib/features";
import { LANG_INFO, LANGS, localeHref, type Lang } from "@/lib/i18n";
import { GUIDES } from "@/lib/site-pages";
import { getDict } from "@/i18n";
import { rich } from "@/i18n/rich";

export default function Footer({ lang = "en" }: { lang?: Lang }) {
  const d = getDict(lang);
  const t = d.footer;
  const tools = d.client.toolNames;
  const href = (path: string) => localeHref(lang, path);
  return (
    <footer className="py-10">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Logo size={28} textSize="text-sm" />
            <span className="text-xs text-muted">&copy; {new Date().getFullYear()}</span>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
            <Link href={href("/download")} className="transition-colors hover:text-foreground">
              {t.download}
            </Link>
            <Link href={href("/about")} className="transition-colors hover:text-foreground">
              {t.about}
            </Link>
            <Link href={href("/feedback")} className="transition-colors hover:text-foreground">
              {t.feedback}
            </Link>
            <Link href={href("/privacy")} className="transition-colors hover:text-foreground">
              {t.privacy}
            </Link>
            <Link href={href("/terms")} className="transition-colors hover:text-foreground">
              {t.terms}
            </Link>
            <Link href={href("/refund-policy")} className="transition-colors hover:text-foreground">
              {t.refund}
            </Link>
            <Link href={href("/dmca")} className="transition-colors hover:text-foreground">
              {t.dmca}
            </Link>
          </nav>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-border/60 pt-6 text-xs text-muted">
          <span className="font-semibold text-foreground/80">{t.freeTools}</span>
          <Link href={href("/remove-background")} className="transition-colors hover:text-foreground">
            {tools.removeBackground}
          </Link>
          <span className="text-border">&middot;</span>
          <Link href={href("/extract-video-frame")} className="transition-colors hover:text-foreground">
            {tools.frameGrabber}
          </Link>
          <span className="text-border">&middot;</span>
          <Link href={href("/sharpen-image")} className="transition-colors hover:text-foreground">
            {tools.sharpen}
          </Link>
          {AI_CLEANUP_ENABLED && (
            <>
              <span className="text-border">&middot;</span>
              <Link href="/image-cleanup" className="transition-colors hover:text-foreground">
                Image Cleanup
              </Link>
            </>
          )}
          <span className="text-border">&middot;</span>
          <Link href={href("/tools")} className="font-semibold transition-colors hover:text-foreground">
            {t.allTools}
          </Link>
          <span className="text-border">&middot;</span>
          <Link href="/whats-new" className="transition-colors hover:text-foreground">
            {t.whatsNew}
          </Link>
          {GUIDES.length > 0 && (
            <>
              <span className="text-border">&middot;</span>
              <Link href="/guides" className="transition-colors hover:text-foreground">
                {t.guides}
              </Link>
            </>
          )}
          <span className="ml-auto flex flex-wrap gap-x-2">
            {LANGS.filter((l) => l !== lang).map((l) => (
              <Link key={l} href={localeHref(l, "/")} hrefLang={l} lang={l} className="transition-colors hover:text-foreground">
                {LANG_INFO[l].name}
              </Link>
            ))}
          </span>
        </div>
        <p className="mt-4 text-xs text-muted">
          {rich(t.disclaimer, {
            terms: (
              <Link href={href("/terms")} className="underline hover:text-foreground">
                {t.termsLink}
              </Link>
            ),
          })}
        </p>
      </div>
    </footer>
  );
}
