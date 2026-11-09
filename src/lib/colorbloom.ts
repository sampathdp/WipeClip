/**
 * ColorBloom: Codeplay Studios' mindful coloring app for Android phones.
 * Shared by the /colorbloom page and the site-wide announcement popup.
 */

export const COLORBLOOM_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.codeplaystudio.colorbloom";

export const COLORBLOOM_PATH = "/colorbloom";

const base = "/colorbloom";

export const COLORBLOOM_IMAGES = {
  icon: `${base}/icon-256.webp`,
  feature: `${base}/feature-1024.webp`,
};

export interface ColorBloomScreen {
  src: string;
  title: string;
  caption: string;
}

export const COLORBLOOM_SCREENS: ColorBloomScreen[] = [
  { src: `${base}/home.webp`, title: "Endless inspiration", caption: "Curated designs and a new design of the day." },
  { src: `${base}/coloring.webp`, title: "Tap to color", caption: "Smooth fills with undo, redo and zoom." },
  { src: `${base}/symmetry.webp`, title: "Symmetry Studio", caption: "Draw live mandalas with 8x, 12x or 16x symmetry." },
  { src: `${base}/mandala-studio.webp`, title: "Mandala Studio", caption: "Build and color your own mandala designs." },
  { src: `${base}/timelapse.webp`, title: "Timelapse and wallpapers", caption: "Replay your work and save it as an HD wallpaper." },
  { src: `${base}/streaks.webp`, title: "Streaks and gallery", caption: "Keep a daily streak and revisit every finished piece." },
  { src: `${base}/calendar.webp`, title: "Coloring calendar", caption: "See your mindful moments day by day." },
  { src: `${base}/completion.webp`, title: "Finished pieces", caption: "Celebrate every artwork you complete." },
];

export const COLORBLOOM_FEATURES = [
  { title: "Curated designs", text: "Mandalas, sacred geometry, geometric and floral art, plus a fresh design of the day." },
  { title: "Symmetry Studio", text: "Draw live, mirrored mandalas with 8x, 12x or 16x symmetry and a full spectrum color wheel." },
  { title: "Mandala Studio", text: "Design your own mandalas from scratch, then color them your way." },
  { title: "Timelapse and HD wallpapers", text: "Replay how your artwork came together and save it as a wallpaper or PNG." },
  { title: "Streaks and calendar", text: "Build a calm daily habit with streaks, a coloring calendar and your personal gallery." },
  { title: "Works offline", text: "Color anywhere with no internet. Progress syncs when you are back online." },
  { title: "No ads, no tracking", text: "No ad networks and no email sign-up. Start coloring with an optional anonymous profile." },
  { title: "Made to unwind", text: "Gentle sounds and haptics turn a few minutes of coloring into a calm break." },
];
