/** Landing pages for single desktop app features, aimed at the searches
 * people make for them ("sinhala subtitle generator", "translate video to
 * english"). English only. Every claim here is checked against the app:
 * caption languages (CAPTION_LANGUAGES in src/components/editor/Panels.tsx),
 * translation languages (src/app/api/translate/route.ts), the free export
 * limit and the panel texts the screenshots show. No third-party names. */

export type FeatureShot = { src: string; alt: string; caption: string };

export type FeaturePage = {
  path: string;
  /** Short name for breadcrumbs and related links. */
  name: string;
  title: string;
  description: string;
  eyebrow: string;
  h1: string;
  h1Accent: string;
  intro: string;
  hero: FeatureShot;
  steps: { title: string; text: string }[];
  highlights: { title: string; text: string }[];
  shots: FeatureShot[];
  faqs: { q: string; a: string }[];
  /** Sentence for the closing call to action. */
  cta: string;
};

const W = 1800;
const H = 981;
export const SHOT_SIZE = { width: W, height: H };

const SHOTS = {
  language: {
    src: "/features/captions-language.webp",
    alt: "WipeClip auto captions panel with Sinhala chosen as the spoken language, and a Sinhala caption on the video preview",
    caption: "Pick the spoken language, how many words per caption, and any names to spell right.",
  },
  style: {
    src: "/features/captions-style.webp",
    alt: "WipeClip caption style panel with Clean, Boxed, Bold, Yellow, Karaoke and Word by word presets",
    caption: "Six caption looks, then position, size, font, color, outline and background box.",
  },
  edit: {
    src: "/features/captions-edit.webp",
    alt: "WipeClip caption list showing timed Sinhala captions with find and replace",
    caption: "Every caption with its time. Fix a word, or replace it everywhere at once.",
  },
  transcript: {
    src: "/features/transcript-edit.webp",
    alt: "WipeClip transcript of a Sinhala video, where deleting words cuts that part of the video",
    caption: "The whole transcript. Select words and delete them to cut that part of the video.",
  },
  translate: {
    src: "/features/translate-voice.webp",
    alt: "WipeClip Translate voice to English panel below the transcript",
    caption: "Translate voice to English sits under the transcript. The voice models download once.",
  },
} satisfies Record<string, FeatureShot>;

const SYSTEMS =
  "WipeClip is a free desktop app for Windows 10 (21H2 or later) and Windows 11. The macOS version is coming soon.";

export const SINHALA_SUBTITLES: FeaturePage = {
  path: "/sinhala-subtitles",
  name: "Sinhala subtitles",
  title: "Sinhala Subtitle Generator for Video, Free on Windows",
  description:
    "Make Sinhala subtitles for any video automatically. Speech is turned into timed Sinhala captions on your own computer. Edit, style and export as SRT.",
  eyebrow: "Sinhala auto captions",
  h1: "Sinhala subtitles,",
  h1Accent: "made automatically",
  intro:
    "Open a video where people speak Sinhala, choose Sinhala, and WipeClip writes timed captions in Sinhala script for you. English words people mix into their speech stay in English letters, the way it was said. Speech recognition runs on your computer, so your audio isn't uploaded for captions.",
  hero: SHOTS.language,
  steps: [
    {
      title: "Open your video",
      text: "Drop in an MP4, MOV or WebM file, or record your screen in the app. Your original file is never changed.",
    },
    {
      title: "Generate Sinhala captions",
      text: "Go to Text, then Captions, choose Sinhala as the language and pick how many words each caption shows. The Sinhala speech model downloads once the first time.",
    },
    {
      title: "Fix, style and export",
      text: "Correct any word in Edit text, choose a caption look, then export the video with captions on it, or save them as an SRT or WebVTT file.",
    },
  ],
  highlights: [
    {
      title: "Sinhala script, English words kept",
      text: "Mixed Sinhala and English speech comes out the way people talk: Sinhala words in Sinhala letters, English words in English.",
    },
    {
      title: "Names spelled your way",
      text: "Add people, places and product names before you generate, and the captions use your spelling.",
    },
    {
      title: "Best accuracy option",
      text: "Checks more possible wordings before choosing one, for fewer wrong words. About twice as slow.",
    },
    {
      title: "Fast on a graphics card",
      text: "Use the graphics card for about 10 times faster captions. It also works on the processor alone.",
    },
    {
      title: "Edit by text",
      text: "Find and replace across every caption, or delete words in the transcript to cut that part of the video.",
    },
    {
      title: "SRT and WebVTT export",
      text: "Save the captions as a subtitle file, or keep them on the video when you export.",
    },
  ],
  shots: [SHOTS.edit, SHOTS.style, SHOTS.transcript],
  faqs: [
    {
      q: "Is the Sinhala subtitle generator free?",
      a: "Yes. Making captions is free. The free plan exports videos up to 10 minutes long.",
    },
    {
      q: "Is my video uploaded to make the captions?",
      a: "No. Speech recognition runs on your own computer. Your audio isn't uploaded to make captions.",
    },
    {
      q: "Can I use it for videos that mix Sinhala and English?",
      a: "Yes. Choose Sinhala as the language. Sinhala words come out in Sinhala script and English words people say stay in English letters.",
    },
    {
      q: "How accurate are the Sinhala captions?",
      a: "Clear speech with little background noise works best. Add names and special words before you generate, turn on Best accuracy, and fix any remaining word in Edit text or with find and replace.",
    },
    {
      q: "Can I export Sinhala subtitles as an SRT file?",
      a: "Yes. Export the captions as SRT or WebVTT, or export the video with the captions shown on it.",
    },
    {
      q: "Which computers does it run on?",
      a: SYSTEMS,
    },
  ],
  cta: "Download WipeClip and make your first Sinhala subtitles in a few minutes.",
};

