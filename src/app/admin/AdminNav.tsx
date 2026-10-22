"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Simple stroke icons, 24x24 viewBox.
const ICONS: Record<string, React.ReactNode> = {
  overview: <path d="M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z" />,
  users: (
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  ),
  analytics: <path d="M3 3v18h18M7 15l4-4 3 3 6-6" />,
  orders: <path d="M3 6h18M3 12h18M3 18h12M7 3v18" />,
  feedback: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10Z" />,
  promotion: <path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82ZM7 7h.01" />,
  newsletter: <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm18 2-10 7L2 6" />,
};

const NAV = [
  { href: "/admin", label: "Overview", icon: "overview" },
  { href: "/admin/analytics", label: "Analytics", icon: "analytics" },
  { href: "/admin/users", label: "Users", icon: "users" },
  { href: "/admin/orders", label: "Orders", icon: "orders" },
  { href: "/admin/feedback", label: "Feedback", icon: "feedback" },
  { href: "/admin/promotion", label: "Promotion", icon: "promotion" },
  { href: "/admin/newsletter", label: "Newsletter", icon: "newsletter" },
];

/** Sidebar links on wide screens, a scrolling tab strip on phones. */
export function AdminNav({ variant }: { variant: "sidebar" | "tabs" }) {
  const pathname = usePathname();
  const active = (href: string) => (href === "/admin" ? pathname === href : pathname.startsWith(href));

  if (variant === "tabs") {
    return (
      <nav className="-mb-px flex gap-1 overflow-x-auto px-4">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
              active(n.href) ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {n.label}
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <nav className="space-y-1">
      {NAV.map((n) => {
        const on = active(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={on ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              on ? "bg-accent/12 text-accent" : "text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="h-4 w-4 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {ICONS[n.icon]}
            </svg>
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
