import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { adminSignOut } from "@/app/admin/login/actions";
import { AdminNav } from "@/app/admin/AdminNav";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

function Brand() {
  return (
    <Link href="/admin" className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-2 font-display text-sm font-extrabold text-white">
        W
      </span>
      <span className="leading-tight">
        <span className="block font-display text-sm font-extrabold">WipeClip</span>
        <span className="block text-[11px] text-muted">Admin console</span>
      </span>
    </Link>
  );
}

function Account({ email }: { email: string }) {
  return (
    <form action={adminSignOut} className="flex items-center gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-bold uppercase text-foreground">
        {email.slice(0, 1)}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted" title={email}>
        {email}
      </span>
      <button className="rounded-md px-2 py-1 text-xs font-semibold text-muted transition hover:bg-surface-3 hover:text-foreground">
        Sign out
      </button>
    </form>
  );
}

/** Admin panel shell. Only accounts in ADMIN_EMAILS get past requireAdmin;
 * everyone else is sent to /admin/login. Each page and action checks again. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAdmin();
  const email = user.email ?? "";
  return (
    <div className="min-h-screen bg-surface-2/40 text-foreground lg:flex">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-background lg:sticky lg:top-0 lg:flex lg:h-screen">
        <div className="border-b border-border px-5 py-4">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted">Manage</p>
          <AdminNav variant="sidebar" />
        </div>
        <div className="border-t border-border px-4 py-3">
          <Account email={email} />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <Brand />
            <form action={adminSignOut}>
              <button className="rounded-md px-2 py-1 text-xs font-semibold text-muted hover:text-foreground">Sign out</button>
            </form>
          </div>
          <AdminNav variant="tabs" />
        </header>
        <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
