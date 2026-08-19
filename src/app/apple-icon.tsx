import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#05060a",
          borderRadius: 38,
          border: "4px solid rgba(34, 211, 238, 0.7)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Glow ambient background */}
        <div
          style={{
            position: "absolute",
            width: 120,
            height: 120,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(124, 92, 255, 0.45), transparent 70%)",
          }}
        />

        {/* Central Monogram */}
        <div
          style={{
            fontSize: 104,
            fontWeight: 900,
            background: "linear-gradient(135deg, #22d3ee 20%, #8b5cf6 80%)",
            backgroundClip: "text",
            color: "transparent",
            fontFamily: "sans-serif",
            letterSpacing: -4,
            marginTop: -8,
          }}
        >
          U
        </div>

        {/* Star Sparkle */}
        <div
          style={{
            position: "absolute",
            top: 28,
            right: 28,
            width: 24,
            height: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: "#ffffff",
              boxShadow: "0 0 16px 6px #22d3ee",
            }}
          />
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
