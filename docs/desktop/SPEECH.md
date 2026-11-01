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

The Sinhala model is only published as a Transformers checkpoint. `convert_whisper` turns it into a CTranslate2 model with int8 weights on the user's machine with numpy, because CTranslate2's own converter needs PyTorch. It mirrors that converter's `WhisperLoader`, and the tokenizer is whisper-small's (vocab, merges and added tokens checked identical). Converting takes about 10 s.

**NVIDIA graphics cards** (Windows): a checkbox in the Captions and Transcript panels, off until the user ticks it.
- **What it downloads:** CTranslate2 needs only cuBLAS (`cublas64_12.dll`, `cublasLt64_12.dll`) from NVIDIA's pinned PyPI wheel, not cuDNN (tried). Those two members are read out of the wheel with HTTP range requests: 553 MB instead of the whole wheel, CRC-checked, into `speech-models/cuda/`.
- **Settings:** 8-bit weights with 16-bit math.
- **Fallback:** any CUDA error (old driver, too little memory) moves that run to the CPU, and the engine stays on the CPU until it restarts.

**"auto" and Sinhala:** large-v3-turbo can't recognize Sinhala. On the test it guessed Tamil at 0.16-0.46; real Tamil (FLEURS) scored 0.69-0.85 and Hindi 0.92-0.96. So a guess under 0.6 among the neighbouring languages, averaged over up to 3 clips (1 when it's sure), is taken for Sinhala (`detect_language`). If the Sinhala model isn't downloaded, the engine answers 409 `model_needed`. The editor then switches the language to Sinhala so the panel asks for that download. The chosen language is remembered, so later runs skip detection.

**Decoding:**
- **Clips:** the audio is cut at quiet points into clips: 12 s for Sinhala, since that model was trained on short utterances, and 28 s otherwise. They're decoded 8 or 4 at a time (`BatchedInferencePipeline`).
- **Short encoder window:** the encoder gets a window 1 s longer than the longest clip instead of a padded 30 s. CTranslate2 accepts it.
- **Text only:** each clip is decoded as text alone, then timed by aligning it to the audio. The Sinhala model was fine-tuned without timestamp tokens.
- **Early-ended clips:** greedy decoding sometimes ends a clip early. When a clip has 1.5 s or more after its last word, with 1 s of sound in it, that remainder is decoded again (`unfinished`), keeping only words at probability 0.4 or higher.
- **Loops:** whatever a loop leaves behind is dropped.

**Measured** on an i7-9750H (6 cores) and a GTX 1650 (4 GB), with a 2-minute test file: 33 test-set utterances joined with 0.5 s pauses, so the speakers weren't in training. Punctuation is stripped. Character error rate is the fairer measure for Sinhala: most "word" errors are spacing ("බේරා ගනියිනෙ" for "බේරගනියිනෙ"). The model card reports 4.36%.

| | Time | Word errors | Character errors |
|---|---|---|---|
| Stock Whisper (browser, 0.1.7) | 30+ min (user report) | mostly nonsense | |
| Engine CPU, 28 s clips, timestamps on | 316 s | 59% | |
| Engine CPU, 12 s clips, 30 s window (8aa763f) | 84 s | 26% | 4.6% |
| **Engine CPU, short window + re-decoding (shipped)** | **30 s** | **27%** | **4.6%** |
| Engine GPU, 30 s window | 9 s | 26% | 6.6% |
| **Engine GPU, short window + re-decoding (shipped)** | **7 s** | **27%** | **4.4%** |

- **Beam search:** beam size 5 didn't help (GPU: 27% vs 26% word errors), so decoding stays greedy.
- **CPU threads:** 6 threads were faster than 11 (hyperthreads hurt), so the engine uses the physical cores.
- **Turbo (other languages):** about real time on this CPU (81 s of Hindi in 79 s). On the GPU, a minute of Tamil or Hindi takes 14 s, including detecting the language.
- **Not measured:** English accuracy, and machines slower than this one. A 4-core CPU should take about 1.5 times as long.

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
