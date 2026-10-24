"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { langOf } from "@/lib/i18n";

/** The root layout renders <html lang="en">; this keeps the attribute in
 * step with the page's language across client-side navigations. */
export default function HtmlLang() {
  const pathname = usePathname() || "/";
  useEffect(() => {
    document.documentElement.lang = langOf(pathname);
  }, [pathname]);
  return null;
}
