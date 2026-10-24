import type { Metadata } from "next";
import LegalView, { legalMetadata } from "@/views/legal";
import { pageLang } from "@/i18n/route";

export async function generateMetadata({ params }: PageProps<"/[lang]/dmca">): Promise<Metadata> {
  return legalMetadata("dmca", await pageLang(params));
}

export default async function Page({ params }: PageProps<"/[lang]/dmca">) {
  return <LegalView page="dmca" lang={await pageLang(params)} />;
}
