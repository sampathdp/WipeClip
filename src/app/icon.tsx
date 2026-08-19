import { ImageResponse } from "next/og";

// Image metadata
export const size = {
  width: 32,
  height: 32,
};
export const contentType = "image/png";

// Image generation
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 20,
          background: "#05060a",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 7,
          border: "1px solid rgba(34, 211, 238, 0.6)",
          boxShadow: "0 0 10px rgba(124, 92, 255, 0.5)",
          color: "white",
          fontWeight: 800,
          position: "relative",
        }}
      >
        <div
          style={{
            background: "linear-gradient(135deg, #22d3ee, #8b5cf6)",
            backgroundClip: "text",
            color: "transparent",
            fontFamily: "sans-serif",
            letterSpacing: -1,
            marginTop: -2,
          }}
        >
          U
        </div>
        {/* Tiny AI star dot */}
        <div
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            width: 4,
            height: 4,
            borderRadius: "50%",
            background: "#22d3ee",
            boxShadow: "0 0 4px #ffffff",
          }}
        />
      </div>
    ),
    {
      ...size,
    }
  );
}
