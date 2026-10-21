/** The visitor's real IP address, for rate limits and webhook source checks.
 *
 * The site runs on Vercel behind Cloudflare, so the address Vercel sees
 * (x-real-ip / x-forwarded-for) is a Cloudflare edge server shared by many
 * visitors; the visitor's own address is in cf-connecting-ip. That header
 * is only trusted when the request really arrived from Cloudflare's
 * published ranges: anyone can send it to the vercel.app address directly.
 * Without Cloudflare in front, the Vercel-set address is used as is.
 */

// https://www.cloudflare.com/ips/ - changes rarely; update if it does.
const CLOUDFLARE_V4 = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
];
const CLOUDFLARE_V6 = [
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

function v4ToBigInt(ip: string): bigint | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = BigInt(0);
  for (const p of parts) {
    if (!/^[0-9]{1,3}$/.test(p) || Number(p) > 255) return null;
    n = (n << BigInt(8)) | BigInt(Number(p));
  }
  return n;
}

function v6ToBigInt(ip: string): bigint | null {
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  let n = BigInt(0);
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    n = (n << BigInt(16)) | BigInt(parseInt(g, 16));
  }
  return n;
}

function inRanges(ip: string, ranges: string[], bits: number, parse: (s: string) => bigint | null): boolean {
  const n = parse(ip);
  if (n === null) return false;
  return ranges.some((cidr) => {
    const [base, len] = cidr.split("/");
    const b = parse(base);
    if (b === null) return false;
    const shift = BigInt(bits - Number(len));
    return n >> shift === b >> shift;
  });
}

export function isCloudflareIp(ip: string): boolean {
  const v4 = ip.replace(/^::ffff:/i, "");
  return ip.includes(":") && !/^::ffff:/i.test(ip)
    ? inRanges(ip, CLOUDFLARE_V6, 128, v6ToBigInt)
    : inRanges(v4, CLOUDFLARE_V4, 32, v4ToBigInt);
}

/** The visitor's IP, or null if none can be found. Takes the request's
 * headers (Request.headers or next/headers' headers()). */
export function clientIp(headers: Headers): string | null {
  const peer = headers.get("x-real-ip")?.trim() || headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const viaCloudflare = headers.get("cf-connecting-ip")?.trim();
  if (peer && viaCloudflare && isCloudflareIp(peer)) return viaCloudflare;
  return peer;
}
