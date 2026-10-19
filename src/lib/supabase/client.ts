import { createBrowserClient } from "@supabase/ssr";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { IS_DESKTOP } from "@/lib/platform/env";
import { secureAuthStorage } from "@/lib/platform/secureStorage";

let desktopClient: SupabaseClient | null = null;

export function createClient(): SupabaseClient {
  if (IS_DESKTOP) {
    // The desktop app has no server to read cookies, so its session lives
    // in the OS credential store and goes to our API routes as a bearer
    // token (see apiFetch in src/lib/platform). One shared instance, so
    // token refreshes aren't raced by several clients.
    desktopClient ??= createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: {
        flowType: "pkce",
        storage: secureAuthStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
    return desktopClient;
  }
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
