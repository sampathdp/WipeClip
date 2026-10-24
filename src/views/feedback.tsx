import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FeedbackClient, { type FeedbackItem } from "@/app/feedback/FeedbackClient";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { buildPageMetadata } from "@/lib/seo";
import type { Lang } from "@/lib/i18n";
import { getDict } from "@/i18n";

export function feedbackMetadata(lang: Lang): Metadata {
  const t = getDict(lang).feedbackPage;
  return buildPageMetadata({ title: t.title, description: t.description, path: "/feedback", lang });
}

export default async function FeedbackView({ lang }: { lang: Lang }) {
  const t = getDict(lang).feedbackPage;
  let signedInEmail: string | null = null;
  let items: FeedbackItem[] = [];

  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      signedInEmail = user.email ?? null;
      // RLS ("read own feedback") limits this to the caller's own rows.
      const { data } = await supabase
        .from("feedback")
        .select("id, kind, subject, message, status, admin_reply, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      items = (data ?? []) as FeedbackItem[];
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <Navbar />
      <main className="flex-1 pt-32 pb-20">
        <div className="mx-auto max-w-3xl px-6">
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
            {t.h1}
            <span className="text-gradient">{t.h1Highlight}</span>
          </h1>
          <p className="mt-3 text-sm sm:text-base text-muted">{t.intro}</p>

          <FeedbackClient signedInEmail={signedInEmail} initialItems={items} />
        </div>
      </main>
      <Footer lang={lang} />
    </div>
  );
}
