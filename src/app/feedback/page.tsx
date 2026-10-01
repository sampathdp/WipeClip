import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { buildPageMetadata } from "@/lib/seo";
import FeedbackClient, { type FeedbackItem } from "./FeedbackClient";

export const metadata: Metadata = buildPageMetadata({
  title: "Feedback & Bug Reports",
  description:
    "Report a bug, request a feature, or tell us what you think of WipeClip.co. Signed-in users can track the status of everything they've sent.",
  path: "/feedback",
});

export default async function FeedbackPage() {
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
            Feedback &amp; <span className="text-gradient">bug reports</span>
          </h1>
          <p className="mt-3 text-sm sm:text-base text-muted">
            Something broke, a result looked wrong, or there&apos;s a feature you wish we had? Tell
            us here. Every message is read by a person.
          </p>

          <FeedbackClient signedInEmail={signedInEmail} initialItems={items} />
        </div>
      </main>
      <Footer />
    </div>
  );
}
