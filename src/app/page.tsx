import Navbar from "@/components/Navbar";
import FreeToolsBanner from "@/components/FreeToolsBanner";
import Hero from "@/components/Hero";
import UploadDemo from "@/components/UploadDemo";
import HowItWorks from "@/components/HowItWorks";
import WhyWipeClip from "@/components/WhyWipeClip";
import EditorPromo from "@/components/EditorPromo";
import FreeTools from "@/components/FreeTools";
import Faq from "@/components/Faq";
import CtaBanner from "@/components/CtaBanner";
import Footer from "@/components/Footer";

// The long-form explainers (what it does, static vs moving overlays, method
// comparison, use cases, evidence, limitations, privacy) live on /about,
// linked from WhyWipeClip and the navbar, so the homepage stays focused on
// the tool itself.
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
        <HowItWorks includeSchema />
        <WhyWipeClip />
        <EditorPromo />
        <FreeTools />
        <Faq />
        <CtaBanner />
      </main>
      <Footer />
    </div>
  );
}
