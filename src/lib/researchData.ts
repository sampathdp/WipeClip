/**
 * Typed structures for WipeClip's published research tests.
 *
 * RESEARCH_TESTS starts empty on purpose. Nothing in this file may contain
 * fabricated numbers, times, or before/after media - every entry here must
 * correspond to a real test that was actually run, with real output files,
 * before it's added. See RESEARCH-DATA-CHECKLIST.md for what's needed to
 * add one.
 */

export type TestCategory =
  | "static-watermark"
  | "moving-watermark"
  | "semi-transparent-overlay"
  | "complex-background"
  | "fast-motion"
  | "overlay-crossing-person";

export type ResearchTest = {
  id: string;
  category: TestCategory;
  testName: string;
  testDescription: string;
  watermarkType: string;
  inputResolution: string;
  outputResolution: string;
  inputFPS: number;
  outputFPS: number;
  clipDuration: string;
  processingTime: string;
  watermarkSize: string;
  backgroundType: string;
  cameraMovement: string;
  visibleArtifacts: string;
  resultNotes: string;
  beforeMedia: string;
  afterMedia: string;
  mediaType: "video" | "image";
  softwareVersion: string;
  testDate: string;
};

export type TestCategoryInfo = {
  key: TestCategory;
  label: string;
  description: string;
};

export const TEST_CATEGORIES: TestCategoryInfo[] = [
  {
    key: "static-watermark",
    label: "Static Watermark Test",
    description: "A logo or badge that stays in one fixed position for the whole clip.",
  },
  {
    key: "moving-watermark",
    label: "Moving Watermark Test",
    description: "An overlay that drifts, resizes, or repositions as the clip plays.",
  },
  {
    key: "semi-transparent-overlay",
    label: "Semi-Transparent Overlay",
    description: "A watermark rendered at partial opacity rather than a solid mark.",
  },
  {
    key: "complex-background",
    label: "Complex Background",
    description: "Busy, highly textured, or fast-changing footage sitting behind the mark.",
  },
  {
    key: "fast-motion",
    label: "Fast Motion",
    description: "Quick pans, shaky handheld footage, or rapid cuts.",
  },
  {
    key: "overlay-crossing-person",
    label: "Overlay Crossing a Person",
    description: "A mark that overlaps a moving subject in the frame.",
  },
];

/**
 * No verified tests have been run yet. Add an entry here only once you have
 * a real before/after clip pair and real measured values for every field -
 * never placeholder or estimated numbers.
 */
export const RESEARCH_TESTS: ResearchTest[] = [];
