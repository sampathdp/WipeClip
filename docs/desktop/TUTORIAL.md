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

Analysis can be cancelled (it stops decoding and mixing). Sources over 400 MB can't be decoded in the browser; they're left out of the sound analysis and the result says which ones (interaction-based suggestions still work).

Nothing is labeled a mistake. Each item shows time, explanation and confidence, with **Preview** (plays from 1.5 s before), **Cut** (one undo step; everything after moves up in sync), **Adjust range**, and **Keep/Dismiss**. "Accept N high-confidence cuts" applies them back to front as one undo step. Pending items also show on a **Review** timeline track; drag their edges to adjust.

## Captions

Existing local Whisper captions with the additions above. The model is Whisper base (multilingual, quantized), about **80 MB**, downloaded from Hugging Face once and kept in the app/browser cache (`transformers-cache`). Transcription uses about 1 GB of memory and the CPU (WebGPU encoder where available). If the model isn't cached, the panel asks first ("Download model (80 MB)"). Audio is never uploaded. Correct text and timing on the caption layers (Text track); **SRT / WebVTT / Transcript** exports use the corrected captions; visible captions are burned into the video export as before.

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
| `cd backend && python -m unittest tests.test_privacy_export` | Real ffmpeg: blur only inside its rectangle and time; pixelate and solid; a moving mask following its rows and hiding; API validation |
| `node tests/desktop/manual/preview-tutorial.mjs <editor url>` | Real editor in headless Chrome: solid and blur masks and an arrow in the preview; Analyze finds the 3.5 s pause; Cut shortens the timeline 8.0 → 5.2 s (0.35 s kept each side); Ctrl+Z restores 8.0 s; no console errors |

## Limitations

- No speech-content understanding: chapters and suggestions are based on timing, levels and interaction patterns only.
- Whisper base accuracy is modest for heavy accents, technical jargon and noisy rooms; review the captions. Larger models aren't offered (size).
- Silence detection is level-based; constant loud background music under speech defeats it (it's excluded from the speech mix only if it was added as a separate music track).
- Privacy masks don't track moving content by themselves (only the pointer, crops and zooms). Scrolling content needs keyframing by hand (split the time range into several masks).
- Shortcut indicators exist only if keyboard-shortcut recording was on.
- Accepting cuts or replacing refuses ranges that touch a transition (remove it first).
- Exporting masks needs the updated backend. Shapes, captions and shortcut indicators use the existing image/text path and work with the current backend.
- Not verified inside the running desktop app on Windows or macOS. Verified on Windows 11: the Rust crate's tests, the static desktop frontend build, the editor in headless Chrome (`preview-tutorial.mjs`, `preview-focus.mjs`) and ffmpeg 7.1 renders. macOS needs a Mac or the CI runner.
- Sound analysis runs on the main thread after mixing (about 150 ms for 30 minutes of audio, measured in Node on Windows 11). Decoding and mixing a long recording takes longer and uses memory: about 115 MB for the 30-minute 16 kHz mix, plus the decoded source while it is analyzed.
