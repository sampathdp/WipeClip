import type { Metadata } from "next";
import DownloadView, { downloadMetadata } from "@/views/download";
import { pageLang } from "@/i18n/route";

export async function generateMetadata({ params }: PageProps<"/[lang]/download">): Promise<Metadata> {
  return downloadMetadata(await pageLang(params));
}

export default async function Page({ params }: PageProps<"/[lang]/download">) {
  return <DownloadView lang={await pageLang(params)} />;
}
