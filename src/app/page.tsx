import Navbar from "@/components/Navbar";
import FreeToolsBanner from "@/components/FreeToolsBanner";
import Hero from "@/components/Hero";
import UploadDemo from "@/components/UploadDemo";
import WhatWipeClipDoes from "@/components/WhatWipeClipDoes";
import EditorPromo from "@/components/EditorPromo";
import HowItWorks from "@/components/HowItWorks";
import StaticVsMovingWatermarks from "@/components/StaticVsMovingWatermarks";
import RemovalMethodComparison from "@/components/RemovalMethodComparison";
import SupportedSituations from "@/components/SupportedSituations";
import EvidenceSection from "@/components/EvidenceSection";
import LimitationsSection from "@/components/LimitationsSection";
import PrivacyProcessing from "@/components/PrivacyProcessing";
import RelatedContent from "@/components/RelatedContent";
import FreeTools from "@/components/FreeTools";
import Faq from "@/components/Faq";
import CtaBanner from "@/components/CtaBanner";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <Navbar />
      <FreeToolsBanner />
      <main className="flex-1">
        <Hero />
        <section className="px-6">
          <UploadDemo />
        </section>
        <WhatWipeClipDoes />
        <EditorPromo />
        <HowItWorks includeSchema />
        <StaticVsMovingWatermarks />
        <RemovalMethodComparison />
        <SupportedSituations />
        <EvidenceSection />
        <LimitationsSection />
        <PrivacyProcessing />
        <RelatedContent />
        <FreeTools />
        <Faq />
        <CtaBanner />
      </main>
      <Footer />
    </div>
  );
}