export const TRANSLATE_VIDEO: FeaturePage = {
  path: "/translate-video-to-english",
  name: "Translate video to English",
  title: "Translate Video to English in Your Own Voice",
  description:
    "Translate a Sinhala, Tamil, Hindi, Kannada or Telugu video to English. The speech is said again in English in the speaker's own voice, over the original music.",
  eyebrow: "Voice translation",
  h1: "Translate your video to English,",
  h1Accent: "in your own voice",
  intro:
    "Made a video in Sinhala, Tamil, Hindi, Kannada or Telugu? WipeClip says the speech again in English, in the speaker's own voice, over the video's own music and sounds. The voice is made on your computer: only the transcript's text is sent to translate.",
  hero: SHOTS.translate,
  steps: [
    {
      title: "Transcribe the video",
      text: "Open your video and generate captions in the language that's spoken: Sinhala, Tamil, Hindi, Kannada or Telugu.",
    },
    {
      title: "Translate voice to English",
      text: "In the Transcript panel, choose Translate voice to English. The first time, the voice models download once (about 2 GB).",
    },
    {
      title: "Check it and export",
      text: "The English speech lands as two new audio tracks and the original speech is muted. Listen through, undo if you want to go back, then export.",
    },
  ],
  highlights: [
    {
      title: "The speaker's own voice",
      text: "The English speech sounds like the person in the video, not a stock voice.",
    },
    {
      title: "Music and sounds kept",
      text: "Only the speech is replaced. The video's own music and background sounds stay underneath.",
    },
    {
      title: "Five languages to English",
      text: "Sinhala, Tamil, Hindi, Kannada and Telugu speech, translated to English.",
    },
    {
      title: "Your audio stays with you",
      text: "Only the transcript's text is sent to WipeClip to translate. The audio and the voice stay on your computer.",
    },
    {
      title: "Undo in one step",
      text: "The translation is added as new tracks. Undo once and the original speech is back.",
    },
    {
      title: "Up to about an hour",
      text: "Translate up to about an hour of speech in one go.",
    },
  ],
  shots: [SHOTS.transcript, SHOTS.language, SHOTS.edit],
  faqs: [
    {
      q: "Which languages can I translate to English?",
      a: "Sinhala, Tamil, Hindi, Kannada and Telugu. The speech is translated to English and said in the speaker's own voice.",
    },
    {
      q: "Is my audio uploaded?",
      a: "No. Only the transcript's text is sent to WipeClip to translate. The audio and the voice stay on your computer. You need to be signed in to translate.",
    },
    {
      q: "How long does translating take?",
      a: "A few minutes per minute of video on the processor, using around 3 GB of memory. The voice models, about 2 GB, download once the first time.",
    },
    {
      q: "What happens to the original speech?",
      a: "The English speech is added as two new audio tracks and the original speech is muted. The video's music and sounds stay. Undo to go back to the original.",
    },
    {
      q: "Can I translate someone else's voice?",
      a: "Use voice translation only with voices you have the right to use, such as your own or with the speaker's permission.",
    },
    {
      q: "Which computers does it run on?",
      a: SYSTEMS,
    },
  ],
  cta: "Download WipeClip and give your next video an English version.",
};

