# Research Data Checklist

This is what's needed to turn `/research/video-watermark-removal-test` from a "pending verification" page into a published one. Nothing on the live page should show a number, a clip, or a claim that isn't backed by an entry checked off here.

Add completed tests to `src/lib/researchData.ts`, in `RESEARCH_TESTS`, following the `ResearchTest` type already defined there. Do not add an entry until every field below is real and verified — a partially-filled fake entry is worse than no entry.

## Source clips

- [ ] 720p source video
- [ ] 1080p source video
- [ ] 4K source video

## Test cases (one clip per case, minimum)

- [ ] Static watermark example
- [ ] Moving watermark example
- [ ] Semi-transparent watermark example
- [ ] Complex-background example
- [ ] Fast-motion example
- [ ] Watermark overlapping a person

## Per-test data (repeat for every clip)

- [ ] Test name / short label
- [ ] Test description (what's being tested and why)
- [ ] Watermark type (logo, text, timestamp, badge, etc.)
- [ ] Watermark size (approx. % of frame, or pixel dimensions)
- [ ] Background type (plain, busy/textured, animated, etc.)
- [ ] Camera movement (static, pan, handheld, zoom, etc.)
- [ ] Input resolution
- [ ] Output resolution
- [ ] Input FPS
- [ ] Output FPS
- [ ] Clip duration
- [ ] Processing time (wall-clock, upload start to download — see methodology on the page itself)
- [ ] Before clip/screenshot (actual file, not a description)
- [ ] After clip/screenshot (actual file, not a description)
- [ ] Visible artifacts — a written description of what's actually visible in the output (not a numeric score)
- [ ] Result notes (anything worth calling out about this specific test)
- [ ] Software version (the exact WipeClip build used)
- [ ] Test date

## Test environment

- [ ] Test device / hardware used
- [ ] Confirmation the source clip was unedited going in and the output wasn't manually touched up after processing

## Before adding to the page

- [ ] Every field above is filled with a real, measured value — no estimates, no placeholders, no rounding up
- [ ] Before/after media files are hosted and the URLs work
- [ ] The test date reflects when the test was actually run, not when this checklist was filled out
- [ ] A second person (not just whoever ran the test) has spot-checked the before/after clip against the claimed result
