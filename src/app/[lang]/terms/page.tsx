import type { Metadata } from "next";
import LegalView, { legalMetadata } from "@/views/legal";
import { pageLang } from "@/i18n/route";

export async function generateMetadata({ params }: PageProps<"/[lang]/terms">): Promise<Metadata> {
  return legalMetadata("terms", await pageLang(params));
}

export default async function Page({ params }: PageProps<"/[lang]/terms">) {
  return <LegalView page="terms" lang={await pageLang(params)} />;
}
