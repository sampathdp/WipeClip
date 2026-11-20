# Voice translation (desktop)

2 November 2026. In the Transcript panel, **Translate voice** says the video's speech again in another language, in the speaker's own voice, over the video's own music and sounds. Phase 1: one speaker, from Sinhala, Tamil, Hindi, Kannada or Telugu, into English. Since 20 November, also between English, French, German, Spanish and Italian (see [European languages](#european-languages-20-november-2026)).

## How it works

| Step | Where | What |
|---|---|---|
| Sentences | `src/lib/editor/dubPlan.ts` `dubSentences` | The transcript's words, cut at sentence punctuation (including "।"), a pause of 0.7 s or more, or 15 s of speech |
| Speech mix | `buildSpeechMix` in `captions.ts`, 44.1 kHz stereo | The same clips and speech tracks captions use; it also reports which audio tracks it mixed |
| Translation | `backend/app/pipeline/dub.py` `translate` | On this computer: Google's MADLAD-400 3B MT (Apache-2.0), CTranslate2 int8 export `Nextcloud-AI/madlad400-3b-mt-ct2-int8`, on the CPU. Each sentence lightly cleaned first (`normalize_source`: undecodable characters out, numbers split by recognition joined, a recognition loop said once; the transcript itself unchanged), prefixed `<2en>`, batches of 8, beam 2. The output is put back as plain English (`clean_english`: `&apos;s`, `nuclei ,`, `do n't`). Each translation is checked (`check_translation`) and only suspicious ones are tried again at beam 4. The model is unloaded before the voice models load. Nothing goes online, the text included (until 13 November 2026 the website translated the text) |
| Voice out | `backend/app/pipeline/dub.py` `separate` | Meta's HT-Demucs fine-tuned vocals model (MIT), ONNX export `StemSplitio/htdemucs-ft-vocals-onnx`. 7.8 s chunks, an eighth overlapping (a quarter until 2.0). Background = mix minus voice, so the two add up to the mix exactly |
| Speaker sample | `voice_sample` | Up to 9.5 s of whole sentences from the separated voice, longest first, each edge moved to the nearest pause, then 0.3 s of silence. Only sentences where the voice is 10 dB over the background and the recording isn't clipped, when there are 4 s of those |
| English speech | `Voice` (accurate) or `FastVoice` (fast) | One of two voices, see [Two voices](#two-voices-20-november-2026). Accurate: Resemble AI's Chatterbox Turbo (MIT), official ONNX export. Its language model runs in full precision on 4 threads, the rest in 4-bit; greedy decoding with repetition penalty 1.2, as in its model card. Text over 160 characters is said in pieces (240 until 2.0). Speech much shorter than its text, or babbling, is said again in two halves, then cut at a pause and reported |
| Timing | `schedule` | Each sentence at its own start, sped up with ffmpeg `atempo` (pitch kept, at most 1.3×) to end before the next one starts; running late, the next one is sped up to catch up. When the last ones would run past the end of the video they're sped up and moved earlier into the silence before them; what still doesn't fit is reported, not cut silently |
| Loudness | `sentence_levels` | Each sentence at the speaker's level in it (speech only, not pauses), kept within 4 dB under / 3 dB over their median level and within 3 dB of its neighbours, peaks at most -1 dBFS |
| Result | `/api/dub/render` | A 16-bit WAV with 3 channels (English voice, then the background in stereo), checked before it's sent. The `X-Dub-Report` header says which sentences couldn't be translated, still look wrong, came out too short, how many were sped up, how much doesn't fit and how long the speaker sample was (sentence numbers only, never text). The editor splits the WAV into two files |
| Timeline | `runDub` in `VideoEditor.tsx` | Two audio tracks, "English voice" and "Background (voice removed)". Clip sound goes to volume 0 and the speech tracks are muted. All of it is one undo step, applied only once the result is complete; a failed or cancelled job changes nothing. The report becomes a short note (`dubReportMessage`) |

The three models download once after the panel asks (about 4.8 GB with the accurate voice, 3.3 GB with the fast one), into `speech-models/translator`, `speech-models/voice` (or `speech-models/voice-fast`) and `speech-models/separator`, pinned to a revision. Since 2.0 each file is checked against the hash its revision published (sha256 for large files, the git blob id for small ones) and deleted if damaged, free disk space is checked first, and a model counts as ready only with every file there at its size. The voice and separator sessions stay loaded for 5 minutes after a job when 4 GB of memory is still free, and are let go before the translator loads into less than 5 GB. The translator runs on CTranslate2, already bundled for speech recognition; the other two run on onnxruntime, which the engine now bundles: the engine folder went from 316 MB to 435 MB.

## Findings that shaped it

- **Quantization:**
  - All-4-bit (about 720 MB): 20 s for 15 s of audio, but it dropped "Binance" and said "debt" for "theft".
  - 8-bit: correct, but 178 s, ten times slower on this CPU (i7-9750H).
  - Full-precision language model with 4-bit rest: correct, 31 s for 7.5 s of speech.
- **The speaker sample:** two failure modes, both now prevented:
  - Over 10 s (10.8 s) made the model babble.
  - Ending mid-word made it carry on saying the sample's own Sinhala words ("laptop parigana…") instead of the text.
- **Separation:** on a 60 s Sinhala news report, recognition found 130 words in the voice track and 4 faint ones in the background.

## Measured

On the first 40 s of a Sinhala news report, CPU only (i7-9750H, 6 cores):
- **Time:** 135 s in total: separating 52 s, the speaker sample about 12 s, speaking about 71 s.
- **Content:** recognizing the result again gave all four English sentences, each starting within 0.4 s of the Sinhala original.

## Measured: translation on this computer

13 November 2026, CPU only (i7-9750H):
- **Five languages:** one sentence each in Sinhala, Tamil, Hindi, Kannada and Telugu, all correct English, in 36 s with the model load.
- **A 4-minute Sinhala app tutorial:** 34 sentences translated, mostly natural English. Recognizing the dubbed voice again gave the translated sentences in order.
- **In the app:** a 40 s clip took about 7.5 min from Translate to the new tracks, and its export carried the English voice.

## Voice translation 2.0 (16 November 2026)

Measured with `backend/bench/dub_bench.py` (whole pipeline, per stage and per model part, memory, CPU, and quality) and component tests, on the same laptop (i7-9750H, 16 GB) with Windows' "Silent" power plan, which holds the CPU at its 2.6 GHz base clock. Timings on this machine varied up to 3x between runs of the same code, so old and new were always run one after the other and compared as such.

**Test material** (none of it committed): FLEURS test clips in Hindi, Kannada, Tamil and Telugu with the human English of the same sentences; the Hindi clips over a music bed at about -9 dB (to measure separation against the true parts); a 169 s Sinhala news report, its sentences from the Sinhala speech model as the editor makes them; that report twice (338 s); and FLORES-200 devtest text in all five languages with its human English, for translation alone.

### What changed, and the measurement behind each

| Change | Measured |
|---|---|
| Long English said in pieces of 160 characters, not 240 | Six long sentences (180-330 characters): words left out 11.3% -> 1.0%, word errors 13.4% -> 4.1%, speaking 254 s -> 179 s. Very likely the main cause of "not all of it is translated" |
| Translation output put back as plain English | MADLAD wrote `There &apos;s`, `nuclei ,`; the voice read them as written. chrF++ is unchanged (it splits punctuation off) |
| Translations checked, suspicious ones tried again at beam 4 | FLORES-200, 40 sentences x 5 languages, chrF++: 60.0 -> 60.2 (Hindi +1.0), translation 25% longer |
| Separator chunks overlap an eighth, not a quarter | 21% less separating; background SNR 8.57 -> 8.80 dB, voice SNR 17.68 -> 17.92 dB; at the chunk joins the error is lower than elsewhere (-11.6 against -8.7 dB) |
| Language model on 4 threads, not 6 | 10.8 and 10.7 tokens/s, the same tokens: it's bound by memory speed. Leaves the editor two cores |
| The end no longer cut | Sinhala 40 s: 1.95 s of English was cut at the end of the video; now 0 s |
| Levels kept close | Sinhala 40 s: spread 3.5 -> 2.5 dB, largest jump between sentences 8.1 -> 4.7 dB, peak 1.0 (clipping) -> 0.89; Hindi with music: spread 5.7 -> 1.6 dB |
| Speaker sample from clear sentences only | Hindi with music: speaker similarity 0.457 -> 0.562 (cosine of the voice model's own speaker embeddings, generated sentences against the speaker's separated voice) |
| Babble guard | A word cut off at the end of the video translated to "A" and was said as 2.8 s of noise; speech that long for its text is now said again, then cut at a pause and reported |
| Cancelling | Mid-speech, the job stopped within the same step (0.0 s), the lock was free and the next job ran |

### Tried and not used

| Tried | Result |
|---|---|
| Several sentences through the language model at once (batch 2-8) | 1.4-2.4x the tokens per second, but this ONNX export doesn't honour its attention mask: padding a shorter sentence changed its first logits by up to 5, and 4-7 of 8 sentences came out different, some 16 s longer (babble). Rows of one length batch exactly. One at a time keeps the output token for token the same |
| Embedding cache | Exact, no measurable gain (the language model is the cost). Kept - it is also where a trap was found: the embedding model takes its text or speech-token table by the *last* id it's given, so text goes in whole and speech ids as one-token rows |
| KV cache kept in onnxruntime (IOBinding) | The same tokens, no gain (10.76 against 10.87 tokens/s). Note: `IOBinding.get_outputs()` wraps items of a temporary vector - reused, they corrupt memory; `get_outputs_as_ortvaluevector()` has to be kept alive |
| Decoder in fp32 or fp16 | 4-bit 0.65x real time, fp32 0.70x (and 31 s to load), fp16 1.78x. Its output isn't repeatable run to run (it starts from noise), so waveforms can't be compared directly |
| Separator in fp32 | The same speed and SNR as the fp16-weights file, twice the download |
| Optimised graph saved to disk | Separator load 10 s -> 0.5 s, but the saved graph ran 3-4x slower per chunk |
| Graph optimisation levels | No difference |
| Beam 1 / beam 4 | chrF++ 59.6 in 0.76 of the time (Sinhala -1.7) / 60.6 in 1.4 times the time. Beam 2 kept |
| Reading each sentence with the one before (target prefix) | chrF++ 60.4 but Sinhala 0.7 lower, 2.7x the translation time. In the code (`context`), off |

### Whole pipeline, 1.0 against 2.0

16 November 2026, every case on 1.0 (the code at `HEAD` before 2.0, `--root`) and then 2.0, one after the other. Word errors: each placed English sentence recognised again on its own by the general speech model, against the text it was given. Speaker similarity: the voice model's own speaker embeddings (CAMPPlus), generated sentences against the speaker's separated voice; FLEURS clips are a different speaker each, so only the Sinhala cases measure one person.

| Case | Time 1.0 -> 2.0 | Separate | Speak | Word errors | Words missing | Level spread / largest jump (dB) | Quietest sentence (dBFS) | Peak | Speaker similarity |
|---|---|---|---|---|---|---|---|---|---|
| Kannada 40 s | 143 -> 124 s (-13%) | 49 -> 36 s | 61 -> 56 s | 3.4% -> 3.4% | 1.7% -> 1.7% | 1.3 / 3.2 -> 0.7 / 1.7 | -16.7 -> -17.3 | 1.0 -> 0.89 | 0.626 -> 0.625 |
| Tamil 42 s | 119 -> 108 s (-10%) | 40 -> 35 s | 50 -> 43 s | 10.6% -> 6.4% | 0.0% -> 0.0% | 10.7 / 25.7 -> 1.4 / 3.1 | -40.4 -> -26.6 | 0.916 -> 0.324 | 0.443 -> 0.438 |
| Telugu 44 s | 143 -> 139 s (-3%) | 44 -> 41 s | 68 -> 65 s | 0.0% -> 0.0% | 0.0% -> 0.0% | 3.9 / 10.2 -> 1.8 / 3.1 | -35.5 -> -30.1 | 0.351 -> 0.379 | 0.632 -> 0.61 |
| Hindi 45 s | 167 -> 155 s (-7%) | 45 -> 39 s | 89 -> 82 s | 24.1% -> 20.2% | 3.4% -> 0.0% | 5.8 / 8.3 -> 1.6 / 2.6 | -35.9 -> -29.5 | 0.958 -> 0.515 | 0.484 -> 0.494 |
| Hindi 45 s + music | 168 -> 154 s (-9%) | 44 -> 39 s | 91 -> 82 s | 8.0% -> 7.1% | 1.1% -> 0.0% | 5.7 / 8.1 -> 2.1 / 3.8 | -35.7 -> -29.9 | 1.0 -> 0.412 | 0.461 -> 0.561 |
| Sinhala news 40 s | 160 -> 164 s (+3%) | 39 -> 34 s | 86 -> 96 s | 3.5% -> 5.7% | 1.2% -> 1.1% | 3.5 / 8.1 -> 1.0 / 2.2 | -19.7 -> -22.1 | 1.0 -> 0.89 | 0.708 -> 0.701 |
| Sinhala news 169 s | 537 -> 532 s (-1%) | 140 -> 120 s | 334 -> 346 s | 11.0% -> 8.7% | 2.3% -> 1.7% | 2.8 / 11.8 -> 0.6 / 1.7 | -20.6 -> -20.9 | 1.0 -> 0.89 | 0.799 -> 0.806 |
| Sinhala news 339 s | 1080 -> 1026 s (-5%) | 279 -> 242 s | 699 -> 674 s | 10.7% -> 10.0% | 2.3% -> 1.9% | 2.8 / 11.7 -> 0.6 / 1.9 | -20.6 -> -21.6 | 1.0 -> 0.89 | 0.784 -> 0.793 |
| **All 8** | **2518 -> 2401 s (-5%)** | | | | | | | | |

- **English cut at the end of the video:** Sinhala 40 s 1.95 s -> 0 s; none in the other cases with either version.
- **Memory:** peak 5.4-5.5 GB in both (the translator, ~3 GB, is the most of it). **CPU:** 4.8-5.8 cores in use -> 4.0-4.9, as the language model now leaves two cores to the editor.
- **Sinhala 40 s** was 3% slower: its last fragment (a word cut off at 40 s) translated to "A" and babbled; 2.0 says it again, cuts it at a pause (2.9 s -> 1.5 s) and reports it. Its 2 extra word errors (5 against 3, of 88 words) are in a sentence the translator already got wrong from a misheard transcript.
- **Reports:** every case's report matched what was measured; a false "check this" for "dollar" written as "$" was found here and fixed (`_term_kept`).
- **Time** varied between runs of the same code by up to 3x on this machine (see above); within each pair the two ran back to back.

## Two voices (20 November 2026)

The panel offers two voices, **Fast** and **Accurate**. The engine recommends one for the computer (`recommended_voice`): Accurate with 12 GB of memory installed and 6 physical cores, Fast otherwise. The user's pick is remembered on the device (`dubVoiceWanted`). `/api/dub/models` reports each voice's download, and `/api/dub/render` takes `voice`.

| | Accurate | Fast |
|---|---|---|
| Model | Chatterbox Turbo (MIT), official ONNX export | Kyutai's Pocket TTS, 100M parameters. Weights CC-BY-4.0 (Kyutai); ONNX conversion `stephvax/pocket-tts-onnx` (CC-BY-4.0, made with PocketTTS.cpp, MIT), folder `english_2026-10`: language model int8, the rest fp32 |
| Download | 1.7 GB | 212 MB |
| Tokenizer | `tokenizers` | `sentencepiece` (Apache-2.0, added to the engine, about 3 MB) |

**How the fast voice runs** (`FastVoice`, numpy and onnxruntime only):
1. The sample (24 kHz) goes through the codec's encoder, after a start vector (`bos_before_voice.npy`), into the language model's state once.
2. Each text starts from that state, gets its tokens embedded, then the model makes one 32-number latent per 80 ms frame. A flow step samples it at temperature 0.3, seeded from the text, so the same text says the same thing every time.
3. It stops 3 steps after the end-of-speech logit goes over -4, or at (tokens / 3 + 2) seconds.
4. The codec's decoder turns 12 frames at a time into sound, with its state carried along.
5. The state's size is fixed by the graphs' inputs. Flags start true and the rest at zero; the conversion's bundle lists no starting values, so these come from the older conversion's manifest. Zeros and NaN in the attention cache gave the same sound.
6. Pieces, length checks and halves are shared with the accurate voice (`_Speaker`). Text over 50 tokens is said in halves.

**Not used:** Kyutai's own repo is gated (sign-in and terms), so the app can't download it. The model card asks not to clone voices without consent; the panel already says to use only voices you have the right to use.

**Measured** on the i7-9750H (6 cores, 16 GB). Six FLEURS Hindi test speakers (3 women, 3 men), each sample 8-9.4 s, each saying the same 10 English sentences (tutorial and news style, with numbers and names). Word errors: the general speech model on each sentence. Speaker similarity: the cosine of CAMPPlus speaker embeddings between each sentence and its speaker's sample, as in `dub_bench.py`. The accurate voice is conditioned on CAMPPlus embeddings itself, so the measure favours it somewhat.

| | Accurate | Fast |
|---|---|---|
| Speaking (4 threads) | 3.59x real time | **0.35x** (0.37x on 2 threads) |
| Learning the voice | 1.3-13.7 s | 0.9-1.2 s |
| Word errors | 0.4% (one: "Rs 250" for "250 rupees") | **0%** |
| Speaker similarity (different speakers: 0.43-0.45) | **0.842** (lowest 0.709) | 0.723 (lowest 0.558) |
| Memory of the voice alone | 2.2 GB | small |

The whole pipeline on a 49 s video of 6 FLEURS Hindi clips: **88 s fast against 206 s accurate**.

| Stage | Fast | Accurate |
|---|---|---|
| Load + translate | 22 s | 22 s |
| Separate | 50 s | 53 s |
| Learn the voice | 3.5 s | 18 s |
| Speak | 12 s | 113 s |

- **Peak memory:** 5.3 GB for both (the translator).
- **Recognized again:** the two English tracks gave the same six sentences, apart from how each said "pH".
- **Biggest cost now:** with the fast voice, separating the voice is. HT-Demucs runs at about 1x real time on this processor.

**GPU, tried and not used:** onnxruntime-directml 1.24.4 on the GTX 1650, which would have run on any Windows graphics chip, including integrated ones:

| Part | Result |
|---|---|
| Separator | Out of graphics memory (4 GB) |
| Speaker encoder | MultiHeadAttention fails |
| Embedding | Slice fails |
| Language model | Wrong output: 14 speech tokens instead of 183, and slower (1.9 against 8.0 tokens/s) |
| Decoder | Runs, the same tokens, no faster (11.7 s against 12.8 s) |

The 4-bit operators of these exports aren't supported by DirectML.

## European languages (20 November 2026)

Voice translation now works between **English, French, German, Spanish and Italian**, in any direction, as well as from the five Indian languages into English. The panel has an **Into** list. Its default is English, or French for English speech; the last pick is remembered on the device.

| Part | What changed |
|---|---|
| Translation | MADLAD gets `<2xx>` for the target. Its output is cleaned per language: English contractions, French and Italian elisions ("l' homme"). |
| Checks | From a Latin-script source, "term" is off (every word would be one). "Untranslated" means 80% or more of the words, from 5 up, are the source's own. Accented letters count as Latin everywhere. |
| Length limits | Measured per pair on FLORES (below). Other European pairs use the widest of them. |
| Voices | The fast voice has one model per language: English (212 MB), French, German, Spanish and Italian (440 MB each, 24 layers). The accurate voice is English only, so for other targets the engine uses the fast one. |
| Numbers | The French, German, Spanish and Italian voices read digits as noise: "250 euros" came out as "Gan Rori Sooro" for all 6 test speakers. `numbers.py` writes numbers out in words first. It covers whole numbers, decimals, percentages, and €, $ and £ ("un euro", "ein Euro", "veintiún euros"). Dotted sequences ("2.0.1") are left as written. |
| Endpoints | `/api/dub/models?target=` and `/api/dub/render` take `target`. A source in the target language, an unknown target, or a voice that doesn't speak the target answers 400. |

**Translation, measured:** MADLAD-400 3B on 40 FLORES-200 devtest sentences per pair, with retries off.

| Pair | chrF++ | Pair | chrF++ |
|---|---|---|---|
| fr→en | 68.7 | en→fr | 72.1 |
| de→en | 65.2 | en→de | 63.7 |
| es→en | 60.4 | en→es | 56.1 |
| it→en | 60.4 | en→it | 58.3 |
| fr→de | 57.8 | de→fr | 63.1 |
| fr→es | 53.5 | es→fr | 60.5 |
| fr→it | 59.1 | it→fr | 60.5 |

For comparison, the Indian languages into English score about 60. The 2-3 sentences per pair flagged "number" were real mistakes: years changed, such as 1977 to 1981 or 1877. The checks catch these, and the app tries them again.

**French voice, measured:** the same 6 test speakers and 10 French sentences, scored with the general speech model.
- **Word errors:** 4.2%, then 1.9% with numbers in words. The slips left are "pluies" for "puits" and "l'accord" for "la Corse".
- **Speed:** 0.86x real time, against English's 0.35x.
- **Speaker similarity:** 0.71, where a different speaker scores 0.47.

**Whole pipeline, fast voice:**
- **French to English:** 52 s of FLEURS French took 100 s. Recognized again, all six English sentences were there.
- **English to French:** 50 s took 127 s, because the French voice is slower. Turbo read all seven French sentences back.
- **Peak memory:** 5.3 GB for both (the translator).

## Limits

- **One voice:** one sample for the whole video, so a second speaker gets the first speaker's voice.
- **Targets:** English, French, German, Spanish and Italian. The accurate voice speaks English only. The fast voice's conversion also has Portuguese, which isn't wired in yet.
- **Processor only:** with the accurate voice, speaking takes about 2.5-4x real time on this laptop; the fast voice takes 0.35x. DirectML was tried and doesn't work with these exports (see Two voices); CUDA would help NVIDIA cards only, and needs about 1 GB of NVIDIA libraries more.
- **Memory:** the translator (about 3 GB) sets the peak of 5.3 GB with either voice, so an 8 GB computer is still tight.
- **Translation context:** each sentence is translated on its own; reading it with the one before was measured and left off (above).
- **Speaker overlap:** the sample can't tell two people talking at once from one; clear, unclipped sentences are preferred, but a second voice in them isn't detected.
- **Pacing:** the English lands at the original sentence times, but lip movement isn't matched.
- **Background:** HT-Demucs is trained on music. On speech over sound effects, some effects can be taken out with the voice.
- **Translation quality:** follows the transcript. Misheard words come out as odd English, and noise can come out as nonsense words.

## Tests

- `backend/tests/test_dub.py` (47): the fast voice's loop on stand-in graphs (stopping after the end, the frame limit, halves over 50 tokens, the codec's state carried, the same text the same sound), the voice passed through render and the endpoints, the recommendation by memory and cores, scheduling (catching up, moving the end into silence, reporting what can't fit), loudness limits, source clean-up and English clean-up, translation checks, retrying only suspicious translations, context with a target prefix, the embedding tables, kept sessions (reuse, timer, low memory), text pieces and halves, the length check and cutting babble at a pause, the speaker sample (whole sentences, at most 9.5 s, cut at a pause, clear sentences preferred), and the endpoints (format, order, bad input, unsupported language, glossary, the report's sentence numbers, which step failed, model status, an empty translation).
- `backend/tests/test_speech.py`: download hashes (sha256 and git blob ids), readiness needing every file at its size, free disk space checked first.
- `tests/desktop/dub.test.ts`: sentence grouping, the WAV encoder, and the report note.
- `backend/bench/dub_bench.py`: the benchmark (`prepare`, `run` with `--root` to run another version's code, `rescore`, `translate`).
