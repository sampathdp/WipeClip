export type WatermarkPlatform = {
  slug: string;
  platform: string;
  metaTitle: string;
  metaDescription: string;
  heroEyebrow: string;
  heroSubtitle: string;
  behavior: string;
  whyRemove: string;
  faqs: { q: string; a: string }[];
};

export const WATERMARK_PLATFORMS: WatermarkPlatform[] = [
  {
    slug: "remove-tiktok-watermark",
    platform: "TikTok",
    metaTitle: "Remove TikTok Watermark From Video — Free",
    metaDescription:
      "Strip the rotating TikTok logo and @username stamp from any clip you exported. Motion-aware inpainting tracks the drifting badge frame by frame — no blur box, no crop.",
    heroEyebrow: "TikTok Watermark Remover",
    heroSubtitle:
      "TikTok exports carry a small rotating logo plus your @username, and it drifts to a different corner as the clip plays. WipeClip.co tracks that motion and reconstructs the pixels underneath, frame by frame.",
    behavior:
      "When you download a clip from TikTok, the app burns in a spinning \"tiktok\" mark and the uploader's @username, usually anchored near a corner but nudged frame to frame so it never fully overlaps the subject. That movement is exactly why a static blur box or crop looks obviously edited: the badge keeps drifting out from under it. WipeClip.co's motion-aware inpainting follows the badge's path across frames instead of masking one fixed region.",
    whyRemove:
      "Most people hit this when they want to repurpose their own TikTok footage — reposting an edit to another platform, cutting it into a longer video, or handing clean footage to a client — without TikTok's badge riding along in the corner of every frame.",
    faqs: [
      {
        q: "Is removing my own TikTok watermark against TikTok's rules?",
        a: "TikTok's terms govern how you use content on TikTok's own platform, not what you do with your own exported footage afterward. WipeClip.co is built for clips you own or have permission to edit — if you plan to repost the result back onto TikTok or another platform, check that platform's own terms of service, and see our Terms of Service.",
      },
      {
        q: "Why does a normal blur or crop tool leave part of the logo visible?",
        a: "TikTok's export doesn't keep the badge in one fixed spot — it moves slightly frame to frame. A static blur box sized for frame one is misaligned by frame thirty. Motion-aware inpainting re-targets the region on every frame instead of once.",
      },
      {
        q: "Will the rest of the video lose quality?",
        a: "No. Only the marked region is reconstructed; everything else is passed through at your source resolution and framerate, exported at a visually lossless bitrate.",
      },
    ],
  },
  {
    slug: "remove-capcut-watermark",
    platform: "CapCut",
    metaTitle: "Remove CapCut Watermark From Video — Free",
    metaDescription:
      "Clean up the \"Made with CapCut\" badge that free exports stamp in the corner. Upload, mark it once, download the clean version — no CapCut Pro subscription needed.",
    heroEyebrow: "CapCut Watermark Remover",
    heroSubtitle:
      "CapCut's free export stamps a \"Made with CapCut\" wordmark into the corner of every clip. Mark it once and WipeClip.co rebuilds the background underneath for the whole video.",
    behavior:
      "CapCut's free tier adds a small \"Made with CapCut\" wordmark, usually bottom-left or bottom-center, to every export — it's a static badge rather than a moving one, but it still sits on top of your footage in every single frame from start to finish. It's easy to miss until you're reviewing a finished export and notice it in the corner of a shot you meant to hand off clean.",
    whyRemove:
      "Common case: you finished editing in CapCut, exported, and only afterward needed a clean master for a client, another platform, or a longer edit — without paying for CapCut Pro just to re-export one clip without the badge.",
    faqs: [
      {
        q: "Does this replace CapCut Pro?",
        a: "No — CapCut Pro removes its own watermark at export time going forward, which is the right call if you're exporting from CapCut regularly. WipeClip.co is for cleaning up a clip you've already exported without a subscription, or a one-off you don't want to re-cut in CapCut at all.",
      },
      {
        q: "The CapCut badge doesn't move like some app watermarks — is it still hard to remove?",
        a: "It's actually more predictable to remove than a drifting badge since the region stays in the same place across frames, but the background under it still needs to be reconstructed convincingly for every frame rather than covered — which is what the inpainting handles.",
      },
      {
        q: "What file size and formats are supported?",
        a: "Clips up to 300MB in MP4, MOV, or WebM on the free plan, exported at your source resolution and framerate.",
      },
    ],
  },
  {
    slug: "remove-canva-watermark",
    platform: "Canva",
    metaTitle: "Remove Canva Watermark From Video — Free",
    metaDescription:
      "Take the Canva logo badge out of a free-tier video export without upgrading to Canva Pro. Mark the region once, WipeClip.co reconstructs the rest.",
    heroEyebrow: "Canva Watermark Remover",
    heroSubtitle:
      "Canva's free video exports append a small Canva logo badge to a corner of the frame. Mark it once and WipeClip.co reconstructs the background underneath across every frame.",
    behavior:
      "Free-tier Canva video exports append a small Canva logo badge, typically in a bottom corner, on top of the finished render. Because it's part of the exported file rather than an overlay you control in the editor, the only way to remove it after the fact — short of re-exporting from a paid plan — is to reconstruct the pixels it's covering.",
    whyRemove:
      "Usually comes up when a video was already exported on the free plan — for a client deliverable, a social post, or reuse elsewhere — and going back to re-render from a Canva Pro seat isn't practical for a single clip.",
    faqs: [
      {
        q: "Will this affect Canva's design elements or text inside the video?",
        a: "No — you choose exactly which region to mark, so only that area is reconstructed. Everything else in the frame passes through unchanged.",
      },
      {
        q: "Do I need a Canva account to use this?",
        a: "No. You just need the exported video file — WipeClip.co works on any MP4, MOV, or WebM clip, regardless of what created it.",
      },
      {
        q: "Is the output good enough for reposting or client delivery?",
        a: "Yes — output preserves your source resolution and framerate at a visually lossless export bitrate, so it holds up for both.",
      },
    ],
  },
  {
    slug: "remove-instagram-watermark",
    platform: "Instagram",
    metaTitle: "Remove Instagram Watermark From Video — Free",
    metaDescription:
      "Remove the Instagram logo and @username overlay baked into Reels or Stories you've saved. Mark the region once, WipeClip.co reconstructs the frame beneath it.",
    heroEyebrow: "Instagram Watermark Remover",
    heroSubtitle:
      "Video saved from Instagram Reels or Stories carries the Instagram logo and your @handle burned into the frame. WipeClip.co reconstructs the pixels underneath so you can reuse the clip cleanly.",
    behavior:
      "When you save a Reel or Story from Instagram — including your own — the app's own share/download pipeline burns the Instagram logo and the poster's @handle directly into the video file. It's not an overlay layer you can toggle off; it's baked into every frame of the exported file, in a fixed corner for the length of the clip.",
    whyRemove:
      "Typical case: reusing your own Reel across other platforms, in a longer edit, or as raw footage for something else, without Instagram's badge and handle riding along on every frame.",
    faqs: [
      {
        q: "Can I use this on any Instagram video I find?",
        a: "No — only on content you own or have explicit permission to edit, such as your own Reels or footage a client has authorized you to repurpose. WipeClip.co is not designed or intended for stripping attribution from other creators' work; see our Terms of Service.",
      },
      {
        q: "Does the badge move around the frame like some platforms?",
        a: "It stays fixed in one corner for the clip's duration, but the background behind it still has to be reconstructed rather than blurred or cropped out to look clean.",
      },
      {
        q: "What's the maximum clip length or size?",
        a: "Up to 300MB per file on the free plan — comfortably enough for a full-length Reel or Story.",
      },
    ],
  },
  {
    slug: "remove-snapchat-watermark",
    platform: "Snapchat",
    metaTitle: "Remove Snapchat Watermark From Video — Free",
    metaDescription:
      "Strip the Snapchat ghost logo and @username stamp from a saved Snap or Story. Motion-aware inpainting tracks the badge frame by frame — no blur box, no crop.",
    heroEyebrow: "Snapchat Watermark Remover",
    heroSubtitle:
      "A saved Snap or Story carries the Snapchat ghost icon and your @username burned into the video. WipeClip.co reconstructs the pixels underneath so you can reuse the clip cleanly.",
    behavior:
      "When you save a Snap or Story — including your own — Snapchat's save pipeline stamps the ghost logo and the poster's @username directly into the exported file, usually anchored near a corner for the length of the clip. It's not a toggleable overlay; it's baked into every frame of the file you're left with.",
    whyRemove:
      "Typical case: reusing your own Snap across other platforms, in a longer edit, or as raw footage for something else, without Snapchat's ghost badge and handle riding along on every frame.",
    faqs: [
      {
        q: "Can I use this on any Snap I saved?",
        a: "Only on content you own or have explicit permission to edit, such as your own Snaps or footage a client has authorized you to repurpose. WipeClip.co is not designed or intended for stripping attribution from other creators' work; see our Terms of Service.",
      },
      {
        q: "Does the ghost logo move around the frame?",
        a: "It stays fixed in one spot for the clip's duration, but the background behind it still has to be reconstructed rather than blurred or cropped out to look clean.",
      },
      {
        q: "Will the rest of the video lose quality?",
        a: "No. Only the marked region is reconstructed; everything else is passed through at your source resolution and framerate, exported at a visually lossless bitrate.",
      },
    ],
  },
  {
    slug: "remove-facebook-watermark",
    platform: "Facebook",
    metaTitle: "Remove Facebook Watermark From Video — Free",
    metaDescription:
      "Remove the Facebook wordmark burned into a Reel or video you downloaded from your own account. Mark the region once, WipeClip.co reconstructs the rest.",
    heroEyebrow: "Facebook Watermark Remover",
    heroSubtitle:
      "Downloading a Facebook Reel or video stamps the Facebook wordmark and your page/profile name into the file. WipeClip.co reconstructs the pixels underneath across every frame.",
    behavior:
      "Facebook's own download/save feature for Reels and videos — sharing the same underlying pipeline as Instagram Reels — burns a small Facebook wordmark and the poster's name into a corner of the exported file, for the full duration of the clip.",
    whyRemove:
      "Common case: pulling your own Reel or video back down from Facebook to repurpose it — a longer edit, another platform, a client deliverable — without the Facebook badge riding along in the corner.",
    faqs: [
      {
        q: "Is this only for content I posted myself?",
        a: "Yes — WipeClip.co is built for clips you own or have permission to edit. See our Terms of Service before processing anything you didn't post yourself.",
      },
      {
        q: "Why not just blur or crop the corner?",
        a: "A static blur or crop looks obviously edited and can still clip real content near the badge. Motion-aware inpainting reconstructs just the marked region using the surrounding frames instead.",
      },
      {
        q: "What file size and formats are supported?",
        a: "Clips up to 300MB in MP4, MOV, or WebM on the free plan, exported at your source resolution and framerate.",
      },
    ],
  },
  {
    slug: "remove-kapwing-watermark",
    platform: "Kapwing",
    metaTitle: "Remove Kapwing Watermark From Video — Free",
    metaDescription:
      "Clean up the \"Made with Kapwing\" badge that free exports stamp in the corner. Upload, mark it once, download the clean version — no Kapwing Pro subscription needed.",
    heroEyebrow: "Kapwing Watermark Remover",
    heroSubtitle:
      "Kapwing's free plan stamps a \"Made with Kapwing\" wordmark into the corner of every export. Mark it once and WipeClip.co rebuilds the background underneath for the whole video.",
    behavior:
      "Kapwing's free tier adds a small \"Made with Kapwing\" wordmark, usually bottom-left or bottom-right, to every export — a static badge that sits on top of your footage in every frame from start to finish.",
    whyRemove:
      "Common case: you finished editing in Kapwing, exported, and only afterward needed a clean master for a client, another platform, or a longer edit — without paying for a Pro seat just to re-export one clip.",
    faqs: [
      {
        q: "Does this replace a Kapwing Pro subscription?",
        a: "No — Kapwing Pro removes its own watermark at export time going forward, which is the right call if you're exporting from Kapwing regularly. WipeClip.co is for cleaning up a clip you've already exported without a subscription.",
      },
      {
        q: "The badge doesn't move — is it still hard to remove?",
        a: "It's more predictable to remove than a drifting badge since the region stays in the same place across frames, but the background under it still needs to be reconstructed convincingly for every frame rather than covered.",
      },
      {
        q: "Will the rest of the video lose quality?",
        a: "No. Only the marked region is reconstructed; everything else passes through at your source resolution and framerate, exported at a visually lossless bitrate.",
      },
    ],
  },
  {
    slug: "remove-inshot-watermark",
    platform: "InShot",
    metaTitle: "Remove InShot Watermark From Video — Free",
    metaDescription:
      "Take the InShot logo badge out of a free-tier video export without upgrading to InShot Pro. Mark the region once, WipeClip.co reconstructs the rest.",
    heroEyebrow: "InShot Watermark Remover",
    heroSubtitle:
      "InShot's free exports stamp an InShot logo badge into a corner of the frame. Mark it once and WipeClip.co reconstructs the background underneath across every frame.",
    behavior:
      "Free-tier InShot exports append a small InShot logo badge, typically in a corner, on top of the finished render for the full length of the clip — part of the exported file itself, not a toggleable overlay.",
    whyRemove:
      "Usually comes up when a video was already exported on the free plan — for a client deliverable, a social post, or reuse elsewhere — and re-exporting from a paid seat isn't practical for a single clip.",
    faqs: [
      {
        q: "Will this affect the rest of my edit?",
        a: "No — you choose exactly which region to mark, so only that area is reconstructed. Everything else in the frame passes through unchanged.",
      },
      {
        q: "Do I need the InShot app to use this?",
        a: "No. You just need the exported video file — WipeClip.co works on any MP4, MOV, or WebM clip, regardless of what created it.",
      },
      {
        q: "Is the output good enough for reposting or client delivery?",
        a: "Yes — output preserves your source resolution and framerate at a visually lossless export bitrate, so it holds up for both.",
      },
    ],
  },
];

export function getWatermarkPlatform(slug: string) {
  return WATERMARK_PLATFORMS.find((p) => p.slug === slug);
}
