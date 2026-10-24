import type { Metadata } from "next";
import LegalView, { legalMetadata } from "@/views/legal";
import { pageLang } from "@/i18n/route";

export async function generateMetadata({ params }: PageProps<"/[lang]/refund-policy">): Promise<Metadata> {
  return legalMetadata("refund", await pageLang(params));
}

export default async function Page({ params }: PageProps<"/[lang]/refund-policy">) {
  return <LegalView page="refund" lang={await pageLang(params)} />;
}
