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
 * TEXT_FONTS refer to; the editor puts them on <html>, where the
 * rasterizer resolves them. next/font needs every loader call assigned to
 * its own module-level const, with literal options. */
const montserrat = Montserrat({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-montserrat" });
const poppins = Poppins({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "700", "900"], variable: "--font-poppins" });
const bebas = Bebas_Neue({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-bebas" });
const anton = Anton({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-anton" });
const oswald = Oswald({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-oswald" });
const playfair = Playfair_Display({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-playfair" });
const robotoSlab = Roboto_Slab({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-roboto-slab" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-space-grotesk" });
const lobster = Lobster({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-lobster" });
const pacifico = Pacifico({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-pacifico" });
const marker = Permanent_Marker({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-marker" });
const bangers = Bangers({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-bangers" });
const caveat = Caveat({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-caveat" });
const dancing = Dancing_Script({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-dancing" });
const righteous = Righteous({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-righteous" });
const pixel = Press_Start_2P({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--font-pixel" });

export const EDITOR_FONT_CLASSES = [
  montserrat,
  poppins,
  bebas,
  anton,
  oswald,
  playfair,
  robotoSlab,
  spaceGrotesk,
  lobster,
  pacifico,
  marker,
  bangers,
  caveat,
  dancing,
  righteous,
  pixel,
].map((f) => f.variable);
