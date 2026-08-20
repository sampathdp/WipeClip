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
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
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
