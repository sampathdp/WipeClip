import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { isProUser } from "@/lib/plan";

export const metadata: Metadata = {
  title: "Job History",
  robots: { index: false },
};

type Transaction = {
  id: number;
  kind: "consume" | "refund";
  amount: number;
  resolution: string | null;
  tool: string | null;
  filename: string | null;
  created_at: string;
};

export default async function HistoryPage() {
  if (!isSupabaseConfigured()) redirect("/");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/sign-in?next=/history");
  if (!(await isProUser(supabase, user.id))) redirect("/pricing");

  const { data } = await supabase
    .from("credit_transactions")
    .select("id, kind, amount, resolution, tool, filename, created_at")
    .in("kind", ["consume", "refund"])
    .order("created_at", { ascending: false })
    .limit(200);

  const transactions = (data ?? []) as Transaction[];

  return (
    <div className="flex flex-1 flex-col">
      <Navbar />
      <main className="flex-1 pt-32 pb-20">
        <div className="mx-auto max-w-4xl px-6">
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
            Job History
          </h1>
          <p className="mt-3 text-sm sm:text-base text-muted">
            A usage/billing log of what you&apos;ve run and what it cost. This isn&apos;t a place to
            re-download past outputs — files were never stored on our servers, only streamed to
            your browser at process time.
          </p>

          <div className="mt-8 glass-card rounded-[1.75rem] border border-border/80 overflow-hidden">
            {transactions.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted">No processing history yet.</p>
            ) : (
              <div className="divide-y divide-border/60">
                {transactions.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {t.filename ?? (t.tool === "image" ? "Image job" : "Video job")}
                        {t.kind === "refund" && (
                          <span className="ml-2 rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-semibold text-amber-600 align-middle">
                            Refunded
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        {new Date(t.created_at).toLocaleString()}
                        {t.tool ? ` · ${t.tool}` : ""}
                        {t.resolution && t.resolution !== "image" ? ` · ${t.resolution}` : ""}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 font-mono text-sm font-bold ${
                        t.amount < 0 ? "text-muted" : "text-emerald-600"
                      }`}
                    >
                      {t.amount > 0 ? "+" : ""}
                      {t.amount} credit{Math.abs(t.amount) === 1 ? "" : "s"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
