import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import CopyReferralLink from "@/components/CopyReferralLink";
import { createClient, createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Refer a Friend | WipeClip.co",
  robots: { index: false },
};

const siteUrl = "https://wipeclip.co";

export default async function ReferralsPage() {
  if (!isSupabaseConfigured()) redirect("/");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/sign-in?next=/referrals");

  const supabaseAdmin = createServiceClient();
  const { data: code } = await supabaseAdmin.rpc("ensure_referral_code", { p_user_id: user.id });
  const { data: profile } = await supabase.from("profiles").select("referred_by").eq("id", user.id).single();

  const link = `${siteUrl}/?ref=${code}`;

  return (
    <div className="flex flex-1 flex-col">
      <Navbar />
      <main className="flex-1 pt-32 pb-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
            Give <span className="text-gradient">5 credits</span>, get{" "}
            <span className="text-gradient">5 credits</span>
          </h1>
          <p className="mt-4 text-sm sm:text-base leading-relaxed text-muted">
            Share your link. When someone signs up through it, you both get 5 bonus credits — no
            limit on how many friends you refer.
          </p>

          <div className="mt-8 glass-card rounded-[1.75rem] border border-cyan-500/20 p-6 sm:p-8">
            <CopyReferralLink link={link} />
          </div>

          {profile?.referred_by && (
            <p className="mt-6 text-xs text-muted">
              You joined via someone else&apos;s referral link — thanks for signing up!
            </p>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
