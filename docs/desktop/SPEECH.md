# Speech-aware editing (Phase 4)

29 October 2026. The transcript feeds the review suggestions (Tutorial panel > Review) next to the existing pause, dead-time and interaction suggestions. Everything stays a suggestion until the user accepts it. Accepted cuts are applied together as one undo step.

## What it's built on (reused, not duplicated)

| Part | Where | Notes |
|---|---|---|
| Speech recognition | `src/lib/editor/captions.ts`, `captions.worker.ts` | Whisper through Transformers.js (Apache-2.0) in Web Workers, on this device. `whisper-small` (about 250 MB, CPU) or `whisper-large-v3-turbo` (about 700 MB, WebGPU), downloaded once from Hugging Face and cached. Word timestamps from the `_timestamped` exports |
| Transcript | `Project.transcript` (`language`, `words[{start,end,text}]`, `total`) | Made by auto captions or the Transcript panel |
| Editing by text | `wordEdit.ts`, `TranscriptPanel.tsx` | Select words, cut them (one undo step) |
| Cuts | `ripple.ts` | Shifts or trims captions, the transcript, chapters, masks and suggestions; splits microphone, system-audio and webcam tracks so they stay in sync; zooms are in source time; highlights and drafts carry a timeline key and are marked out of date |
| Review | `insights.ts`, `TutorialPanel.tsx`, `useTutorialTools.tsx` | Per-suggestion keep/cut, "Preview the result" (playback skips pending cuts), apply accepted as one step |

Licences: the original Whisper models are Apache-2.0 (`openai/whisper-small`) and MIT (`openai/whisper-large-v3-turbo`), per their Hugging Face model cards. **To check:** the ONNX conversions the app downloads (`onnx-community/whisper-*_timestamped`) state no licence on their model cards. They are downloaded at run time, not bundled or redistributed by WipeClip.

## New in this phase

**Transcript suggestions** (`src/lib/editor/speechEdits.ts`), used only while the transcript still matches the edit (`transcriptCurrent`):

| Kind | Found from | Action | Confidence |
|---|---|---|---|
| `filler` | Hesitation sounds in the word list, consecutive ones as one suggestion. **English transcripts only**; other languages get a note | cut | high for um/uh/erm; medium for ah/hmm/er/mm (also real reactions) |
| `repeat` | The same 1–8 words twice in a row, within 1 s; a restarted sentence (4+ words) within 3 s. The first occurrence is cut, the second kept | cut | low for one word ("very very" may be deliberate), medium for 2, high for 3+ |
| quiet speech | A level-based pause with recognized words inside | changed from cut to **review** | low |
| `no-speech` | 4+ s without words where level-based silence covers under 30 % (music, game or app sound, steady noise) | **review**, never cut | low |

Every suggestion has a timestamp, a title quoting the words, a detail saying what it's based on, and a confidence. Word timings that can't all be right (zero length, over 2.5 s, overlapping the previous word) lower the confidence to low and the detail says to play the cut first. Cut ranges use the same boundaries as editing by text: from the first removed word to where the next word starts.

Without a transcript the review works as before (levels and recorded interactions) and says how to add the transcript checks.

**Model consent and cancel.**

- **Consent:** the Transcript panel now asks before the first download, with the same notice as auto captions (size, memory, time, "your audio never leaves this device"). Before, its Transcribe button started the download without asking.
- **Cancel:** both panels have a Cancel button while running. `cancelSpeech()` ends every speech worker, including one still loading the model, and the run ends with "… cancelled. Nothing was changed."
- **Worker shutdown:** before, an ended worker left its request hanging. Now it rejects with an AbortError, and a cancel never falls through to the CPU retry.

## Safeguards

- Nothing is cut without the user accepting it. Pauses are not all treated as dead time: those with speech in them, sound without words, and quiet stretches while working on screen or while the picture moves are all "review".
- The recording and transcript stay on the device. Only model files are downloaded, after consent.
- No claim of understanding: the suggestions come only from the words and their times.

## Tests

| Command | Result |
|---|---|
| `npm run desktop:test:js` (`tests/desktop/speechEdits.test.ts`, 7 tests) | Pass. Covered: fillers and repeats with ranges and confidence; a restarted sentence vs a later repeat; English-only fillers; uncertain timings; empty and overlapping words; quiet speech and sound-without-speech; applying accepted suggestions; perf |
| `node tests/desktop/manual/preview-transcript.mjs <url> <out>` | 10/10 in headless Chrome against a production build of the editor |

What the apply test checks, through the review's own path (`acceptedCuts` then `rippleCut`):

- the transcript still matches the timeline;
- removed words are gone;
- a later word moved by exactly the removed time;
- captions and a chapter moved with it;
- the microphone was split and plays the same moment as the video;
- undo restores the exact original, and redo works;
- regenerating finds only what was left.

What the headless script checks:

- the consent notice appears and no model file is cached before consent;
- Cancel within a second gives "cancelled" and no transcript;
- with the model hosts unresolvable (`--host-resolver-rules`), the run fails with "Check your connection" and the project is unchanged.

**Performance.**

- **Suggestions:** an hour of transcript (7,746 words) takes 21 ms for the suggestions plus the no-speech check.
- **Transcription:** not re-measured in this phase, because it needs the model download. The earlier measurements in `captions.ts`: large-v3-turbo on WebGPU transcribes 60 s in about 20 s; whisper-small on the CPU uses about 1.5 GB per worker.

## Limitations

- **Fillers:** only English.
- **Repeats:** only immediate and exact (after normalizing case and punctuation). A rephrased retake isn't found.
- **Overlapping speech:** Whisper writes one word stream; two people talking at once are merged, and their repeats can look like a repeat.
- **Word timing accuracy:** depends on the model; whisper-small's word times are less tight than turbo's. Cuts land where the next word starts, so a slightly late start can clip a breath. "Preview the result" plays the edit before applying.
- **Language detection:** auto-detect uses the first speech segment.
- **Not measured:** transcription time on representative long recordings in this phase (needs the model on this machine).
