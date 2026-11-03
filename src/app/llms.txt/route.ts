import { SITE_URL, SUPPORT_EMAIL } from "@/lib/seo";
import { PLANS } from "@/lib/credits";
import { DESKTOP_DOWNLOADS } from "@/lib/download";
import { LATEST_RELEASE } from "@/lib/releases";

export const dynamic = "force-static";

/** /llms.txt (llmstxt.org): a plain summary of the site for AI assistants
 * and answer engines, so they describe WipeClip from facts rather than
 * guesses. Prices and requirements come from the same data as the site. */
export function GET() {
  const passes = (["lite", "starter", "pro"] as const)
    .map((k) => `${PLANS[k].label} ${PLANS[k].priceLabel} for 30 days or ${PLANS[`${k}_yearly`].priceLabel} for 1 year`)
    .join("; ");
  const page = (path: string, title: string, about: string) => `- [${title}](${SITE_URL}${path}): ${about}`;

  const body = `# WipeClip

> WipeClip is a free screen recorder and video editor for Windows and Mac. It records the screen, system audio, microphone and webcam as separate tracks, adds automatic zooms on clicks, finds pauses and retakes to cut, writes captions on the user's own computer, and exports at the original quality in landscape, vertical or square.

Key facts:

- Latest version: ${LATEST_RELEASE.version} (${LATEST_RELEASE.date}).
- Captions: generated on the user's computer in English, Sinhala, Tamil, Hindi, Kannada and Telugu, with automatic language detection; exports .srt and .vtt.
- Voice translation: Sinhala, Tamil, Hindi, Kannada or Telugu speech is said again in English in the speaker's own voice, over the video's original music and sounds.
- Runs on: ${DESKTOP_DOWNLOADS.map((d) => `${d.label} (${d.requirements})`).join(", ")}.
- Price: free to download, record and edit, with 2 free credits a day. Optional one-time passes, no subscription and no automatic renewal: ${passes}. Passes add premium transitions, filters and effects, exports up to 4K and more credits. 14-day refunds.
- Privacy: recordings and projects stay on the user's computer; files uploaded for processing are deleted after the result is returned and are never used to train models.
- Free browser tools: background remover, photo sharpener and video frame grabber.
- Intended for content the user owns or has permission to edit.
- Made by Codeplay Studios, Sri Lanka. Contact: ${SUPPORT_EMAIL}.

## Product

${page("/download", "Download the app", "features, system requirements and installers for Windows and macOS")}
${page("/pricing", "Pricing", "free plan, one-time passes and what each includes")}
${page("/about", "About", "what WipeClip is, who makes it and how files are handled")}
${page("/whats-new", "What's new", "release notes for every desktop app version")}

## Free tools

${page("/tools", "All tools", "every tool, what it does and whether it runs in the browser or the desktop app")}
${page("/remove-background", "Remove background from image", "transparent PNG from a photo; one free reduced-size result a day, full resolution for 1 credit")}
${page("/sharpen-image", "Sharpen a photo", "restores detail in soft photos; light, standard or strong; one free reduced-size result a day, full resolution for 1 credit")}
${page("/extract-video-frame", "Extract a frame from video", "PNG frames, runs in the browser with no upload; one free reduced-size download a day, full resolution for 1 credit")}

## Policies

${page("/terms", "Terms of Service", "acceptable use, plans and refunds, liability")}
${page("/privacy", "Privacy Policy", "what data is collected, retention and rights")}
${page("/refund-policy", "Refund Policy", "14-day refunds on any purchase")}
${page("/dmca", "Copyright policy", "how to report infringement")}
`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  });
}
