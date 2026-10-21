import { ImageResponse } from "next/og";
import { AI_CLEANUP_ENABLED } from "@/lib/features";

export const alt = AI_CLEANUP_ENABLED
  ? "WipeClip.co: AI video cleanup for creators"
  : "WipeClip.co: video editor for Windows and Mac";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#05060a",
          backgroundImage:
            "radial-gradient(circle at 50% 30%, rgba(124,92,255,0.35), transparent 60%), radial-gradient(circle at 80% 80%, rgba(34,211,238,0.25), transparent 50%)",
        }}
      >
        {/* Logo Mark Lockup */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 24,
            marginBottom: 20,
          }}
        >
          {/* Logo Mark Box */}
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: 24,
              background: "#0c0e18",
              border: "3px solid #22d3ee",
              boxShadow: "0 0 40px rgba(124, 92, 255, 0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
            }}
          >
            <div
              style={{
                fontSize: 60,
                fontWeight: 900,
                background: "linear-gradient(135deg, #22d3ee, #8b5cf6)",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              W
            </div>
            {/* Sparkle */}
            <div
              style={{
                position: "absolute",
                top: 10,
                right: 10,
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: "#ffffff",
                boxShadow: "0 0 12px 4px #22d3ee",
              }}
            />
          </div>

          {/* Brand Wordmark */}
          <div
            style={{
              fontSize: 84,
              fontWeight: 800,
              color: "#f4f4f6",
              letterSpacing: -2,
              display: "flex",
            }}
          >
            WipeClip<span style={{ color: "#7c5cff" }}>.co</span>
          </div>
        </div>

        {/* Subtitle / Tagline */}
        <div
          style={{
            fontSize: 34,
            fontWeight: 500,
            color: "#c3c6d4",
            display: "flex",
            letterSpacing: -0.5,
          }}
        >
          {AI_CLEANUP_ENABLED ? "AI Video Cleanup for Creators" : "Video Editor for Windows & Mac"}
        </div>
      </div>
    ),
    { ...size }
  );
}
