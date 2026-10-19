import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component that can't set cookies - the
            // middleware below refreshes the session on every request, so
            // this is safe to ignore here.
          }
        },
      },
    }
  );
}

/** The caller's Supabase client and user, for routes the desktop app also
 * calls. Browsers send the session as cookies (same as createClient); the
 * desktop app can't - its pages live on Tauri's own origin - so it sends
 * `Authorization: Bearer <access token>` instead. The token is verified by
 * Supabase (getUser), and the returned client queries as that user, so RLS
 * applies exactly as it does for the cookie session.
 */
export async function getRequestAuth(request: Request): Promise<{ supabase: SupabaseClient; user: User | null }> {
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token) {
    const supabase = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data } = await supabase.auth.getUser(token);
    return { supabase, user: data.user };
  }
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}

/** Service-role client: bypasses RLS. Server-only - never import from a
 * Client Component. Used for webhook credit grants and credit consumption,
 * where the acting "user" is our own backend, not the signed-in visitor.
 */
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
