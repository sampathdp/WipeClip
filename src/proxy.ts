import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const GATE_COOKIE = "wc_bypass";

export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const secret = process.env.SITE_BYPASS_SECRET;
  const paramBypass = Boolean(secret && searchParams.get("bypass") === secret);
  const cookieBypass = Boolean(secret && request.cookies.get(GATE_COOKIE)?.value === secret);
  const exempt = pathname === "/under-construction" || pathname.startsWith("/api/") || pathname.startsWith("/auth/");

  if (process.env.SITE_UNDER_CONSTRUCTION === "true" && !exempt && !paramBypass && !cookieBypass) {
    const url = request.nextUrl.clone();
    url.pathname = "/under-construction";
    url.search = "";
    return NextResponse.rewrite(url);
  }

  let response = NextResponse.next({ request });

  // Supabase isn't configured yet in every environment (e.g. before
  // BILLING_SETUP.md's setup steps are done) - the rest of the site has
  // nothing to do with auth, so a missing session-refresh capability
  // should mean "nobody is signed in," not a 500 on every page.
  // Anonymous visitors (no Supabase session cookie at all - the vast
  // majority of traffic: search crawlers, first-time visitors, everyone
  // hitting the free tools) have nothing for getUser() to refresh. Skip
  // the network round-trip to Supabase's auth server entirely for them -
  // it was running on every single request regardless of session state,
  // adding a full extra hop to TTFB even for a fully static, cached page.
  const hasSupabaseSession = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));

  if (
    !hasSupabaseSession ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    if (paramBypass && !cookieBypass) {
      response.cookies.set(GATE_COOKIE, secret!, { maxAge: 60 * 60 * 24 * 30, httpOnly: true });
    }
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  // Refreshes the session cookie if it's close to expiring - without this,
  // a signed-in visitor gets silently logged out mid-session rather than
  // staying signed in across requests.
  await supabase.auth.getUser();

  // First visit with the right ?bypass= param earns a cookie so the rest of
  // that visitor's session skips the gate too, not just this one request.
  // Set last: `response` may have been reassigned above by Supabase's own
  // cookie sync, so setting this any earlier would get silently dropped.
  if (paramBypass && !cookieBypass) {
    response.cookies.set(GATE_COOKIE, secret!, { maxAge: 60 * 60 * 24 * 30, httpOnly: true });
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|opengraph-image).*)"],
};
