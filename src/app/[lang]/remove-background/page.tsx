import type { Metadata } from "next";
import ToolView, { toolMetadata } from "@/views/tool";
import { pageLang } from "@/i18n/route";

export async function generateMetadata({ params }: PageProps<"/[lang]/remove-background">): Promise<Metadata> {
  return toolMetadata("removeBackground", await pageLang(params));
}

export default async function Page({ params }: PageProps<"/[lang]/remove-background">) {
  return <ToolView tool="removeBackground" lang={await pageLang(params)} />;
}
