import type { Metadata } from "next";
import { accountMetadata, ProfileView } from "@/views/account";
import { pageLang } from "@/i18n/route";

export async function generateMetadata({ params }: PageProps<"/[lang]/profile">): Promise<Metadata> {
  return accountMetadata("profile", await pageLang(params));
}

export default async function Page({ params }: PageProps<"/[lang]/profile">) {
  return <ProfileView lang={await pageLang(params)} />;
}
