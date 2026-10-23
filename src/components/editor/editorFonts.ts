import {
  Anton,
  Bangers,
  Bebas_Neue,
  Caveat,
  Dancing_Script,
  Lobster,
  Montserrat,
  Oswald,
  Pacifico,
  Permanent_Marker,
  Playfair_Display,
  Poppins,
  Press_Start_2P,
  Righteous,
  Roboto_Slab,
  Space_Grotesk,
} from "next/font/google";

/** Text-layer fonts, self-hosted by next/font. Not preloaded: the files
 * download only when a text layer uses one (the rasterizer's
 * document.fonts.load). Each exposes a CSS variable that textRaster.ts's
 * TEXT_FONTS refer to; useEditorFonts puts them on <html>, where the
 * rasterizer resolves them. */
const common = { subsets: ["latin"] as ["latin"], display: "swap" as const, preload: false };

const fonts = [
  Montserrat({ ...common, variable: "--font-montserrat" }),
  Poppins({ ...common, weight: ["400", "700", "900"], variable: "--font-poppins" }),
  Bebas_Neue({ ...common, weight: "400", variable: "--font-bebas" }),
  Anton({ ...common, weight: "400", variable: "--font-anton" }),
  Oswald({ ...common, variable: "--font-oswald" }),
  Playfair_Display({ ...common, variable: "--font-playfair" }),
  Roboto_Slab({ ...common, variable: "--font-roboto-slab" }),
  Space_Grotesk({ ...common, variable: "--font-space-grotesk" }),
  Lobster({ ...common, weight: "400", variable: "--font-lobster" }),
  Pacifico({ ...common, weight: "400", variable: "--font-pacifico" }),
  Permanent_Marker({ ...common, weight: "400", variable: "--font-marker" }),
  Bangers({ ...common, weight: "400", variable: "--font-bangers" }),
  Caveat({ ...common, variable: "--font-caveat" }),
  Dancing_Script({ ...common, variable: "--font-dancing" }),
  Righteous({ ...common, weight: "400", variable: "--font-righteous" }),
  Press_Start_2P({ ...common, weight: "400", variable: "--font-pixel" }),
];

export const EDITOR_FONT_CLASSES = fonts.map((f) => f.variable);
