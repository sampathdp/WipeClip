import type { Metadata } from "next";
import ToolView, { toolMetadata } from "@/views/tool";
import { pageLang } from "@/i18n/route";

export async function generateMetadata({ params }: PageProps<"/[lang]/extract-video-frame">): Promise<Metadata> {
  return toolMetadata("extractVideoFrame", await pageLang(params));
}

export default async function Page({ params }: PageProps<"/[lang]/extract-video-frame">) {
  return <ToolView tool="extractVideoFrame" lang={await pageLang(params)} />;
}
