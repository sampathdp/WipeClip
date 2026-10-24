import type { Metadata } from "next";
import HomeView, { homeMetadata } from "@/views/home";
import { pageLang } from "@/i18n/route";

export async function generateMetadata({ params }: PageProps<"/[lang]">): Promise<Metadata> {
  return homeMetadata(await pageLang(params));
}

export default async function Page({ params }: PageProps<"/[lang]">) {
  return <HomeView lang={await pageLang(params)} />;
}
