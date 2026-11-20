import enClient from "./en-client";

/** English strings for every translated page. Other languages copy this
 * shape exactly (see src/i18n/types.ts). `client` is what client components
 * read through I18nProvider, so it holds plain strings only; {name}
 * placeholders are filled with fmt(). Copy behind the AI cleanup flag is
 * not here: it stays English in the components while the feature is off. */
const en = {
  client: enClient,

  meta: {
    home: {
      title: "Video Editor & Screen Recorder for Windows and Mac",
      description:
        "Free video editor and screen recorder for Windows and Mac. Auto captions in 6 languages, voice translation to English, auto zooms and full-quality export.",
    },
  },

  footer: {
    download: "Download",
    about: "About",
    feedback: "Feedback & Bugs",
    privacy: "Privacy",
    terms: "Terms",
    refund: "Refund Policy",
    dmca: "Copyright / DMCA",
    freeTools: "Free tools:",
    allTools: "All tools",
    guides: "Guides",
    whatsNew: "What's new",
    disclaimer:
      "For content you created or have the rights to edit only. Using WipeClip.co to infringe anyone's copyright or other rights is prohibited. Not affiliated with any third-party video platform or AI model provider. Please review our {terms}.",
    termsLink: "Terms of Service",
  },

  hero: {
    badge: "New: dub and caption in French, German, Spanish and Italian",
    h1: ["Desktop Video ", "Editor ", "for Creators"],
    intro:
      "Trim, cut and arrange clips, add transitions, text, stickers, filters and music, then export in landscape, vertical or square. Free for Windows and Mac, with a built-in screen recorder. Auto captions and picture-in-picture included.",
    download: "Download free",
    photoTools: "Free photo tools",
    trust: ["Free forever plan", "No account to start", "Windows & Mac"],
    marquee: ["MP4", "MOV", "WEBM", "TRIM · CUT · TRANSITIONS", "AUTO CAPTIONS", "PICTURE-IN-PICTURE", "TEXT · STICKERS · MUSIC", "FILTERS", "LANDSCAPE · VERTICAL · SQUARE"],
    videoLabel: "Video editor preview",
  },

  languageLaunch: {
    badge: "New",
    kicker: "Voice translation & captions for Europe",
    title: "Your voice, ",
    titleHighlight: "in five languages",
    intro: "Translate the speech in your video between English, French, German, Spanish and Italian, in any direction, said again in your own voice over the video's own music and sounds. French, German, Spanish and Italian captions are now faster and more accurate. All of it runs on your computer.",
    // English, French, German, Spanish, Italian - in this order.
    languages: ["English", "French", "German", "Spanish", "Italian"],
    yourVoice: "Your voice",
    yourVoiceDetail: "Recorded once, in any of the five",
    stats: [
      { value: "20", label: "language pairs, in any direction" },
      { value: "4–5×", label: "faster captions in French, German, Spanish and Italian" },
      { value: "−44%", label: "fewer wrong words in Italian captions, −27% in German" },
      { value: "0", label: "uploads: translation, voice and captions run on your PC" },
    ],
    fastVoice: "New Fast voice: about ten times quicker and light enough for everyday laptops. Stronger computers can pick Accurate, for a voice even closer to yours in English.",
    download: "Download free",
    changelog: "See what's new",
    footnote: "Measured on public test recordings on a 6-core laptop. Results depend on your recording and your computer.",
  },

  whatsNew: {
    badge: "New",
    title: "Big updates, ",
    titleHighlight: "just landed",
    intro: "Everything in the latest desktop update. The app updates itself and shows these notes after each update. Free on Windows and Mac.",
    strip: ["Latest update", "Free", "Windows & Mac", "Updates itself"],
    // Under the notes, which come from desktop/release-notes.json in English.
    notesInEnglish: "",
    download: "Get the latest version",
    changelog: "See every update",
  },

  featureTour: {
    badge: "See it in action",
    title: "Record, polish, ",
    titleHighlight: "publish",
    intro: "A quick tour of what the recorder and editor do for you. Pick a feature, or let it play.",
    seeAll: "See every feature",
  },
  desktopPromo: {
    badge: "Free for Windows & Mac",
    title: "Record it, then ",
    titleHighlight: "finish the edit",
    intro:
      "The WipeClip desktop app puts a screen recorder and a lightweight video editor in one place. Capture your screen, cut it down, add zooms, captions, transitions and stickers, and export at your original aspect ratio and frame rate.",
    highlights: [
      "Record screen, audio and webcam",
      "Automatic zooms on clicks",
      "Trim, split and reorder clips",
      "Transitions, text and stickers",
      "Auto captions from speech",
      "Export at original quality",
    ],
    sticker: "SUBSCRIBE",
  },

  toolCatalog: {
    badges: { desktop: "New", free: "Free", pro: "Pro" },
    availability: { free: "Free in browser", pro: "Pro, in browser", desktop: "Windows & Mac app" },
    items: {
      "/download": {
        title: "Desktop Video Editor & Screen Recorder",
        desc: "Record your screen, trim, split and reorder clips, add transitions, text and auto captions. Free for Windows and Mac.",
      },
      "/extract-video-frame": {
        title: "Video Frame Grabber",
        desc: "Scrub to any moment and save it as a PNG, up to full resolution. Runs in your browser; nothing is uploaded.",
      },
      "/remove-background": {
        title: "Background Remover",
        desc: "Upload a photo and get a transparent PNG back. No region to mark, no account needed to preview.",
      },
      "/sharpen-image": {
        title: "Photo Sharpener",
        desc: "Restore crisp detail to a soft or slightly blurry photo with light, standard or strong strength.",
      },
    } as Record<string, { title: string; desc: string }>,
  },

  freeTools: {
    badge: "The Full Toolkit",
    title: "More than ",
    titleHighlight: "video editing",
    intro: "Everything else you need for the same footage and photos: a full desktop video editor, plus three free tools with no account required to try.",
    tryIt: "Try it",
    seeAll: "See every tool and where it runs",
  },

  homeFaq: {
    badge: "Frequently Asked Questions",
    title: "Got questions? We've got answers.",
    items: [
      {
        q: "What is WipeClip?",
        a: "WipeClip is a free screen recorder and video editor for Windows and Mac. It records your screen, system audio, microphone and webcam as separate tracks, zooms in on your clicks automatically, finds pauses to cut, writes captions on your own computer, and exports at your original quality.",
      },
      {
        q: "Is WipeClip free?",
        a: "Yes. Recording and editing are free, with free credits that renew every day. Optional one-time passes, from {price} for {days} days, add premium transitions, filters and effects, exports up to 4K and more credits. Passes don't renew automatically.",
      },
      { q: "Which computers does WipeClip run on?", a: "{systems}" },
      {
        q: "What can I do in the editor?",
        a: "The WipeClip desktop app for Windows and Mac lets you record your screen, trim, split and remove sections, reorder clips, add transitions, text, stickers, music and auto captions, and layer clips picture-in-picture, then export at your original aspect ratio and frame rate.",
      },
      {
        q: "Do I need to install anything?",
        a: "Yes. The editor is a free desktop app for Windows and Mac. Download it from wipeclip.co/download. Your projects are saved on your own computer so you can pick up where you left off.",
      },
      { q: "What is the maximum file size?", a: "Clips up to 300MB are supported on the free plan." },
      {
        q: "Do you store or use my video files?",
        a: "No. Editing happens on your computer. Files uploaded for export are processed in temporary storage and deleted once your result is ready.",
      },
      {
        q: "Will you process explicit or adult content?",
        a: "No. Every upload is automatically screened before processing, and clips flagged as explicit or abusive are immediately rejected.",
      },
    ],
    more: "Full details available in our {terms}, {privacy}, and {dmca}.",
    terms: "Terms of Service",
    privacy: "Privacy Policy",
    dmca: "Copyright Policy",
  },

  cta: {
    title: "Your next video, ",
    titleHighlight: "edited in minutes",
    intro: "Free for Windows and Mac. Record your screen or drop in a clip, trim, add captions and export in any format.",
    button: "Download Free",
    cutout: "Just need a clean cutout instead? ",
    cutoutLink: "Try the free background remover",
  },

  about: {
    meta: {
      title: "About WipeClip - Video Editor for Windows and Mac",
      description:
        "What WipeClip is: a desktop video editor and screen recorder for Windows and Mac, with auto captions and free photo tools, and how your files are handled.",
    },
    badge: "About WipeClip",
    h1: "A video editor for creators, ",
    h1Highlight: "on Windows and Mac",
    intro:
      "WipeClip is a desktop video editor for creators: trim, cut, add transitions, text, music and stickers, and export for any platform. It also generates captions from speech and comes with free photo tools: a background remover, a photo sharpener and a video frame grabber.",
    download: "Download the app",
    stats: [
      { value: "0", label: "files stored" },
      { value: "300MB", label: "per upload" },
      { value: "Full", label: "source resolution kept" },
      { value: "Win + Mac", label: "desktop app" },
    ],
    believe: "What we believe",
    principles: [
      { title: "Edit on your desktop", desc: "A free app for Windows and Mac. Record, trim, cut, caption and export, and your projects stay on your computer." },
      { title: "Your own content", desc: "Built for creators editing video and photos they made themselves or have the rights to edit." },
      { title: "Nothing kept", desc: "Files uploaded for export or the photo tools are processed in temporary storage and deleted when the job finishes." },
      { title: "Original quality", desc: "Exports keep your aspect ratio and frame rate, and nothing is upscaled unless you pick a larger size." },
    ],
    onThisPage: "On this page",
    sectionPrivacy: "Privacy",
    howTitle: "How WipeClip works",
    howSteps: [
      "Download the free app for Windows or Mac and record your screen, or open a video you already have.",
      "WipeClip suggests zooms on your clicks, finds pauses and retakes to cut, and writes captions on your computer.",
      "Finish the edit with transitions, text, stickers, music and filters.",
      "Export at your original quality in landscape, vertical or square.",
    ],
    facts: {
      what: "What it is",
      whatValue: "Screen recorder and video editor",
      runsOn: "Runs on",
      price: "Price",
      priceValue: "Free; optional passes from {price}",
      madeBy: "Made by",
      madeByValue: "Codeplay Studios, Sri Lanka",
      contact: "Contact",
    },
  },

  privacyProcessing: {
    badge: "Privacy & Processing",
    title: "What happens to your file",
    points: [
      "Your video is sent to our processing backend only for the duration of your request.",
      "It's held in a temporary location and deleted immediately once your result is returned. We don't keep a copy afterward.",
      "We don't use uploaded media to train any model.",
    ],
    more: "Full details in our {privacy} and {terms}.",
    privacy: "Privacy Policy",
    terms: "Terms of Service",
  },

  toolGuide: { factsTitle: "At a glance" },

  downloadPage: {
    meta: {
      title: "Download WipeClip: Free Screen Recorder & Video Editor",
      description:
        "Free screen recorder and video editor for Windows and macOS. Automatic zooms on every click, one-pass pause cutting, on-device captions and full-quality export.",
      ogTitle: "WipeClip for Windows & Mac",
      ogDescription: "Record your screen, get automatic zooms on every click, cut the pauses and export a polished tutorial. Free to download.",
    },
    badge: "Free desktop app for Windows & Mac",
    h1: "Screen recordings that ",
    h1Highlight: "edit themselves",
    intro:
      "Record your screen, and WipeClip zooms in on every click, finds the pauses to cut and writes the captions. Then finish the edit with transitions, text and music, and export at full quality.",
    stats: [
      { value: "4", label: "tracks recorded separately" },
      { value: "1 click", label: "to cut every pause" },
      { value: "3", label: "subtitle formats" },
      { value: "0", label: "uploads while you edit" },
    ],
    onlyBadge: "Only in the desktop app",
    onlyTitle: "From raw recording to ",
    onlyTitleHighlight: "finished tutorial",
    onlyIntro: "The recorder knows where you clicked and what you said, so the editor can do the boring parts for you.",
    spotlights: {
      recorder: {
        eyebrow: "Screen recorder",
        title: "Record once, ",
        titleHighlight: "fix anything later",
        desc: "Capture your whole screen, one window or an area you draw. Screen, system audio, microphone and webcam are saved as separate tracks, so a loud notification or a cough is a quick fix instead of a re-record.",
        points: [
          "Pause, resume and drop markers while you record",
          "A small floating control window that never shows up in the video (Windows)",
          "Mouse and keyboard activity logged for zooms, click rings and shortcut labels",
          "Saved to your own disk and recovered if something crashes mid-take",
        ],
      },
      focus: {
        eyebrow: "Automatic focus zooms",
        title: "Zooms that follow ",
        titleHighlight: "every click",
        desc: "WipeClip reads where you clicked and typed and suggests smooth zooms on exactly the right spot. Pick a preset, preview, then nudge any zoom on its own track. No keyframes to set by hand.",
        points: [
          "Subtle, balanced or dynamic zoom presets",
          "Click highlights and a smooth, resizable cursor",
          "Zooms stay locked to their moment when you trim, split or change speed",
          "Everything is undoable and saved with your project",
        ],
      },
      review: {
        eyebrow: "Tutorial review",
        title: "Cut the umms, ",
        titleHighlight: "keep the flow",
        desc: "One pass over your recording finds long pauses, dead time where nothing happens, repeated clicks and takes you did twice. Cut them one by one or all at once, and everything after stays in sync.",
        points: [
          "Silence detection tuned to your own mic and room noise",
          "Possible retakes spotted from repeated click sequences",
          "Record a retake and drop it straight over the bad section",
          "Analysis runs on your computer, nothing is uploaded",
        ],
      },
      tutorial: {
        eyebrow: "Captions, privacy & annotations",
        title: "Everything a tutorial needs, ",
        titleHighlight: "built in",
        desc: "Generate captions from your voice on your own computer, blur an email address or password that slipped into a shot, and point viewers at the right button with arrows, numbered steps and callouts.",
        points: [
          "On-device captions with styles, plus .srt, .vtt and transcript export",
          "Blur, pixelate or block out any area, even one that follows the cursor",
          "Keyboard shortcut labels added from what you actually pressed",
          "Chapters suggested for you, ready to paste into a description",
        ],
      },
    },
    stepsTitle: "Four steps, ",
    stepsTitleHighlight: "minutes not hours",
    steps: [
      { title: "Record", desc: "Screen, window or area, with audio, mic and webcam." },
      { title: "Auto-zoom", desc: "Accept the suggested zooms or tweak them." },
      { title: "Review", desc: "Cut pauses and dead time, add captions." },
      { title: "Export", desc: "Save an MP4 and subtitles straight to your disk." },
    ],
    editingTitle: "And a full editor for ",
    editingTitleHighlight: "everything else",
    editingIntro: "Works on any MP4, MOV or WebM, not just your recordings.",
    editing: {
      trim: { title: "Trim, split, reorder", desc: "Cut dead air and drag clips into a new order. No gaps, no audio drift." },
      transitions: { title: "Transitions", desc: "Fade, slide, zoom and blur, rendered into the final video." },
      text: { title: "Text & stickers", desc: "Titles, lower thirds, stickers and your own images, animated." },
      music: { title: "Music & voice-over", desc: "Extra audio tracks with volume, fades and clean mixing." },
      filters: { title: "Filters & effects", desc: "Color looks, adjustment sliders and timed effects." },
      aspect: { title: "Any aspect ratio", desc: "Landscape, vertical, square or portrait from one edit." },
      autosave: { title: "Autosave & undo", desc: "Every change is undoable and your project reopens where you left it." },
      quality: { title: "Original quality", desc: "Exports keep your resolution and frame rate, up to 4K." },
    },
    privacyTitle: "Your recordings stay on your computer",
    privacyBody:
      "Recording, editing, pause detection and captions all run locally. A video only leaves your machine when you export it, and it's processed in temporary storage and deleted right after. Your sign-in is kept in your system's secure credential store.",
    getTitle: "Get WipeClip ",
    getTitleHighlight: "free",
    getIntro: "No credit card, no trial timer. Upgrade only if you want premium effects and 4K.",
    faqTitle: "Desktop app FAQ",
    faqs: [
      {
        q: "Is the WipeClip app free?",
        a: "Yes. The app is free to download, record and edit with. Signing in unlocks full-resolution exports, which use credits like the rest of WipeClip. Free credits renew daily, and paid passes add premium effects and 4K.",
      },
      { q: "Which systems are supported?", a: "{systems}" },
      {
        q: 'Why does Windows say "Windows protected your PC"?',
        a: "Windows and Edge warn about new apps they haven't seen many downloads of yet. In Edge's downloads list, click ⋯ > Keep > Show more > Keep anyway. When the installer opens, click More info > Run anyway. Once installed, the app updates itself.",
      },
      {
        q: "Is there still an online editor?",
        a: "No. The video editor now lives in the desktop app, alongside the screen recorder, focus zooms and on-device captions. The free photo tools on this site still run in your browser.",
      },
      {
        q: "Are my recordings uploaded?",
        a: "No. Recordings are saved to a folder on your computer, and recording, editing, analysis and captions all happen there. A video is only uploaded when you export, is processed in temporary storage and isn't kept.",
      },
      {
        q: "Does it work offline?",
        a: "Recording, editing, pause detection and captions work offline once the speech model has been downloaded (you're asked before it downloads). Exporting needs an internet connection.",
      },
      {
        q: "Can I edit videos I didn't record in WipeClip?",
        a: "Yes. Drop in an MP4, MOV or WebM and use every editing tool. Focus zooms, click highlights and shortcut labels need the mouse and keyboard data that WipeClip's own recorder saves.",
      },
    ],
    legal: "For videos you own or have permission to edit. See our {terms} and {privacy}.",
    terms: "Terms of Service",
    privacy: "Privacy Policy",
  },

  toolsPage: {
    title: "Free Video and Photo Tools",
    description:
      "Every WipeClip tool in one place: a free screen recorder and video editor for Windows and Mac, plus browser tools to grab video frames, remove backgrounds and sharpen photos.",
    home: "Home",
    crumb: "Free tools",
    eyebrow: "The full toolkit",
    h1: ["Free ", "video and photo", " tools"],
    intro: "A screen recorder and video editor you install, plus quick tools that run in your browser. The badge on each says where it runs.",
    sections: {
      video: { heading: "Video", intro: "Record and edit in the desktop app, or pull a still frame out of any clip in your browser." },
      image: {
        heading: "Photos and images",
        intro: "Browser tools for photos. Each gives one free reduced-size result a day; full resolution costs 1 credit, and every account gets 2 free credits a day.",
      },
    },
  },

  relatedTools: { title: "More tools", readMore: "Read more: ", seeAll: "See all free tools" },

  toolPages: {
    removeBackground: {
      title: "Remove Background From Image - Free",
      description: "Upload a photo and get a transparent-background PNG back in seconds. One free result a day, no account needed.",
      badge: "Free Tool",
      h1: ["Remove the ", "background", " from any photo"],
      intro: "Upload a photo, get a transparent PNG back. No region to mark, no account needed to preview. Just drop the subject onto whatever background you need next.",
      guideTitle: "How to remove a background from a photo",
      steps: [
        "Drop a JPG, PNG or WebP photo (up to 25MB) onto the upload box, or click it to pick a file.",
        "WipeClip finds the subject automatically. There is nothing to trace or mark.",
        "Check the cut-out preview against the transparent checkerboard.",
        "Download the result as a PNG with a transparent background and place it on any new background.",
      ],
      facts: [
        { label: "Output", value: "PNG with transparency" },
        { label: "Max upload", value: "25MB per image" },
        { label: "Free", value: "1 cutout a day, reduced size" },
        { label: "Signed in", value: "Full resolution, 1 credit per image" },
        { label: "Free credits", value: "2 a day, every account" },
      ],
      faqTitle: "Background removal: FAQ",
      faqs: [
        {
          q: "Is this actually free?",
          a: "Yes. Everyone gets one free cutout a day at a reduced size, no account needed. For the full-resolution result, sign in: it costs 1 credit, and every account gets 2 free credits a day.",
        },
        {
          q: "What file types come out?",
          a: "A PNG with a transparent alpha channel, so you can drop the subject straight onto a new background, a product page, or a slide.",
        },
        {
          q: "Will edges look rough on hair or fine detail?",
          a: "The pipeline runs edge decontamination and alpha smoothing after the initial cut specifically to clean up halos and rough edges around fine detail, not just a flat cutout mask.",
        },
        {
          q: "Do I need to sign in to get a full-resolution PNG?",
          a: "Yes. The free daily cutout comes back at a reduced size. Signed in, you can get any image at its original resolution for 1 credit, and every account gets 2 free credits a day.",
        },
        { q: "Do you keep my photo?", a: "No. The photo is processed to make your PNG and then deleted. It is never used to train any model." },
      ],
    },
    sharpenImage: {
      title: "Sharpen a Blurry Photo - Free",
      description:
        "Restore crisp detail to a soft or slightly blurry photo in seconds. One free result a day, no account needed. Pick light, standard, or strong strength.",
      badge: "Free Tool",
      h1: ["Sharpen a ", "soft or blurry", " photo"],
      intro: "Upload a photo, pick a strength, get crisper detail back, no account needed to preview.",
      guideTitle: "How to sharpen a soft photo",
      steps: [
        "Drop a JPG, PNG or WebP photo (up to 25MB) onto the upload box, or click it to pick a file.",
        "Pick a strength: Light for skin and sky, Standard for most photos, Strong for photos that still look soft.",
        "Compare the result with the original side by side.",
        "Download the sharpened photo. It keeps the same pixel dimensions as your upload.",
      ],
      facts: [
        { label: "Strengths", value: "Light, Standard, Strong" },
        { label: "Max upload", value: "25MB per image" },
        { label: "Free", value: "1 photo a day, reduced size" },
        { label: "Full resolution", value: "1 credit per photo, 2 free credits a day" },
      ],
      faqTitle: "Photo sharpening: FAQ",
      faqs: [
        {
          q: "Will this fix a badly blurry or out-of-focus photo?",
          a: "No. This restores local contrast and edge detail on a photo that's already reasonably sharp but looks a little soft (a common side effect of compression or resizing). It can't reconstruct detail that was never captured, so heavy motion blur or an out-of-focus shot won't come back sharp.",
        },
        {
          q: "Does this upscale the image resolution?",
          a: "No. Output is the same pixel dimensions as your upload. This adds clarity/detail contrast at the existing resolution, it doesn't add resolution.",
        },
        {
          q: "What's the difference between Light, Standard, and Strong?",
          a: "How aggressively local contrast is boosted around detected edges. Standard suits most photos; Light avoids over-sharpening delicate detail like skin or sky; Strong is for photos that still look soft after Standard.",
        },
        {
          q: "Is this free?",
          a: "Yes. Everyone gets one free sharpened photo a day at a reduced size, no account needed. For the full-resolution result, sign in: it costs 1 credit, and every account gets 2 free credits a day.",
        },
        { q: "Do you keep my photo?", a: "No. The photo is processed to make your result and then deleted. It is never used to train any model." },
      ],
    },
    extractVideoFrame: {
      title: "Extract a Frame From Video - Free Screenshot Tool",
      description:
        "Grab any frame from a video as a PNG screenshot or thumbnail. Runs entirely in your browser: no upload. One free low-resolution download a day, full resolution for 1 credit.",
      badge: "Free Tool • No Upload",
      h1: ["Extract a ", "frame", " from any video"],
      intro: "Scrub to the moment you want and capture it as a PNG, up to full resolution. Runs entirely in your browser. Your video is never uploaded.",
      guideTitle: "How to save a frame from a video",
      steps: [
        "Open a video your browser can play (MP4 or WebM, up to 500MB). It stays on your device.",
        "Scrub to the moment you want, or pick one of the suggested cover frames WipeClip finds by scanning the video.",
        "Capture the frame. Grab as many as you like.",
        "Download a frame free at a reduced size once a day, or at full resolution for 1 credit.",
      ],
      facts: [
        { label: "Output", value: "PNG, up to the video's own resolution" },
        { label: "Max video size", value: "500MB" },
        { label: "Upload", value: "None, runs in your browser" },
        { label: "Free", value: "1 low-resolution download a day" },
        { label: "Full resolution", value: "1 credit per frame, sign-in needed" },
      ],
      faqTitle: "Frame extraction: FAQ",
      faqs: [
        {
          q: "Does this upload my video anywhere?",
          a: "No. The video is decoded and drawn to a canvas entirely inside your browser tab using standard HTML5 video/canvas APIs. It's never sent to WipeClip.co's servers, so there's no upload wait. Videos up to 500MB in a format your browser can play (usually MP4 or WebM) work.",
        },
        {
          q: "Is there a limit on how many frames I can grab?",
          a: "Capture and preview as many frames as you like. Downloading is where the limit is: one free low-resolution frame a day, and each full-resolution frame costs 1 credit. Every account gets 2 free credits a day.",
        },
        {
          q: "What resolution is the exported frame?",
          a: "A full-resolution download is a PNG at the video's native resolution: the canvas is sized to the video's actual width and height before export. The free daily download is scaled down to about 0.25 megapixels.",
        },
        {
          q: "What if I need to edit the whole clip?",
          a: "This tool grabs a single still frame. To trim, cut, caption or rearrange the whole clip, use WipeClip.co's free video editor for Windows and Mac.",
        },
      ],
    },
  },

  feedbackPage: {
    title: "Feedback & Bug Reports",
    description:
      "Report a bug, request a feature, or tell us what you think of WipeClip.co. Signed-in users can track the status of everything they've sent.",
    h1: "Feedback & ",
    h1Highlight: "bug reports",
    intro: "Something broke, a result looked wrong, or there's a feature you wish we had? Tell us here. Every message is read by a person.",
  },

  pricingPage: {
    title: "Pricing: Free Video Editor, Passes From {price}",
    description:
      "WipeClip is free forever. Optional one-time passes from {price} for 30 days add premium effects, 4K exports and more AI credits. No subscription.",
    ogTitle: "WipeClip.co Pricing: Free & Paid Plans",
    ogDescription: "Free video editor for Windows and Mac. Upgrade for premium effects, 4K exports and more AI credits.",
    faqTitle: "Pricing questions",
    faqs: [
      {
        q: "Is WipeClip free?",
        a: "Yes. The screen recorder and video editor are free to download and use, and every account gets 2 free credits a day. Paid passes are optional.",
      },
      {
        q: "How much do the paid plans cost?",
        a: "For 30 days: Lite {lite}, Starter {starter}, Pro {pro}. For 1 year: Lite {liteYearly}, Starter {starterYearly}, Pro {proYearly}. These are the US dollar list prices; the cards above and checkout show your price in your local currency, such as euros or pounds, with any local tax included.",
      },
      {
        q: "Do prices include VAT?",
        a: "Yes. If you're in the UK or the EU, the price you see at checkout already includes VAT for your country, so there's nothing extra to pay. You get a receipt by email after every purchase.",
      },
      {
        q: "Is this a subscription?",
        a: "No. Every plan is a one-time payment for 30 days or 1 year and doesn't renew automatically. When it ends, your account goes back to the free plan and you can buy again whenever you like.",
      },
      {
        q: "What do paid plans add?",
        a: "Premium transitions, filters and effects, karaoke captions, voice effects, auto-ducking and webcam background replace (from Lite); green screen, blend modes, speed curves, masks, LUTs, curves, stabilization, and GIF, audio-only, high-quality and 60 fps exports (from Starter); 4K and custom fonts (Pro); longer voice translation, unlimited audio clean up, Draft for long recordings and more credits for the AI tools. Recording, captions in every language, 1080p exports in the desktop app, keyframes, voiceovers, sound effects and everyday editing stay free.",
      },
      {
        q: "What happens if I buy again before my plan ends?",
        a: "Buying the same plan again adds its days to the end of your current pass, so you never lose the time you already paid for.",
      },
      {
        q: "Can I get a refund?",
        a: "Yes. You can ask for a full refund of any purchase within 14 days, for any reason. A refunded plan ends straight away and its credits are removed.",
      },
    ],
    passPrice: "{price} ({n} credits)",
    more: "Full details in the {refund} and {terms}.",
    refund: "refund policy",
    terms: "terms",
  },

  signInPage: { title: "Sign In", description: "Sign in to your WipeClip.co account." },

  profile: {
    title: "Your Profile",
    h1: "Your profile",
    plans: { free: "Free", lite: "Lite", starter: "Starter", pro: "Pro" } as Record<string, string>,
    links: {
      download: { title: "Desktop App", desc: "Record, edit and export on Windows or Mac." },
      history: { title: "Job History", descPro: "Your usage and billing log.", descFree: "Usage and billing log - a Pro feature." },
      referrals: { title: "Refer a Friend", desc: "Share your link and earn credits." },
    },
    proBadge: "Pro",
    credits: "Credits",
    buyCredits: "Buy credits",
    freeCredits: "Free credits",
    renews: "Renews to {n} every day",
    purchased: "Purchased credits",
    usedAfter: "Used after free credits",
    plan: "Plan",
    upgrade: "Upgrade for more credits and Pro features.",
    activeUntil: "Active until {date}",
    trialUntil: "Free Pro trial in the desktop app until {date}",
    active: "Active",
    seePlans: "See plans",
    managePlan: "Manage plan",
    account: "Account",
    email: "Email",
    method: "Sign-in method",
    memberSince: "Member since",
    changePassword: "Change password",
    signOut: "Sign out",
  },

  history: {
    title: "Job History",
    intro:
      "A usage/billing log of what you've run and what it cost. This isn't a place to re-download past outputs. Files were never stored on our servers, only streamed to your browser at process time.",
    empty: "No processing history yet.",
    imageJob: "Image job",
    videoJob: "Video job",
    refunded: "Refunded",
    credit: "{n} credit",
    credits: "{n} credits",
  },

  referrals: {
    title: "Refer a Friend",
    notSetUp: "Referrals aren't set up yet",
    notSetUpBody:
      "The referral program's database functions haven't been run against this project yet. Run the referral-program additions in supabase/schema.sql via the Supabase SQL Editor, then reload this page.",
    h1: ["Give ", "5 credits", ", get ", "5 credits"],
    intro: "Share your link. When someone signs up through it, you both get 5 bonus credits, no limit on how many friends you refer.",
    referred: "You joined via someone else's referral link. Thanks for signing up!",
  },

  welcomePage: {
    title: "Welcome",
    h1: "Thanks, your payment went through",
    intro: "Your plan and AI credits are being added to your account and should appear within a minute. A receipt is on its way to your email.",
    download: "Download the app",
    viewPlan: "View your plan",
  },
};

export default en;
