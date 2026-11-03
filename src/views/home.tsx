import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import FreeToolsBanner from "@/components/FreeToolsBanner";
import Hero from "@/components/Hero";
import UploadDemo from "@/components/UploadDemo";
import HowItWorks from "@/components/HowItWorks";
import WhyWipeClip from "@/components/WhyWipeClip";
import DesktopPromo from "@/components/DesktopPromo";
import FreeTools from "@/components/FreeTools";
import FeatureTour from "@/components/FeatureTour";
import WhatsNew from "@/components/WhatsNew";
import Reveal from "@/components/Reveal";
import { FocusMock, RecorderMock, ReviewMock, TutorialFrameMock } from "@/components/download/Mockups";
import Faq from "@/components/Faq";
import CtaBanner from "@/components/CtaBanner";
import Footer from "@/components/Footer";
import WelcomeModal from "@/components/WelcomeModal";
import { AI_CLEANUP_ENABLED } from "@/lib/features";
import { localeHref, type Lang } from "@/lib/i18n";
import { buildPageMetadata } from "@/lib/seo";
import { getDict } from "@/i18n";

/** English keeps the root layout's own homepage metadata; translations get
 * their own title, description and hreflang links. */
export function homeMetadata(lang: Lang): Metadata {
  const t = getDict(lang).meta.home;
  return buildPageMetadata({ title: t.title, description: t.description, path: "/", lang });
}

const TOUR_MOCKS = {
  recorder: <RecorderMock />,
  focus: <FocusMock />,
  review: <ReviewMock />,
  tutorial: <TutorialFrameMock />,
};

/** A quick, self-playing tour of the recorder and editor's headline
 * features, reusing the /download page's copy and mockups. */
function FeatureTourSection({ lang }: { lang: Lang }) {
  const d = getDict(lang);
  const t = d.featureTour;
  const items = (Object.keys(TOUR_MOCKS) as (keyof typeof TOUR_MOCKS)[]).map((id) => ({
    id,
    ...d.downloadPage.spotlights[id],
    mock: TOUR_MOCKS[id],
  }));
  return (
    <section id="tour" className="relative scroll-mt-28 py-24">
      <div className="mx-auto max-w-7xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <div className="mb-4 inline-flex rounded-full border border-border bg-surface-2/90 px-3.5 py-1 text-xs font-semibold text-muted">
            {t.badge}
          </div>
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-foreground sm:text-5xl">
            {t.title}
            <span className="text-gradient">{t.titleHighlight}</span>
          </h2>
          <p className="mt-4 text-base text-muted">{t.intro}</p>
        </Reveal>
        <div className="mt-14">
          <FeatureTour items={items} />
        </div>
        <div className="mt-12 text-center">
          <Link href={localeHref(lang, "/download")} className="btn-secondary inline-flex rounded-full px-6 py-3 text-sm font-semibold">
            {t.seeAll} →
          </Link>
        </div>
      </div>
    </section>
  );
}

// The long-form explainers (what it does, limitations, privacy) live on /about,
// linked from WhyWipeClip and the navbar, so the homepage stays focused on
// the tool itself. The AI cleanup sections are English only.
export default function HomeView({ lang }: { lang: Lang }) {
  return (
    <div className="flex flex-1 flex-col">
      <Navbar />
      <FreeToolsBanner />
      <main className="flex-1">
        <Hero lang={lang} />
        <WhatsNew lang={lang} />
        <FeatureTourSection lang={lang} />
        <DesktopPromo lang={lang} />
        {AI_CLEANUP_ENABLED && (
          <>
            <section className="px-6">
              <UploadDemo />
            </section>
            <HowItWorks includeSchema />
            <WhyWipeClip />
          </>
        )}
        <FreeTools lang={lang} />
        <Faq lang={lang} />
        <CtaBanner lang={lang} />
      </main>
      <Footer lang={lang} />
      <WelcomeModal />
    </div>
  );
}
