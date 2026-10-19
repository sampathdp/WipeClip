/** Build-time platform flags. Kept free of imports so anything (including
 * the Supabase client factory) can read them without import cycles.
 *
 * NEXT_PUBLIC_WIPECLIP_DESKTOP is set to "1" only by the desktop build
 * (desktop/next.config.ts). In the website build it's undefined, so every
 * `if (IS_DESKTOP)` branch is dead code there.
 */
export const IS_DESKTOP = process.env.NEXT_PUBLIC_WIPECLIP_DESKTOP === "1";

/** The website the desktop app talks to for accounts, credits and job
 * tickets, and opens in the system browser for pricing/terms/profile. */
export const SITE_ORIGIN = (process.env.NEXT_PUBLIC_DESKTOP_SITE_ORIGIN ?? "https://www.wipeclip.co").replace(/\/+$/, "");

/** Where Supabase sends the desktop app back to after Google sign-in or an
 * email link. Must be listed under Authentication -> URL Configuration ->
 * Redirect URLs in the Supabase dashboard. */
export const DESKTOP_AUTH_REDIRECT = "wipeclip://auth/callback";
