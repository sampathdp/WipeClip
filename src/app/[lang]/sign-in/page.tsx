import type { Metadata } from "next";
import { accountMetadata, SignInView } from "@/views/account";
import { pageLang } from "@/i18n/route";

export async function generateMetadata({ params }: PageProps<"/[lang]/sign-in">): Promise<Metadata> {
  return accountMetadata("signIn", await pageLang(params));
}

export default async function Page({ params }: PageProps<"/[lang]/sign-in">) {
  return <SignInView lang={await pageLang(params)} />;
}
