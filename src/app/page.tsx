import type { Metadata } from "next";
import HomeView from "@/views/home";
import { languageAlternates } from "@/lib/i18n";

// Title, description and social cards come from the root layout.
export const metadata: Metadata = {
  alternates: { canonical: "/", languages: languageAlternates("/") },
};

export default function Home() {
  return <HomeView lang="en" />;
}
