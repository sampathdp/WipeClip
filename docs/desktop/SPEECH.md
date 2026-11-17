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
| Kannada, Tamil, Telugu, Hindi | `vasista22/whisper-{kannada,tamil,telugu,hindi}-small` (Apache-2.0; Whisper-small fine-tuned per language by IIT Madras's SPRING Lab on public Indian speech corpora and FLEURS train) | 970 MB each | 250 MB each |
| Everything else | Whisper large-v3-turbo, CTranslate2 export (`dropbox-dash/faster-whisper-large-v3-turbo`, MIT) | 1.6 GB | 1.6 GB |

The small models are only published as Transformers checkpoints. `convert_whisper` turns one into a CTranslate2 model with int8 weights on the user's machine with numpy, because CTranslate2's own converter needs PyTorch. It mirrors that converter's `WhisperLoader`, and the tokenizer is whisper-small's (vocab, merges and added tokens checked identical; the SPRING Lab models use an older layout of the same tokens). Converting takes 4-10 s.

- **Checkpoint formats:** the SPRING Lab models only ship `pytorch_model.bin`, a zip with a pickle in it. `_load_pytorch` reads it without PyTorch. Only the constructors a state dict uses are allowed (`_rebuild_tensor_v2`, `OrderedDict`, the storage types), so a planted pickle can't run code. A test checks that anything else is refused.
- **Their generation config:** it has no language list or alignment heads, so whisper-small's is used.
- **Downloads:** a dropped connection can end a response early without an error. That happened to a 1 GB file here. `_fetch` now checks the length, picks up from the partial file with a range request (up to five times), and also resumes after the app restarts.

**NVIDIA graphics cards** (Windows): a checkbox in the Captions and Transcript panels, off until the user ticks it.
- **What it downloads:** CTranslate2 needs only cuBLAS (`cublas64_12.dll`, `cublasLt64_12.dll`) from NVIDIA's pinned PyPI wheel, not cuDNN (tried). Those two members are read out of the wheel with HTTP range requests: 553 MB instead of the whole wheel, CRC-checked, into `speech-models/cuda/`.
- **Settings:** 8-bit weights with 16-bit math.
- **Fallback:** any CUDA error (old driver, too little memory) moves that run to the CPU, and the engine stays on the CPU until it restarts.

**"auto":** large-v3-turbo can't recognize Sinhala, and can't tell Kannada or Telugu from Tamil. On all of them it guesses Tamil: mostly unsure (0.24-0.42 averaged over 3 clips), but 0.89 on one Sinhala clip. Each language's own model, though, is far more confident on its own language than any other model is. Average log-probability per token:

| Audio | Own model | Next best |
|---|---|---|
| Sinhala test set / Sinhala news report | -0.013 / -0.024 | -0.10 (Telugu model) |
| Kannada | -0.014 | -0.049 (Sinhala model) |
| Telugu | -0.014 | -0.07 (Kannada model) |
| Hindi | -0.033 | -0.11 (Sinhala model) |
| Tamil | -0.047 | -0.09 (Sinhala model) |

How `detect_language` decides:
1. A sure guess (0.6 or more) of a language outside that group is taken as is.
2. Otherwise each downloaded language model decodes 2 clips, Sinhala first, then in turbo's order. The first to reach -0.035 is the language.
3. If none does, a sure guess stands.
4. An unsure guess in the group with no Sinhala model is taken for Sinhala, which was the old rule.
5. Anything else answers 422 `language_unclear`: "Couldn't tell which language this is. Pick it in the Language list".

A language whose own model isn't downloaded answers 409 `model_needed`. The editor then switches the language so the panel asks for that download. The chosen language is remembered, so later runs skip detection. Detection is right on all 8 test files (English, Sinhala ×2, Kannada, Tamil, Telugu, Hindi, a film clip). With every model downloaded it takes 7-22 s on the GPU; Sinhala takes 26 s on the CPU.

**Decoding:**
- **Clips:** the audio is cut at quiet points into clips of at most 12 s, for every model. They're decoded 8 at a time for the small models and 4 for turbo (`BatchedInferencePipeline`).
  - The small models were trained on short utterances.
  - Turbo, decoding text without timestamps, often stops early in a long clip. On 40 English sentences it left out 21% of the words on 28 s clips; Hindi and Tamil were also best at 12 s.
  - With the short window, 12 s clips cost no more time: turbo on the CPU went from about real time to 2.3× faster.
- **Quiet speech:** a clip counts as sound if it's louder than 0.004 RMS (as before), or if its loudest 100 ms reaches 0.0003 and is 8 times its quietest tenth. FLEURS English has sentences peaking at 0.0007. Skipping those had lost a third of the words, and the editor's own checks (no-sound message, word filter in `captions.ts`) dropped them too; they use the same rule now.
- **Short encoder window:** the encoder gets a window 1 s longer than the longest clip instead of a padded 30 s. CTranslate2 accepts it.
- **Text only:** each clip is decoded as text alone, then timed by aligning it to the audio. The Sinhala model was fine-tuned without timestamp tokens.
- **Early-ended clips:** greedy decoding sometimes ends a clip early. When a clip has 3 s or more after its last word, with 1 s of sound in it, that remainder is decoded again (`unfinished`), keeping only words at probability 0.4 or higher. The threshold was 1.5 s, but the shorter remainders were mostly a pause plus the start of the next sentence, and the small models filled them with stock phrases (Kannada character errors went from 9.7% to 21.7%).
- **Loops:** a decoding whose text compresses more than 2.4 times (Whisper's own test) is dropped. That clip is decoded again with sampling at rising temperatures. One 5 s English leftover had produced "For example," 75 times. Words, or phrases of up to 4 words, repeated more than 3 times in a row are then cut back to 3.

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
- **Turbo (other languages):** 2 minutes of English take 52 s on this CPU and 6 s on the GPU.
- **Not measured:** machines slower than this one. A 4-core CPU should take about 1.5 times as long.

**Other languages** on FLEURS test sentences (not in any model's training). GPU, full pipeline, punctuation stripped:

| Language (audio) | Model | Time | Word errors | Character errors |
|---|---|---|---|---|
| English (40 sentences, 396 s) | turbo, before these changes | 38 s | 35% | 34% |
| English | **turbo (shipped)** | 29 s | **6.8%** | **4.7%** |
| Kannada (30, 442 s) | turbo | 42 s | 75% | 21% |
| Kannada | **own model** | 26 s | **24%** | **6.8%** |
| Tamil (25, 370 s) | turbo | 32 s | 72% | 24% |
| Tamil | **own model** | 25 s | **27%** | **10%** |
| Telugu (25, 288 s) | turbo | 29 s | 85% | 43% |
| Telugu | **own model** | 31 s | **26%** | **8.5%** |
| Hindi (25, 331 s) | turbo | 35 s | 35% | 15% |
| Hindi | **own model** | 18 s | **17%** | **6.7%** |

The word error rates of the Dravidian languages are high mostly because their words are long and compound: one wrong letter counts the whole word.

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

## Hesitation sounds (7 November 2026)

Speech models often leave "aaa", "uhhh" or "mmm" out of the transcript, and outside English there was no filler list at all. `src/lib/editor/hesitations.ts` finds them from the sound itself, in any language.

**How it decides.** Speech changes every ~100 ms, while a hesitation holds one sound. On the 16 kHz speech mix, every 10 ms:

1. **Loud and not hiss:** above the noise floor by 12 dB, and few zero crossings.
2. **Shape holds:** log energy in 16 bands (100–4000 Hz, FFT at 8 kHz, mean removed) changes by under 5 dB RMS over 50 ms, and so does the level.
3. A run of 0.25–3.5 s of such frames is a **candidate**. It's kept if:
   - its level stays within 14 dB;
   - 70 % of it has a clear pitch, with a spread under 1.5 semitones and a range under 4 (a word said slowly glides in pitch);
   - it has a pause before or after it (or is 0.4 s or longer).
4. Pieces of one sound that wobbled are merged.

**With a transcript that matches the edit:**
- Left out: mostly inside a real word (a word said slowly), on a filler word (that suggestion covers it), or 2.5 s or more from any word (music or other sound).
- **High** confidence: pauses on both sides, 0.35 s or longer, steady pitch.
- Otherwise **medium**.

**Without a transcript:** medium with pauses on both sides, low otherwise.

**The cut** takes the sound plus the pauses around it, down to 0.2 s left on each side (at most 0.6 s taken per side). It never reaches into a recognized word.

**Review panel:**
- Suggestions are kind `filler`, titled "Hesitation sound".
- **Remove N fillers** accepts every filler word and held sound that isn't low confidence, as one undo step.
- The hesitations are measured with the levels and cached with them, so changing the settings doesn't measure again.

**Filler words** now match stretched spellings: `ummm`, `uhhh`, `aaah`, `eee`, `hmmm`, `err`, but not `a` or `e`.

**Measured** with Windows speech synthesis (two voices, about 140 s of narration including "Oh", "Wow", "Okay", "Hmm"):

| Check | Result |
|---|---|
| Narration without hesitations | 0 found |
| Held sounds from phonemes ("uh", "mm", "eh", "uh") | 2 of 4: both "uh" found. The synthesizer's "mm" jumps in level and its "eh" fades by 12 dB, so neither held still enough |
| Spelled-out "uhhhhh", "ummmm", "aaaah" at a slow rate | 2 of 3: "uhhhhh" and "aaaah" found; "ummmm" glides in pitch |
| Same, with white noise added (amplitude 0.003, 0.01, 0.02) | Same results, no false finds |
| Speed | About 1.5 ms per second of audio (about 1 s per 10 minutes) |

**Not yet checked on real microphone recordings** of hesitations: that's the first manual test.

## English words in Indic-language captions (12 November 2026)

People speaking Sinhala, Tamil, Hindi and other Indian languages mix in English words. The speech models write some in English, but most come out in the language's script. On synthesized English speech the Sinhala model wrote "share" and "computer" in English, but "ෆෝන්" (phone), "ලින්ක්" (link) and "ස්ක්‍රීන්" (screen) in Sinhala. `src/lib/editor/englishWords.ts` writes those back in English after recognition. It runs in `transcribe` (captions.ts), so captions and the Transcript panel both get it, in the engine and in the browser. A Captions panel checkbox, **Keep English words in English** (on by default, hidden for English), turns it off.

**How it decides:**
1. Each word in one Brahmic script (Sinhala, Devanagari, Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam) is romanized. Text is NFC-normalized first, because Tamil ொ is also typed as ெ + ா. In Hindi, Bengali, Gujarati and Punjabi the last unwritten vowel is dropped.
2. The result is compared by sound with about 400 English words common in this kind of speech, plus the Latin-script words of the names hint. The comparison ignores aspiration, long vowels, retroflex vs dental, and doubled letters. The match is a weighted edit distance:
   - 0.5 for a vowel added or left out, a near vowel (a/e, a/o, e/i, o/u) or a near consonant (v/b, f/p, z/s/j);
   - 1.5 for another vowel;
   - more for another consonant.
   - Tamil writes k/g, t/d, p/b and c/j with one letter each, so those count as the same there.
3. **Allowed distance:** 0.5 up to 5 sounds, 1 up to 8, 1.5 from 9. In Tamil, words of up to 4 sounds must match exactly. An extra final vowel costs 0.5 more, because it's mostly a native ending: बताना ("to tell") isn't "button".
4. **Words of up to 4 sounds must also look borrowed:**
   - a bare final consonant in Sinhala, Telugu, Kannada and Oriya, or a final stop in Tamil;
   - or a letter used mostly for English sounds: f (ෆ ఫ ಫ ഫ), Devanagari ॉ ॅ ज़ फ़, Tamil ஃ and the Grantha letters.
   - So Hindi कर ("do") and बस ("enough") stay, while Sinhala බස් becomes "bus".
5. Native words that still collide are listed in `NATIVE`, for example Hindi कमरा ("room", like "camera") and Tamil விரல் ("finger", like "viral").

Whole words are replaced. In Sinhala, a loanword with a common ending joined on is too: වීඩියෝවක් ("a video") becomes "video එකක්", ෆෝන්එකේ becomes "phone එකේ" (17 November 2026).

**Checked** against the 10,000 most common words of the OpenSubtitles frequency lists (FrequencyWords, used for testing only, not shipped):

| Language | Words changed | Notes |
|---|---|---|
| Sinhala | 0 | Every word left as it is |
| Hindi | 108 | Almost all English loanwords (कंप्यूटर, डाउनलोड, सेटिंग्स) |
| Tamil | 60 | Almost all English loanwords |
| Telugu | 170 | Almost all English loanwords |
| Malayalam | 67 | Almost all English loanwords |
| Bengali | 71 | Almost all English loanwords |

The few wrong ones that were left are an English word that isn't listed, matched to a listed one that sounds close (Telugu పామ్, "palm", as "farm").

**Known gaps:**
- Short Hindi loanwords without a borrowed letter are left alone (लिंक, फोन without the nukta).
- Short Tamil ones with an added vowel are left alone too (கிளிக், click).
- Not yet checked on real code-mixed recordings.

## Safeguards

- Nothing is cut without the user accepting it. Pauses are not all treated as dead time: those with speech in them, sound without words, and quiet stretches while working on screen or while the picture moves are all "review".
- The recording and transcript stay on the device. Only model files are downloaded, after consent.
- No claim of understanding: the suggestions come only from the words and their times.

## Tests

| Command | Result |
|---|---|
| `npm run desktop:test:js` (`tests/desktop/speechEdits.test.ts`, 7 tests) | Pass. Covered: fillers and repeats with ranges and confidence; a restarted sentence vs a later repeat; English-only fillers; uncertain timings; empty and overlapping words; quiet speech and sound-without-speech; applying accepted suggestions; perf |
| `npm run desktop:test:js` (`tests/desktop/englishWords.test.ts`, 4 tests) | Pass. Covered: romanizing Sinhala, Devanagari and Tamil; 32 loanwords in Sinhala, Hindi, Tamil, Kannada and Telugu found; 118 common native words left alone; punctuation, Latin words and the names hint kept |
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

- **Filler words:** only English text. Held sounds ("aaa", "mmm") are found in any language, see [Hesitation sounds](#hesitation-sounds-7-november-2026).
- **Hesitation sounds:** a short "uh" (under 0.25 s), or one said in the same breath as a word ("sooo", "and-uhh") with no pause around it, isn't found. Checked only on synthesized speech, not yet on real recordings.
- **Repeats:** only immediate and exact (after normalizing case and punctuation). A rephrased retake isn't found.
- **Overlapping speech:** Whisper writes one word stream; two people talking at once are merged, and their repeats can look like a repeat.
- **Word timing accuracy:** depends on the model; whisper-small's word times are less tight than turbo's. Cuts land where the next word starts, so a slightly late start can clip a breath. "Preview the result" plays the edit before applying.
- **Language detection:** in the browser (website), auto-detect uses the first speech segment. In the desktop app, see "auto" above.
- **Low-resource languages (Sinhala, and others with little training data):** Whisper is far less accurate in them, and more likely to get stuck in a loop ("ත්ත්ත්…" filling a whole caption). Each segment is now checked the way Whisper does it (zlib compression ratio over 2.4), retried with sampling at temperature 0.4 and then 0.8, and what's still looped is dropped (`captions.worker.ts`). This removes the junk, but it doesn't make the recognition itself accurate.
- **Not measured:** transcription time on representative long recordings in this phase (needs the model on this machine).

## Code-mixed Sinhala voice note (17 November 2026)

A 41 s WhatsApp voice note (Sinhala with English words and names), on the Sinhala model:

- **Beam search on the GPU:** greedy wrote "New seal වල අනර් ආයුර් දෙක සෙන්ට් එක"; beam size 5 wrote "නිව්සිලන්වල අනර්කා ආයුරේදික් සෙන්ට් එක" (New Zealand's Anarka Ayurvedic center), and "ආයුර්වේද" instead of "ආයුර් ආයුර් රියද". GTX 1650: 16.3 s vs 15.8 s. On the CPU, beam took 31.5 s vs 18.8 s and fixed less, so the languages' own models use beam search on the GPU only; on the CPU it stays behind the "accurate" setting.
- **Broken characters:** beam search once ended a word inside a Sinhala character ("ව�"). Words lose the replacement character, and are dropped when less than 2 characters are left.
- **Skipped speech:** speech left out before a clip's first word or between two words (3 s or more, with 1 s of sound) is now decoded again, like speech after the last word already was.
- **English words:** web, center, concept, ayurvedic, digital, marketing, brand, social, media, New Zealand, Australia and Canada were added. The plural ending වල is split off a long enough loanword ("නිව්සිලන්වල" becomes "New Zealand වල"; "ගම්වල" stays).
- **Split files:** a file cut into pieces on the Audio row is judged speech or music once, on all its pieces together, so a short piece is no longer left out of the captions.
- Still wrong: the model's own mistakes in Sinhala words ("ඉකුතුමත්" for "එකතු උනොත්"). That's the model's limit on compressed phone audio.
