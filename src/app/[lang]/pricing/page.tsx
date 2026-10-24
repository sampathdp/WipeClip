import type { Metadata } from "next";
import PricingView, { pricingMetadata } from "@/views/pricing";
import { pageLang } from "@/i18n/route";

export async function generateMetadata({ params }: PageProps<"/[lang]/pricing">): Promise<Metadata> {
  return pricingMetadata(await pageLang(params));
}

export default async function Page({ params }: PageProps<"/[lang]/pricing">) {
  return <PricingView lang={await pageLang(params)} />;
}
