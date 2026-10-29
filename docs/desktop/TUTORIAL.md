# Tutorial tools (Phase 3)

Turning a raw screen recording into a clear tutorial: pause and dead-time review, interaction insights, captions with subtitle export, keyboard-shortcut indicators, chapters, privacy masks, annotations, recording screenshots and retake/replace. Everything is project data (undoable, autosaved, restored on reopen) and reuses the existing preview, raster-overlay and export pipelines. All analysis runs on the device.

Open **Tutorial** in the editor toolbar (tabs: Review, Chapters, Shortcuts, Privacy, Annotate, Retake). Captions stay under **Captions**.

## What existed and what was added

| Area | Already there | Added in Phase 3 |
|---|---|---|
| Captions | Local Whisper (transformers.js, WebGPU/WASM), styles, positions, words per caption, editable text/timing as text layers, burned-in export | Recording microphone/system audio now transcribed (it was skipped: audio-only sources were treated as music); explicit model download with size and resource note; show/hide all; size and alignment for all; SRT, WebVTT, plain transcript export |
| Blur/pixelate | Full-frame timed effects | Region masks (blur, pixelate, solid), time-limited, movable/resizable, anchored to canvas or video, can follow the pointer |
| Overlays | Text, stickers, images, video layers (PNG raster pipeline) | Shapes (arrow, highlight circle, rectangle, numbered step, callout, focus outline) on the same pipeline; shortcut indicators as text layers |
| Edits | Split, delete, move (no ripple) | `ripple.ts`: range cut / insert / replace that keeps everything after in sync |

## Modules

| | |
|---|---|
| `src/lib/editor/audioAnalysis.ts` | 20 ms loudness frames vs the recording's own noise floor: silences, clipping, sudden loud sounds, very quiet speech; `cutRangeFor` keeps a natural pause |
| `src/lib/editor/insights.ts` | Suggestions from audio + interaction events: pauses, dead time, idle while talking, repeated clicks, possible retakes (a click sequence done twice), long navigation, app switching, milestones |
| `src/lib/editor/ripple.ts` | `rippleCut`, `rippleInsert`, `rippleReplace` |
| `src/lib/editor/transcript.ts` | SRT/WebVTT/transcript from caption layers; chapter list and WebVTT chapters |
| `src/lib/editor/keystrokes.ts` | Shortcut indicators from recorded shortcut events |
| `src/lib/editor/chapters.ts` | Chapter suggestions |
| `src/lib/editor/masks.ts`, `maskDraw.ts` | Mask geometry (shared by preview and export) and preview drawing |
| `src/lib/editor/shapes.ts` | Shape rasterizer |
| `src/lib/recorder/editorImport.ts` | Recording → editor sources (shared by opening a recording and retakes) |
| `src/components/editor/TutorialPanel.tsx`, `useTutorialTools.tsx`, `MaskEditLayer.tsx` | UI and editor glue |
| `backend/app/pipeline/editor.py` (`PlanMask`, `_mask_filters`), `backend/app/main.py` (`_EditorMask`, `_mask_plan`) | Mask export |
| `src-tauri/src/export.rs` (`save_text_file`), `src/lib/platform` (`saveTextFile`) | Saving .srt/.vtt/.txt/.json (website: download) |

## Review: pauses, dead time, insights

**Analyze recording** mixes the timeline's speech (clip audio, extracted audio, a recording's microphone and system audio; not music) to 16 kHz mono and analyzes it. The silence threshold sits between the noise floor (10th percentile of frame loudness) and typical speech (90th percentile). The sensitivity setting moves it, so background noise doesn't count as speech and quiet speakers aren't treated as silence. Speech blips under 120 ms (breaths, clicks) don't break a pause.

