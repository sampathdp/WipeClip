# Voice translation (desktop)

2 November 2026. In the Transcript panel, **Translate voice to English** says the video's speech again in English, in the speaker's own voice, over the video's own music and sounds. Phase 1: one speaker, from Sinhala, Tamil, Hindi, Kannada or Telugu, into English.

## How it works

| Step | Where | What |
|---|---|---|
| Sentences | `src/lib/editor/dubPlan.ts` `dubSentences` | The transcript's words, cut at sentence punctuation (including "।"), a pause of 0.7 s or more, or 15 s of speech |
| Speech mix | `buildSpeechMix` in `captions.ts`, 44.1 kHz stereo | The same clips and speech tracks captions use; it also reports which audio tracks it mixed |
| Translation | `backend/app/pipeline/dub.py` `translate` | On this computer: Google's MADLAD-400 3B MT (Apache-2.0), CTranslate2 int8 export `Nextcloud-AI/madlad400-3b-mt-ct2-int8`, on the CPU. Each sentence prefixed `<2en>`, batches of 8, beam 2. The model is unloaded before the voice models load. Nothing goes online, the text included (until 13 November 2026 the website translated the text) |
| Voice out | `backend/app/pipeline/dub.py` `separate` | Meta's HT-Demucs fine-tuned vocals model (MIT), ONNX export `StemSplitio/htdemucs-ft-vocals-onnx`. 7.8 s chunks, a quarter overlapping. Background = mix minus voice |
| Speaker sample | `voice_sample` | Up to 9.5 s of whole sentences from the separated voice, longest first, each edge moved to the nearest pause, then 0.3 s of silence |
| English speech | `Voice` | Resemble AI's Chatterbox Turbo (MIT), official ONNX export. Its language model runs in full precision, the rest in 4-bit; greedy decoding with repetition penalty 1.2, as in its model card. Text over 240 characters is said in pieces |
| Timing | `fit` | Each sentence at its own start, sped up with ffmpeg `atempo` (pitch kept, at most 1.3×) to end before the next one starts. What still runs over pushes the next one back. Each sentence is set to the speaker's loudness in that sentence |
| Result | `/api/dub/render` | A 16-bit WAV with 3 channels (English voice, then the background in stereo). The editor splits it into two WAV files |
| Timeline | `runDub` in `VideoEditor.tsx` | Two audio tracks, "English voice" and "Background (voice removed)". Clip sound goes to volume 0 and the speech tracks are muted. All of it is one undo step |

The three models download once after the panel asks (about 4.8 GB), into `speech-models/translator`, `speech-models/voice` and `speech-models/separator`, pinned to a revision. The translator runs on CTranslate2, already bundled for speech recognition; the other two run on onnxruntime, which the engine now bundles: the engine folder went from 316 MB to 435 MB.

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

## Limits (phase 1)

- **One voice:** one sample for the whole video, so a second speaker gets the first speaker's voice.
- **English only:** the translator could take other targets, but the voice model is English-only.
- **Processor only:** speech takes about 4× real time. onnxruntime's DirectML and CUDA providers are the next step.
- **Pacing:** the English lands at the original sentence times, but lip movement isn't matched.
- **Background:** HT-Demucs is trained on music. On speech over sound effects, some effects can be taken out with the voice.
- **Translation quality:** follows the transcript. Misheard words come out as odd English, and noise can come out as nonsense words.

## Tests

- `backend/tests/test_dub.py`: fitting, text pieces, the speaker sample (whole sentences, at most 9.5 s, cut at a pause, ends in silence), and the endpoints (format, order, bad input, model status, an empty translation).
- `tests/desktop/dub.test.ts`: sentence grouping and the WAV encoder.