export const AUTO_CAPTIONS: FeaturePage = {
  path: "/auto-captions",
  name: "Auto captions",
  title: "Auto Captions for Video, Free on Windows",
  description:
    "Add automatic captions to any video for free. Captions in English, Sinhala, Tamil, Hindi and 22 more languages, with six styles and SRT export.",
  eyebrow: "Auto captions",
  h1: "Auto captions for your videos,",
  h1Accent: "free on your computer",
  intro:
    "WipeClip turns the speech in your video, screen recording or voiceover into timed captions in a few clicks. Pick a look, fix any word, and export. Speech recognition runs on your computer, so your audio isn't uploaded for captions.",
  hero: SHOTS.style,
  steps: [
    {
      title: "Open or record a video",
      text: "Drop in an MP4, MOV or WebM file, or record your screen with your microphone in the app.",
    },
    {
      title: "Generate captions",
      text: "Go to Text, then Captions. Choose the spoken language, or let the app detect it, and how many words each caption shows.",
    },
    {
      title: "Style and export",
      text: "Choose a caption look, move it to the top, middle or bottom, then export the video with captions, or as an SRT or WebVTT file.",
    },
  ],
  highlights: [
    {
      title: "26 languages",
      text: "English, Sinhala, Tamil, Hindi, Kannada and Telugu, plus Spanish, French, German, Arabic, Japanese, Korean and more.",
    },
    {
      title: "Six caption looks",
      text: "Clean, Boxed, Bold, Yellow, Karaoke and Word by word, each with your own font, color, outline and background box.",
    },
    {
      title: "From 1 word to a phrase",
      text: "Show one word at a time for short vertical videos, or full phrases for tutorials and talks.",
    },
    {
      title: "Fix words fast",
      text: "Edit any caption, or find and replace a wrong word everywhere at once.",
    },
    {
      title: "Cut by deleting words",
      text: "Delete words in the transcript to cut that part of the video. Captions follow the cut.",
    },
    {
      title: "SRT and WebVTT",
      text: "Export the captions as a subtitle file, or keep them on the video itself.",
    },
  ],
  shots: [SHOTS.language, SHOTS.edit, SHOTS.transcript],
  faqs: [
    {
      q: "Are the auto captions free?",
      a: "Yes. Making captions is free. The free plan exports videos up to 10 minutes long.",
    },
    {
      q: "Which languages are supported?",
      a: "26, including English, Sinhala, Tamil, Hindi, Kannada, Telugu, Spanish, French, German, Portuguese, Arabic, Japanese, Korean and Chinese. You can also let the app detect the language.",
    },
    {
      q: "Is my video uploaded to make captions?",
      a: "No. Speech recognition runs on your own computer. Your audio isn't uploaded to make captions.",
    },
    {
      q: "Can I change how the captions look?",
      a: "Yes. Start from one of six looks, then change the font, size, color, outline, background box, alignment and position. To style one caption on its own, click it in the preview.",
    },
    {
      q: "Can I export captions as SRT?",
      a: "Yes. Export them as SRT or WebVTT, or export the video with the captions shown on it.",
    },
    {
      q: "Which computers does it run on?",
      a: SYSTEMS,
    },
  ],
  cta: "Download WipeClip and caption your next video for free.",
};

export const FEATURE_PAGES: FeaturePage[] = [AUTO_CAPTIONS, SINHALA_SUBTITLES, TRANSLATE_VIDEO];
