import type { Metadata } from "next";
import { accountMetadata, WelcomeView } from "@/views/account";
import { pageLang } from "@/i18n/route";

export async function generateMetadata({ params }: PageProps<"/[lang]/welcome">): Promise<Metadata> {
  return accountMetadata("welcome", await pageLang(params));
}

export default async function Page({ params }: PageProps<"/[lang]/welcome">) {
  return <WelcomeView lang={await pageLang(params)} />;
}
