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
  {
    key: "Permissions-Policy",
    value:
      'camera=(), microphone=(), geolocation=(), payment=("https://buy.paddle.com" "https://sandbox-buy.paddle.com"), usb=(), interest-cohort=()',
  },
];

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Retired pages: the old watermark-removal landing pages, research
      // section and method-comparison guide are intentionally left to 404
      // so search engines drop them.
      {
        source: "/guides/does-watermark-removal-reduce-video-quality",
        destination: "/guides/does-ai-cleanup-reduce-video-quality",
        permanent: true,
      },
    ];
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
