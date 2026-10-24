import type { Metadata } from "next";
import { accountMetadata, ReferralsView } from "@/views/account";
import { pageLang } from "@/i18n/route";

export async function generateMetadata({ params }: PageProps<"/[lang]/referrals">): Promise<Metadata> {
  return accountMetadata("referrals", await pageLang(params));
}

export default async function Page({ params }: PageProps<"/[lang]/referrals">) {
  return <ReferralsView lang={await pageLang(params)} />;
}
