import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import FreeToolsBanner from "@/components/FreeToolsBanner";
import Hero from "@/components/Hero";
import UploadDemo from "@/components/UploadDemo";
import HowItWorks from "@/components/HowItWorks";
import WhyWipeClip from "@/components/WhyWipeClip";
import DesktopPromo from "@/components/DesktopPromo";
import FreeTools from "@/components/FreeTools";
import Faq from "@/components/Faq";
import CtaBanner from "@/components/CtaBanner";
import Footer from "@/components/Footer";
import WelcomeModal from "@/components/WelcomeModal";
import { AI_CLEANUP_ENABLED } from "@/lib/features";
import type { Lang } from "@/lib/i18n";
import { buildPageMetadata } from "@/lib/seo";
import { getDict } from "@/i18n";

/** English keeps the root layout's own homepage metadata; translations get
 * their own title, description and hreflang links. */
export function homeMetadata(lang: Lang): Metadata {
  const t = getDict(lang).meta.home;
  return buildPageMetadata({ title: t.title, description: t.description, path: "/", lang });
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