- **Silence during on-screen work** (clicks, typing or scrolling inside the pause) becomes a *review* item, never a proposed cut: it's usually part of the demonstration.
- **Dead time** (no speech and no clicks/typing/scroll) and **pauses** become cut suggestions that keep the chosen pause length on each side (default 0.35 s). Leading/trailing silence is cut entirely. Confidence: high for edges and pauses of 4 s or more, medium from 2.5 s, otherwise low.
- **Clipping** (3+ samples at full scale in a 20 ms frame) is checked on each source separately, at its own sample rate, over the part that's on the timeline (`clippedSpans`). It isn't checked on the mix: a loud but clean microphone plus loud system sound can add up past full scale there, and resampling to 16 kHz smears real clipping. **Sudden loud sounds** (≥ 12 dB jump, well above typical speech) and **very quiet speech** (within 6 dB of the threshold for 4 s+) are review items.
- From interaction events (recordings): **idle while talking** (no meaningful activity for the chosen time), **repeated clicks** (3+ on one spot within 2.5 s: "the app may not have responded"), **possible retake** (3 clicks repeated in the same places and order 3–120 s later: suggested as a low-confidence cut of the first attempt, worded as a possibility), **long navigation** (lots of pointer travel without clicks; 4 app switches within 10 s), **milestones** (markers).

