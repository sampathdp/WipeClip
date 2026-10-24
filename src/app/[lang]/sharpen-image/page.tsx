import type { Metadata } from "next";
import ToolView, { toolMetadata } from "@/views/tool";
import { pageLang } from "@/i18n/route";

export async function generateMetadata({ params }: PageProps<"/[lang]/sharpen-image">): Promise<Metadata> {
  return toolMetadata("sharpenImage", await pageLang(params));
}

export default async function Page({ params }: PageProps<"/[lang]/sharpen-image">) {
  return <ToolView tool="sharpenImage" lang={await pageLang(params)} />;
}
