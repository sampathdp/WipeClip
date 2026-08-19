# Watermark logo references

Drop reference PNGs here to enable known-platform logo matching (see
`app/pipeline/logo_match.py`). Any `*.png` in this directory is picked up
automatically on the backend's next start - nothing else to wire up.

This directory ships empty on purpose: TikTok, CapCut, Instagram Reels,
Shutterstock, Getty, etc. watermarks are someone else's trademarked
assets, not something to bundle in this repo. Source your own (a tight
crop of just the logo, transparent background if you can get one) and add
them here, e.g.:

```
watermark_logos/
  tiktok.png
  capcut.png
  instagram_reels.png
  shutterstock.png
```

The filename (without extension) becomes the candidate's `label` in the
`/api/video/detect-watermark` response and shows up in the frontend's
suggestion text ("Detected a tiktok watermark...").

`LOGO_MATCH_MIN_SCORE` in `app/config.py` is an untuned starting guess -
once you've added real references, test against real downloaded clips and
adjust it (and `LOGO_MATCH_SCALE_MIN`/`_MAX`) if matches are too
sparse/noisy.
