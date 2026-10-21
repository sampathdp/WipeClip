import type { NextConfig } from "next";

const securityHeaders = [
  // Blocks this site from being embedded in an <iframe> elsewhere -
  // stops clickjacking attacks against the upload/checkout flows.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Stops the browser guessing content-types away from what the server
  // declared (a classic path to XSS via a "helpfully" reinterpreted upload).
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Sends full origin+path to same-origin links, only the origin
  // cross-origin - avoids leaking full URLs (which can carry auth
  // callback tokens/paths) to third-party sites via the Referer header.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Denies browser features this site never uses; trims what a
  // compromised third-party script embedded here could reach for.
  // `payment` is left to Paddle's checkout frame only, which needs it for
  // Apple Pay and Google Pay.
  // Browsers that have seen the site once refuse plain-HTTP connections to
  // it for two years, so a network attacker can't downgrade a visit and
  // read session cookies. Vercel serves every subdomain over HTTPS.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Only the directives that can't break the page's scripts or styles:
  // no plugins, no <base> hijacking, and frames only from this site (the
  // modern form of X-Frame-Options above).
  {
    key: "Content-Security-Policy",
    value: "object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
  },
  {
    key: "Permissions-Policy",
    value:
      'camera=(), microphone=(), geolocation=(), payment=("https://buy.paddle.com" "https://sandbox-buy.paddle.com"), usb=(), interest-cohort=()',
  },
];

const nextConfig: NextConfig = {
  env: {
    // "1" only in the desktop app's build (desktop/next.config.ts). Set
    // explicitly here so desktop-only branches (src/lib/platform) are
    // compiled out of the website instead of shipped and skipped.
    NEXT_PUBLIC_WIPECLIP_DESKTOP: "0",
  },
  // The online editor was retired: the editor ships only as the Windows and
  // macOS app, so old links and search results land on its download page.
  async redirects() {
    return [{ source: "/editor", destination: "/download", permanent: true }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
