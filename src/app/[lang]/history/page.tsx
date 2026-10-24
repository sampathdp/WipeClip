import type { Metadata } from "next";
import { accountMetadata, HistoryView } from "@/views/account";
import { pageLang } from "@/i18n/route";

export async function generateMetadata({ params }: PageProps<"/[lang]/history">): Promise<Metadata> {
  return accountMetadata("history", await pageLang(params));
}

export default async function Page({ params }: PageProps<"/[lang]/history">) {
  return <HistoryView lang={await pageLang(params)} />;
}
