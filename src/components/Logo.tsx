import React from "react";

interface LogoProps {
  size?: number;
  showText?: boolean;
  className?: string;
  textSize?: string;
}

export default function Logo({
  size = 36,
  showText = true,
  className = "",
  textSize = "text-xl",
}: LogoProps) {
  return (
    <div className={`inline-flex items-center gap-2.5 font-bold tracking-tight select-none group ${className}`}>
      {/* Dynamic Vector Icon Mark */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="transition-transform duration-300 group-hover:scale-105 drop-shadow-[0_0_12px_rgba(124,92,255,0.35)] shrink-0"
      >
        <defs>
          <linearGradient id="logo-comp-bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#0e111d" />
            <stop offset="100%" stopColor="#05060a" />
          </linearGradient>
          <linearGradient id="logo-comp-brand" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="45%" stopColor="#60a5fa" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
          <linearGradient id="logo-comp-border" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.8" />
            <stop offset="50%" stopColor="#7c5cff" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#7c5cff" stopOpacity="0.8" />
          </linearGradient>
        </defs>

        {/* Outer Squircle Container */}
        <rect
          x="2"
          y="2"
          width="60"
          height="60"
          rx="15"
          fill="url(#logo-comp-bg)"
          stroke="url(#logo-comp-border)"
          strokeWidth="2"
        />

        {/* Shutter Arcs */}
        <path
          d="M 24 16 C 36 14, 48 20, 52 30"
          stroke="#22d3ee"
          strokeWidth="1.8"
          strokeLinecap="round"
          opacity="0.45"
        />
        <path
          d="M 12 34 C 14 46, 26 52, 38 50"
          stroke="#a855f7"
          strokeWidth="1.8"
          strokeLinecap="round"
          opacity="0.45"
        />

        {/* Central Geometric 'U' */}
        <path
          d="M 21 21
             L 27 21
             L 27 37
             C 27 41, 29 43, 32 43
             C 35 43, 37 41, 37 37
             L 37 25
             L 43 25
             L 43 37
             C 43 45, 38 49, 32 49
             C 26 49, 21 45, 21 37
             Z"
          fill="url(#logo-comp-brand)"
        />

        {/* AI Sparkle */}
        <path
          d="M 43 17
             C 43.5 21, 44.5 22, 48 22.5
             C 44.5 23, 43.5 24, 43 28
             C 42.5 24, 41.5 23, 38 22.5
             C 41.5 22, 42.5 21, 43 17
             Z"
          fill="#ffffff"
          className="animate-pulse"
        />
      </svg>

      {/* Typography */}
      {showText && (
        <span className={`${textSize} font-bold tracking-tight text-foreground leading-none`}>
          WipeClip<span className="text-gradient">.io</span>
        </span>
      )}
    </div>
  );
}
