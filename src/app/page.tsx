import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import UploadDemo from "@/components/UploadDemo";
import HowItWorks from "@/components/HowItWorks";
import Features from "@/components/Features";
import Faq from "@/components/Faq";
import CtaBanner from "@/components/CtaBanner";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <section className="px-6">
          <UploadDemo />
        </section>
        <HowItWorks />
        <Features />
        <Faq />
        <CtaBanner />
      </main>
      <Footer />
    </div>
  );
}
