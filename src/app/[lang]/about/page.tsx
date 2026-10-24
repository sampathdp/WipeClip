import type { Metadata } from "next";
import AboutView, { aboutMetadata } from "@/views/about";
import { pageLang } from "@/i18n/route";

export async function generateMetadata({ params }: PageProps<"/[lang]/about">): Promise<Metadata> {
  return aboutMetadata(await pageLang(params));
}

export default async function Page({ params }: PageProps<"/[lang]/about">) {
  return <AboutView lang={await pageLang(params)} />;
}
