import type { Metadata } from "next";
import FeedbackView, { feedbackMetadata } from "@/views/feedback";
import { pageLang } from "@/i18n/route";

export async function generateMetadata({ params }: PageProps<"/[lang]/feedback">): Promise<Metadata> {
  return feedbackMetadata(await pageLang(params));
}

export default async function Page({ params }: PageProps<"/[lang]/feedback">) {
  return <FeedbackView lang={await pageLang(params)} />;
}
