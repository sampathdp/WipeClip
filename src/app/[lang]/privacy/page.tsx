import type { Metadata } from "next";
import LegalView, { legalMetadata } from "@/views/legal";
import { pageLang } from "@/i18n/route";

export async function generateMetadata({ params }: PageProps<"/[lang]/privacy">): Promise<Metadata> {
  return legalMetadata("privacy", await pageLang(params));
}

export default async function Page({ params }: PageProps<"/[lang]/privacy">) {
  return <LegalView page="privacy" lang={await pageLang(params)} />;
}
