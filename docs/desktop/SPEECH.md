# Speech-aware editing (Phase 4)

29 October 2026. The transcript feeds the review suggestions (Tutorial panel > Review) next to the existing pause, dead-time and interaction suggestions. Everything stays a suggestion until the user accepts it. Accepted cuts are applied together as one undo step.

## What it's built on (reused, not duplicated)

| Part | Where | Notes |
|---|---|---|
| Speech recognition (desktop) | `backend/app/pipeline/speech.py`, `/api/speech/*` in `main.py` | Since 2 November 2026 the desktop app transcribes in its engine with faster-whisper (CTranslate2, MIT), int8 on the CPU's physical cores. See [Speech in the engine](#speech-in-the-engine) |
| Speech recognition (website, or no engine) | `src/lib/editor/captions.ts`, `captions.worker.ts` | Whisper through Transformers.js (Apache-2.0) in Web Workers, on this device. `whisper-small` (about 250 MB, CPU) or `whisper-large-v3-turbo` (about 700 MB, WebGPU), downloaded once from Hugging Face and cached. Word timestamps from the `_timestamped` exports |
| Transcript | `Project.transcript` (`language`, `words[{start,end,text}]`, `total`) | Made by auto captions or the Transcript panel |
| Editing by text | `wordEdit.ts`, `TranscriptPanel.tsx` | Select words, cut them (one undo step) |
| Cuts | `ripple.ts` | Shifts or trims captions, the transcript, chapters, masks and suggestions; splits microphone, system-audio and webcam tracks so they stay in sync; zooms are in source time; highlights and drafts carry a timeline key and are marked out of date |
| Review | `insights.ts`, `TutorialPanel.tsx`, `useTutorialTools.tsx` | Per-suggestion keep/cut, "Preview the result" (playback skips pending cuts), apply accepted as one step |

Licences: the original Whisper models are Apache-2.0 (`openai/whisper-small`) and MIT (`openai/whisper-large-v3-turbo`), per their Hugging Face model cards. **To check:** the ONNX conversions the app downloads (`onnx-community/whisper-*_timestamped`) state no licence on their model cards. They are downloaded at run time, not bundled or redistributed by WipeClip.

## Speech in the engine

2 November 2026. Captions in the desktop app took over 30 minutes for a 2-minute Sinhala video, and the text was mostly nonsense. In the browser, WebAssembly is slow and stock Whisper can't do Sinhala. The desktop app now sends the speech mix (16 kHz mono float32) to its engine instead (`engineTranscribe` in `toolsApi.ts`). The browser path stays for the website.

**Models** (downloaded after consent into the app's local data folder, `speech-models/`, pinned to a revision):

| Language | Model | Download | Kept |
|---|---|---|---|
| Sinhala | [SinhaSpeech/whisper-small-sinhala-run12-best](https://huggingface.co/SinhaSpeech/whisper-small-sinhala-run12-best) (Apache-2.0; Whisper-small fine-tuned on Sinhala, 15.5% word error rate reported on its speaker-disjoint test set) | 970 MB | 250 MB |
| Everything else | Whisper large-v3-turbo, CTranslate2 export (`dropbox-dash/faster-whisper-large-v3-turbo`, MIT) | 1.6 GB | 1.6 GB |

The Sinhala model is only published as a Transformers checkpoint. `convert_whisper` turns it into a CTranslate2 model with int8 weights on the user's machine with numpy, because CTranslate2's own converter needs PyTorch. It mirrors that converter's `WhisperLoader`, and the tokenizer is whisper-small's (vocab, merges and added tokens checked identical). Converting takes about 10 s. "auto" detects the language with the general model and switches to the Sinhala model for Sinhala.

**Decoding:**
- **Clips:** the audio is cut at quiet points into clips (12 s for Sinhala, 28 s otherwise), decoded 8 or 4 at a time (`BatchedInferencePipeline`).
- **Text only:** each clip is decoded as text alone, then timed by aligning it to the audio. The Sinhala model was fine-tuned without timestamp tokens.
- **Loops:** whatever a loop leaves behind is dropped.

**Measured** on an i7-9750H (6 cores) with a 2-minute test file: 33 test-set utterances joined with 0.5 s pauses, so the speakers weren't in training. Word error rate is computed with punctuation stripped.

| | Time | Word error rate |
|---|---|---|
| Stock Whisper (browser, 0.1.7) | 30+ min (user report) | mostly nonsense |
| Engine, Sinhala model, 28 s clips, timestamps on | 316 s | 59% |
| Engine, Sinhala model, 28 s clips, text only | 55 s | 49% (a quarter of the words missing) |
| **Engine, Sinhala model, 12 s clips, batched (shipped)** | **84 s** | **26%** |

- **Time per 30 s window:** each window costs the same encoder pass on the CPU however short it is: 3.2 s for whisper-small, 16 s for turbo. 6 threads were faster than 11 (hyperthreads hurt), so the engine uses the physical cores.
- **English:** turbo wasn't measured on an English recording; expect about 16 s per 28 s of speech on this CPU.
- **Not used:** the GPU. CTranslate2 on CUDA needs cuBLAS and cuDNN, about 1 GB more to ship.

**Packaging:**
- `faster-whisper==1.2.1` and `ctranslate2` added to `requirements-desktop.txt`.
- `av` (FFmpeg bindings, about 70 MB) isn't bundled. faster_whisper imports it but only uses it to decode files, so `pyi_rth_av_stub.py` stands in.
- onnxruntime (voice detection) stays excluded.

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
- **Threads (1 November 2026):** the desktop app now sends `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` (`tauri.conf.json` `app.security.headers`), so the page is cross-origin isolated and ONNX Runtime can use several WebAssembly threads per speech worker (`threadsPerWorker` in `captions.ts`: about the physical cores shared between the workers, at most 4 each). Before, every worker ran on one thread. If threads fail to start, the pool falls back to one thread per worker. The website and `next dev` don't send these headers and stay on one thread. WebKit (macOS) doesn't support `credentialless`, so macOS stays on one thread too. **Not measured yet** on a real recording.
- **Slow GPU check:** the WebGPU trial now also times each worker's first segment, which must come back within its own length (at least 10 s, at most 30 s); before, only the language check was timed, so a GPU that passed it could still crawl through every segment.

## Limitations

- **Fillers:** only English.
- **Repeats:** only immediate and exact (after normalizing case and punctuation). A rephrased retake isn't found.
- **Overlapping speech:** Whisper writes one word stream; two people talking at once are merged, and their repeats can look like a repeat.
- **Word timing accuracy:** depends on the model; whisper-small's word times are less tight than turbo's. Cuts land where the next word starts, so a slightly late start can clip a breath. "Preview the result" plays the edit before applying.
- **Language detection:** auto-detect uses the first speech segment.
- **Low-resource languages (Sinhala, and others with little training data):** Whisper is far less accurate in them, and more likely to get stuck in a loop ("ත්ත්ත්…" filling a whole caption). Each segment is now checked the way Whisper does it (zlib compression ratio over 2.4), retried with sampling at temperature 0.4 and then 0.8, and what's still looped is dropped (`captions.worker.ts`). This removes the junk, but it doesn't make the recognition itself accurate.
- **Not measured:** transcription time on representative long recordings in this phase (needs the model on this machine).
