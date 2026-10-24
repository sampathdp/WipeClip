import type { Metadata } from "next";
import ToolsView, { toolsMetadata } from "@/views/tools";
import { pageLang } from "@/i18n/route";

export async function generateMetadata({ params }: PageProps<"/[lang]/tools">): Promise<Metadata> {
  return toolsMetadata(await pageLang(params));
}

export default async function Page({ params }: PageProps<"/[lang]/tools">) {
  return <ToolsView lang={await pageLang(params)} />;
}