- **Silent, but the picture keeps changing** (desktop app): before a silence becomes a cut, the local engine checks how much of it the picture actually changes (`/api/video/activity`, `backend/app/pipeline/activity.py`: ffmpeg `freezedetect` on 10 frames/s scaled to 320 px, only the silent ranges are decoded). A blinking text cursor or a pointer moving over a still window averages away. If the picture changes for 25% or more of the stretch (a video, an animation, a game, a build log), it becomes a low-confidence *review* item instead. Measured at about 7× real time on 1080p screen recordings; each file range is measured once per session. Without the local engine (website), or for videos that aren't on disk, this check doesn't run and the summary says so.
- **Settings are cheap to change**: the mix is reduced to 20 ms levels (`measureLevels`, about 1.6 MB for an hour instead of 220 MB of samples) and kept while the timeline's sound doesn't change, so analyzing again with another sensitivity, minimum pause or pause to keep skips decoding and mixing (measured in the editor: 26 ms instead of the first run's mix).
- **Preview the result**: plays the timeline skipping every pending cut suggestion, so you hear how it would flow before accepting anything. Nothing is removed; the timeline length stays as it is.

Analysis can be cancelled (it stops decoding, mixing and the picture check). Sources over 400 MB can't be decoded in the browser; they're left out of the sound analysis and the result says which ones (interaction-based suggestions still work).

Nothing is labeled a mistake. Each item shows time, explanation and confidence, with **Preview** (plays from 1.5 s before), **Cut** (one undo step; everything after moves up in sync), **Adjust range**, and **Keep/Dismiss**. "Accept N high-confidence cuts" applies them back to front as one undo step. Pending items also show on a **Review** timeline track; drag their edges to adjust.

## Draft (automatic editing assistant)

**Tutorial > Draft > Generate draft** builds a first edit from the recording: focus zooms (the Focus panel's engine, preset Subtle/Balanced/Dynamic, respecting excluded ranges and ignored clicks), click highlights, cuts for pauses and dead time (the Review analysis, including the picture check), items worth a look (clipping, loud sounds, repeated clicks…) and chapters. Workflow: **Record → Generate draft → review (Accept / Reject each, per kind, or all; Preview the result) → Apply → edit as usual → Export.**

- **One model** (`Project.draft`, `src/lib/editor/draft.ts`, versioned `DRAFT_VERSION = 1`): each item has a kind (zoom, highlights, cut, chapter, review), a status, a plain-words reason and its data - zooms in source time like every zoom, cuts/chapters/review items in timeline time.
- **Conflicts**: overlapping cut suggestions become one cut (with the lower confidence); the user's own zooms win over proposed ones (as in the Focus panel); a zoom with at least half of its visible length inside a cut, or a chapter inside a cut, is marked and left out if that cut is applied (applying the cut would remove its moment); zooms whose part of the recording isn't on the timeline aren't proposed; the opening chapter is implied.
- **Applying** uses the editor's own edits (`mergeSuggestions` for zooms, `rippleCut` for cuts, back to front) and is **one undo step**. Cuts move text, captions, stickers, audio, masks, chapters and review items with them; zooms stay on their moment. A cut that touches a transition is skipped with the reason; the rest applies. After applying everything is ordinary project data, so preview and export need nothing new.
- **Saved with the project**: reopening shows the draft as it was, without analyzing again; "Generate draft" with nothing changed (same timeline, sound, events, focus settings and draft options) says it's up to date instead of re-running. The sound levels and picture checks are also reused within the session (see Review).
- **Timeline changed since the draft** (trim, split, move…): its timeline times no longer line up, so cuts and chapters are refused with a message; zooms and click highlights can still be applied. Generate again for the rest.
- **Invalid or newer drafts** in a saved project are dropped on load (`validDraft`); the project opens normally.
- Generation shows progress, can be cancelled at any step, and on failure says the project hasn't changed.
- No language model or cloud service: the rules are the deterministic analyses above, and the wording says what each suggestion is based on (events, timing, sound levels), not what it means.

**Manual QA workflow** (desktop app, per OS):
1. Record 1-2 minutes: talk, stop talking for 5+ s while doing nothing, click a few buttons, type in a field, add a marker.
2. Open in the editor → Tutorial → Draft → Generate draft. Expect: a dead-time cut over the idle pause, zooms on the clicks/typing, click highlights, a chapter at the marker. Press Cancel during generation once: no draft appears and nothing changes.
3. Turn on Preview the result and play across the pause: playback jumps over it; the length doesn't change.
4. Reject one zoom, accept the rest (Accept all, then Reject). Accept a cut that contains a zoom: that zoom says it will be left out.
5. Apply. Check the timeline got shorter, text/captions after the cut moved with it, zooms play at the right moments, rings at the clicks. Ctrl+Z: everything back in one step; Ctrl+Shift+Z: applied again.
6. Save, close, reopen the project: the draft is listed as before. Trim a clip: the stale warning appears and Apply refuses cuts.
7. Export (signed out 720p is enough): the cut, zooms and rings appear in the file as in the preview.

**Known editing limitations**
- Suggestions come from timing, sound level and recorded input only: nothing understands what is on screen or what is said. Scene boundaries from the picture aren't detected (chapters use markers, app switches and pauses).
- A zoom that is only partly inside an applied cut is kept; the part after the cut may start already zoomed in.
- Cuts touching a transition are skipped, not adjusted.
- Any change to the clips after generating makes the draft's cuts and chapters unusable (by design: they would land in the wrong place); generate again.
- Generating replaces the previous draft; applying replaces earlier unedited zoom suggestions of that recording (manual and edited zooms stay).
- Accept/Reject clicks are undo steps of their own.
- Export after applying was not re-run end to end in this phase; the applied draft is ordinary project data whose export rows are covered by the existing export tests.

## Captions

Existing local Whisper captions with the additions above. With a usable WebGPU adapter the model is Whisper large-v3-turbo (4-bit, about **700 MB**; encoder on the GPU, decoder on the CPU, ~20 s per minute of speech); without one it's Whisper small (8-bit, about **250 MB**, CPU). Either is downloaded from Hugging Face once and kept in the app/browser cache (`transformers-cache`). If the model isn't cached, the panel asks first, with its size. Words over silence are dropped (Whisper's "Thank you." hallucinations), punctuation tokens join their word, and word timings are capped so a word doesn't run into the following pause. Audio is never uploaded. Correct text and timing on the caption layers (Text track); **SRT / WebVTT / Transcript** exports use the corrected captions; visible captions are burned into the video export as before.

## Shortcut indicators

Only from recorded shortcut metadata. The recorder never stores typed text (src-tauri/src/input/keys.rs), so nothing here can reveal passwords or private text. The Shortcuts tab lists the recorded combos with counts; untick any to hide them. Style (dark/light/accent), display time, size and position are adjustable. Indicators are ordinary text layers flagged `keystroke` (edit, move, delete, export like text). A new shortcut replaces the previous indicator rather than stacking. macOS combos show as symbols (⇧⌘4).

## Chapters

**Suggest chapters** proposes boundaries where something changed: markers (strongest), app switches that last at least 8 s, pauses of 2.5 s+, caption gaps. Boundaries closer than 20 s merge (stronger wins). Titles come from the marker, the app name or the first words spoken after the boundary, else "Part N". These are suggestions, not content understanding. Rename, retime, add at playhead, delete and jump in the list. Drag on the **Chapters** track to move. Export: `.txt` list ("0:00 Intro", first chapter forced to 0:00, as video sites expect) or WebVTT chapters.

## Privacy masks

Blur, pixelate or solid box, with time range, position, size and strength. Each mask is either **fixed on the canvas** or **stuck to the video** (default: follows the clip's crop, position and focus zooms, so it stays on the content), and can **follow the pointer** (recordings). Drag the dashed box on the preview to move it; drag the corner to resize. Times can be set on the **Privacy** track or in the inspector.

Preview and export cover the same rectangles: the browser computes the rectangle per output frame with `maskRect` (masks.ts) and the backend applies those rows. Solid masks are a box. Blur and pixelate show a processed copy through a per-frame matte. Strength maps to the same fractions of canvas height in both (blur radius 0.8–4.8%, pixel block 0.8–5.8%).

**Masks hide only the area and time you set; nothing is detected automatically.** The panel says this and asks you to check the whole range. Preview pixelation uses a grid aligned to the mask, the export one aligned to the frame (both hide the content; the blocks don't line up exactly). Rotated clips get the mask's bounding box.

## Annotations and screenshots

Arrow, highlight circle, rectangle, numbered step (auto-incrementing), callout (text bubble) and focus outline (glowing frame) are rasterized to transparent PNGs like text layers. The preview and export composite the same image, and they're movable, resizable, rotatable and time-limited like any layer. Inspector: color, filled/tint, proportions, line width, number, callout text.

Screenshots taken while recording are listed under Annotate (desktop). **Insert** loads one from the recording folder as an image layer at the moment it was taken.

## Retake and replace

**Mark a section at the playhead** (adjust from/to, optional note) adds a retake mark (Review track). **Replace with a recording…** (desktop; any WipeClip recording, interrupted ones are recovered) or **Replace with a video file…** (same checks as any import, including the server check) opens a review dialog. The dialog shows a preview of the replacement, the removed and inserted lengths, and which audio/webcam tracks come with it. **Replace** applies `rippleReplace` as one undo step:
- the marked range is cut from video, audio, webcam and every timed layer;
- the replacement clip is inserted, with its own microphone/system audio/webcam tracks lined up;
- everything after it moves.

Source files are never modified.

## Tests

| | |
|---|---|
| `npm run desktop:test:js` (`tests/desktop/tutorial.test.ts`, 21 tests) | Also: per-source clipping (two clean loud tracks aren't clipping; a 48 kHz stereo source clipped on one channel; only the on-timeline part); a 30-minute noisy recording with every pause found (the analysis itself takes about 150 ms on this machine); overlapping blur/solid/pixelate masks independent in preview and export rows; accepted cuts as one undo step with microphone and system audio split in sync, captions/chapters/masks moved, undo/redo, save/reopen. Earlier: Ripple cut keeps video/microphone/webcam in sync and trims/moves captions, effects, chapters; speed and reversed clips; refuses transitions and empty projects; insert/replace; input never mutated. Audio: silence against a noisy floor, breaths not pauses, quiet speech not silence, sensitivity, clipping/loud. Insights: silence while working is review not cut, dead time keeps natural pauses, repeated clicks, possible retake wording, idle, navigation, app switches, milestones, events through trims, accepted cut merging. SRT/VTT formatting (blank lines, `-->`, hidden captions). Shortcuts (hidden combos, no stacking, macOS symbols). Chapters (markers win, app switches, titles, list format). Masks (time limits, clipping, video anchoring through a zoom, pointer following, off-screen, export rows = preview rects). Save/reopen defaults |
| `npm run desktop:test:js` (`tests/desktop/cleanup.test.ts`) | Long pauses (cut keeps the natural pause, confidence by length), pauses during on-screen work (review), gameplay without narration (game sound isn't silence; a moving picture is reviewed, a still one is dead time), background music at measured levels, quiet speech, two tracks filling each other's pauses, 2 s and 60 min recordings (measure ~300 ms, detect ~70 ms), non-stop talk, cached levels equal a fresh analysis for any settings, picture pieces through trims/speed/reverse, preview skips, cuts next to text/effects/transitions with undo and reopen |
| `npm run desktop:test:js` (`tests/desktop/draft.test.ts`) | Draft: merged overlapping cuts, zoom/chapter inside a cut, user zoom wins, off-timeline zooms, highlights only when useful, accept/reject all/kind/one, apply through ripple (text, caption, sticker, microphone split, chapters, review items, zoom timing, export camera rows), one undo step, refused second apply, cut at a transition skipped, stale timeline, empty/none accepted, preview skips, save/reopen, invalid and newer drafts dropped, cancelled zoom analysis |
| `node tests/desktop/manual/preview-draft.mjs http://localhost:3100/` | Real editor in headless Chrome: Generate + immediate Cancel leaves no draft; Generate (~0.3 s) proposes a dead-time cut, 2 zooms, click highlights with the timeline unchanged; Accept all + Apply: 12.0 → 8.7 s, text 8.0 → 4.7 s, 2 zooms on the track; Ctrl+Z restores all; reopen keeps the draft; no console errors |
| `cd backend && python -m unittest tests.test_activity` | Real ffmpeg: still screen, moving content, still screen with blinking caret and moving pointer (counts as still), a range across a change, log parsing, endpoint validation and local-only |
| `cd backend && python -m unittest tests.test_privacy_export` | Real ffmpeg: blur only inside its rectangle and time; pixelate and solid; a moving mask following its rows and hiding; API validation |
| `node tests/desktop/manual/preview-tutorial.mjs http://localhost:3100/` (desktop frontend dev server) | Real editor in headless Chrome: solid and blur masks and an arrow in the preview; Analyze finds the 3.5 s pause; Cut shortens the timeline 8.0 → 5.2 s (0.35 s kept each side); Ctrl+Z restores 8.0 s; Preview the result plays 2.8 → 5.7 s over the pending cut with the length unchanged; analyzing again reuses the levels; no console errors |

## Limitations

- No speech-content understanding: chapters and suggestions are based on timing, levels and interaction patterns only.
- Without WebGPU, captions use Whisper small: clearly better than the old base model, but behind large-v3-turbo on heavy accents, jargon and noisy rooms; review the captions.
- Silence detection is level-based. Measured on synthetic audio (`tests/desktop/cleanup.test.ts`): a pause under steady music is found while the music is at least about 11 dB below the speech; at 6 dB below or louder the music fills the pause and it isn't found. Music added as its own track is left out of the speech mix and doesn't interfere.
- The noise floor is the quietest 5% of 20 ms frames, and silence must be at least 12 dB below typical speech. Before this, a talk with pauses under 10% of its length had its floor estimated from quiet speech and was treated as one long silence (found while testing this phase; fixed, covered by the "non-stop talk" test).
- A recording with no sound at all gets no silence suggestions: there is no speech level to measure against.
- Known false positives (review before accepting): periodic beeps or notification sounds come up as many "Sudden loud sound" items (seen with Chromium's fake microphone); a silent stretch where only something small changes on screen (a progress bar, a counter, below 25% of the time changing at 320 px) still counts as dead time; silence over a video clip that isn't on disk (dropped into the window) can't be checked for movement.
- Privacy masks don't track moving content by themselves (only the pointer, crops and zooms). Scrolling content needs keyframing by hand (split the time range into several masks).
- Shortcut indicators exist only if keyboard-shortcut recording was on.
- Accepting cuts or replacing refuses ranges that touch a transition (remove it first).
- Exporting masks needs the updated backend. Shapes, captions and shortcut indicators use the existing image/text path and work with the current backend.
- Not verified inside the running desktop app on Windows or macOS. Verified on Windows 11: the Rust crate's tests, the static desktop frontend build, the editor in headless Chrome (`preview-tutorial.mjs`, `preview-focus.mjs`) and ffmpeg 7.1 renders. macOS needs a Mac or the CI runner.
- Sound analysis runs on the main thread after mixing (about 150 ms for 30 minutes of audio, measured in Node on Windows 11). Decoding and mixing a long recording takes longer and uses memory: about 115 MB for the 30-minute 16 kHz mix, plus the decoded source while it is analyzed.
