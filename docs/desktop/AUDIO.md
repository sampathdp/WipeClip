# Audio quality and camera presentation (Phase 6)

31 October 2026. Noise reduction for audio tracks with a before/after switch, loudness normalization with a limiter, a mixer with meters, mute and solo, sync fixes in the export, and webcam layouts. Everything runs on the user's device; nothing is uploaded for audio processing.

## Audit: what existed

| Part | Where | State before this phase |
|---|---|---|
| Audio tracks | `types.ts` `AudioClip` | Volume 0–200 %, fades, mute, voice effects, beats, captions mode |
| Clip sound | `Clip.volume` | 0–200 % per clip; preview capped at 100 % |
| Noise cleanup | `audio_clean.py`, `/api/audio/clean` (local engine only) | Clips only, fixed strength, made a new track; no strength choice, no A/B, not for recorded microphone tracks |
| Ducking | `ducking.ts`, `editor.py duck_gain_expr` | Speech regions stored on the music track, same curve in preview and export |
| Export mix | `editor.py build_export_args` | `amix` then `alimiter` only when there were added tracks |
| Preview audio | `PreviewPlayer.tsx` | Element volume (max 100 %); Web Audio only for voice effects |
| Waveforms | `media.ts generateWaveform` | Peaks normalized per file (drawing only, no absolute level) |
| Webcam | `importPlan.ts webcamLayer` | A video layer in the bottom-right corner; shape masks (circle, rectangle) by hand |
| Background removal | `bg_removal.py`, `chromaKey.ts` | Image cleanup (rembg) and chroma key on layers; nothing for live webcam video |

**Bugs found and fixed** (each measured, then covered by a test):

| Bug | Effect | Fix |
|---|---|---|
| `alimiter` without `latency=1` | Every export's sound was 5 ms late and lost its last 5 ms | `master_chain` compensates the look-ahead |
| `afftdn` delay not compensated | "Clean up audio" copies played 25 ms behind the picture | `audio_clean.filter_delay` measures the delay on an impulse; the input is padded and the output trimmed by it |
| ffmpeg's mono upmix | Mono sources (microphones) exported 3 dB quieter than the preview and players play them | Mono sources are upmixed with `pan=stereo\|c0=c0\|c1=c0` (`editor._stereo`) |
| No limiter without added tracks | Clips at 200 % could clip in the export | The master limiter now always runs |
| Ducking regions not moved by ripple cuts and inserts | After a cut, music dipped at the old times | `ripple.ts` moves, trims and splits the regions |
| Voice effects on disk sources (desktop) | Web Audio got no sound from cross-origin asset URLs (silent) | Routed elements switch to `crossOrigin="anonymous"`; the asset protocol answers CORS |

## What's new

**Noise reduction for audio tracks** (Audio panel > Noise reduction, desktop app):

- Strengths Light, Medium and Strong: `afftdn` reduction of 14.5, 23 and 33 dB, against the noise floor measured from the quietest 10 % of the track.
- The local engine writes a cleaned copy of the whole source file, time-aligned with it. The original is never modified.
- `AudioClip.clean = { sourceId, strength, bypass }` names the copy. Every part of the same file gets it, such as a microphone split by cuts.
- **Compare** switches between Cleaned and Original while playing. The export uses whichever is selected.
- Remove, or undo, goes back to the original.
- A project opened without the copy plays the original (`playedSourceId`).

**Loudness normalization** (Audio > Mix > Loudness):

| Preset | Target |
|---|---|
| Online video | -14 LUFS |
| Voice and podcasts | -16 LUFS |
| Broadcast | -23 LUFS (EBU R128) |

- **Measuring:** picking a preset measures the whole mix (`programMix.ts` renders it offline at 16 kHz, `loudness.ts` measures BS.1770-4 integrated loudness with gating). It stores one fixed gain on `Project.master`.
- **Applying:** the preview and the export both apply that gain, then a peak limiter at -1 dBFS.
- **Peak protection:** a boost is capped at +20 dB, and at what the limiter can absorb (at most 4 dB off the loudest peak). The panel says when the target wasn't reached.
- **Out of date:** if the mix changes after measuring, the panel says "The mix changed since it was measured" (`mixKey`).
- **Off:** no gain at all. The limiter stays on, so the export never clips.

**Mixer** (top of the Audio tool):

- One row for the clips' own sound ("Video sound": volume 0–200 % on top of each clip's volume, and mute) and one per audio track.
- Each row has a peak/RMS meter (-60…0 dBFS, red at the limiter's ceiling, 1.2 s peak hold), volume, M and S.
- A master meter after the limiter.
- **Solo** is only for listening: it isn't saved or exported. The panel says so while a track is soloed. Mute is exported.

**Ducking:** unchanged in behavior. Its regions now follow ripple cuts and inserts.

**Webcam layouts** (video layer panel > Webcam layout):

- Shapes: Circle, Rounded or Rectangle. Sizes: S, M or L, a fraction of the canvas's short side. Any of the four corners.
- **Side by side:** on landscape canvases the webcam fills the right third and the screen the left two thirds. On portrait canvases the screen is at the top and the webcam fills the space below.
- **Same output everywhere:** a layout is just the layer's position, width and shape mask. Rounded rectangles are new in `shapeMask.ts` (`radius`). The preview and the export already render these from the same mask PNG.
- **Canvas changes:** the preset is kept on the layer (`camLayout`), and the layer is placed again when the canvas size changes. That isn't its own undo step: undoing the canvas change brings the old placement back.
- **Free placement:** dragging the layer switches to free placement. Free (or leaving side by side) puts the clips back to full size.

## Voice tone (7 November 2026)

**Audio panel > Voice tone**, on every audio track (microphone, voiceover, uploaded audio).

**Enhance voice** (one click), each part one undo step:
1. The "Enhance voice" tone preset.
2. Desktop app only: Medium noise reduction, unless the track already has a cleaned copy.
3. The mix's loudness measured again: -16 LUFS, or the target already chosen.

The message says what was done, and if the noise reduction failed.

**Presets** (`voiceTone.ts` `TONE_PRESETS`):

| Preset | Low cut | Bass | Boxiness | Clarity | Even out | Soften "s" |
|---|---|---|---|---|---|---|
| Enhance voice | on | -1 | -2 | +3 | 50 % | 40 % |
| Podcast | on | +1 | -2 | +2 | 75 % | 50 % |
| Warm | on | +3 | 0 | -2 | 40 % | 30 % |
| Fix thin mic | off | +5 | -1 | -2 | 40 % | 20 % |
| Reduce boom | on | -5 | -3 | +1 | 30 % | 0 |

**Adjust settings:**
- Cut rumble: a 2-pole Butterworth highpass at 80 Hz.
- Bass: low shelf at 120 Hz. Boxiness: peak at 400 Hz (Q 1). Clarity: high shelf at 4 kHz. Each ±12 dB.
- Even out the level: a compressor, RMS detection.
  - Threshold -12 to -30 dBFS, ratio 1.5 to 4, attack 10 ms, release 150 ms, knee 2.83.
  - Makeup gain: half of what a -6 dBFS signal loses, at most 12 dB.
- Soften "s" sounds: de-esser intensity 0–1.
- A manual change makes the preset "Custom".

**The tone is set on every part of the same file**, like noise reduction: a microphone split by cuts keeps one sound.

**Same sound everywhere:**

| | Where | How |
|---|---|---|
| Wire numbers | `toneWire` | The exact filter numbers, sent to the export as `tone` |
| Preview | `audioMixer.ts` | element → tone → voice effect → level. `BiquadFilterNode`s, then the `voice-dynamics` AudioWorklet |
| Loudness measurement | `programMix.ts` | The same graph offline; the tone is part of `mixKey`, so a change marks the measurement out of date |
| Export | `editor.py tone_chain` | `highpass`, `lowshelf`/`highshelf` (slope 1), `equalizer`, `deesser`, `acompressor`, before the track volume |

- **The EQ** is the Audio EQ Cookbook on both sides (the Web Audio spec and ffmpeg).
- **The de-esser and compressor** (`DYNAMICS_SOURCE`) are a line-by-line port of ffmpeg 7.1's `af_deesser.c` and `af_sidechaincompress.c` (LGPL-2.1+, the same licence as the bundled ffmpeg).
- **A mono microphone** is processed as one channel in the preview. The export's identical stereo channels give the same result.

**Measured** on a test voice (loud and quiet vowels, "s" hiss, 40 Hz rumble), largest difference below the peak:

| Check | Result |
|---|---|
| Spec biquads + worklet code (Node) vs ffmpeg 7.1 | EQ -146 dB, de-esser exact (-400 dB), compressor -106 dB, presets -105 to -123 dB |
| Headless Chrome (real `BiquadFilterNode` + worklet) vs ffmpeg | 8/8: -94 to -149 dB (Chrome filters in 32-bit floats) |
| Low cut | 40 Hz rumble down 9–15 dB |
| Compressor (75 %) | Loud/quiet gap shrinks by more than 3 dB |
| De-esser (60 %) | "s" bursts down more than 1 dB, vowels within 0.5 dB |
| Toned track (Podcast) in an export | Click still within 3 ms of its timeline time |

**Also fixed:** the Telephone and Radio voice effects set the preview filters' Q as 0.707 dB, but Web Audio reads lowpass/highpass Q in dB. That was slightly resonant, unlike the export's Butterworth. It's now -3.01 dB (Butterworth).

**Tests:**
- `tests/desktop/voiceTone.test.ts`: 6 tests. The ffmpeg comparison runs when ffmpeg is found (the engine's copy, `FFMPEG`, or PATH).
- `backend/tests/test_voice_tone.py`: 4 tests. Chains equal `tests/fixtures/tone-chains.json`, validation, sync.
- `node tests/desktop/manual/preview-tone.mjs`: headless Chrome, 8/8.

**Limitations:**
- Only audio tracks. The video clips' own sound (a camera video's voice) has no tone yet.
- The preview's compressor and de-esser keep their state across seeks. The export starts each track fresh, so the first few milliseconds after a seek can differ.
- If the worklet can't load, the preview plays the EQ without the dynamics. The loudness measurement then leaves them out too.

**Manual tests still required:**
1. Enhance voice on a real microphone recording in the desktop app: listen, compare with Off, export, and check that it sounds the same.
2. CPU use of several toned tracks during long playback on a low-end laptop.

## Volume curves, distortion repair, microphone check (7 November 2026)

### Volume curve (`envelope.ts`)

**Points of gain on an audio track**, on top of its volume, fades and ducking.
- Each point is 0–200 % (silent to +6 dB).
- Linear between points, held before the first and after the last.
- **Stored in seconds of the audio file** (like beats): trims, splits and ripple cuts keep each point on the sound it was set on. A part made by a split carries the whole curve.

**Editing:**
- **Timeline:** select the track. Double-click it to add a point where you click (height = level). Drag a point; it stays between its neighbors and inside the track. Double-click a point to remove it.
- **Audio panel > Volume curve:** Add point at playhead (on the current curve, so nothing changes until it's moved), Clear curve.
- The line shows on every track that has a curve. The dashed middle line is 100 %.
- A drag is one undo step.

**Same everywhere:**
- The preview and the loudness measurement use `trackGainAt` (mix.ts).
- The export uses `editor.py envelope_expr`: the same points through `keyframe_expr` with linear ease, `volume='…':eval=frame`, next to the ducking.
- The curve is part of `mixKey`.

### Distortion repair (clipping)

**Audio panel > Clean up > Repair distortion** (desktop app), with or without noise reduction (strength can now be Off). Enhance voice includes it.

**How:**
- Each run of 2+ samples at the file's peak level is redrawn as a cubic Hermite curve between its neighbors, with their slopes (`audio_clean.repair_clipping`, vectorized).
- Streamed in 10 s chunks, cut where two samples in a row are below the ceiling, so no run is split.
- Then the usual cleanup chain. The copy is scaled to a 0.95 peak.
- The make-up gain comes back in `X-Clean-Gain` and is stored as `AudioCleanup.gain`. The preview, the measurement and the export play the copy at it (`cleanGain`), so Compare is level-matched.
- The export's track volume limit is raised to 8 (200 % × the make-up gain).

**Measured** on a two-partial tone driven into clipping (distortion = energy outside the tone):

| Driven | Distortion before → after | Make-up gain | 60 s took |
|---|---|---|---|
| 1.5× | -32.3 → -62.0 dB | 1.23 | 5.8 s |
| 2× | -22.1 → -40.6 dB | 1.56 | 4.5 s |
| 3× | -17.6 → -30.6 dB | 2.09 | 5.0 s |

- ffmpeg's `adeclip` was tried first: it got -25.9 dB at 2× and runs at 1.3× real time (a 10-minute track would take 13 minutes). The repair itself takes about 2 ms per second of audio; decoding and encoding take the rest.
- A clean recording is barely touched. A smooth crest has a few samples within 0.1 % of the peak; redrawn, they come out the same curve (error under -80 dB).
- Timing: the repaired copy lines up with the plain cleaned copy at lag 0.

**Review's clipping suggestion** now explains that turning the volume down doesn't undo clipping, and points to Repair distortion.

### Microphone check (recorder, `micCheck.ts`)

**Check my microphone (5 s)** under the microphone's level meter:
- It records 5 seconds from the same stream the recording will use (with its echo cancellation, noise suppression and gain control).
- It says how it sounds, gives one tip per problem, and plays the take back.
- Nothing is kept. Choosing another microphone starts over.

| Problem | When (dBFS of 20 ms frames) | Tip |
|---|---|---|
| No sound / no speech | Speech level under -70, or under 1 s of speech | Check the microphone choice and mute switch / talk the whole time |
| Distorted | Any frame with 3+ samples at full scale | Move back, lower the input level |
| Close to too loud | Peak over -6 and speech over -12 | Same |
| Quiet | Speech (90th percentile) under -38 | Move closer, raise the input level |
| Noisy room | Room (10th percentile) over -50, or under 20 dB below the speech | Fans, windows, move closer |

**Checked:**
- Synthesized speech (two voices): as is → "Sounds good". ×0.05 → quiet. With noise at amplitude 0.02 → noisy room. ×6 → distorts.
- Headless Chrome with a fake microphone: MediaRecorder (WebM/Opus) → decodeAudioData → the check works. Chrome's fake beep is at full scale, and it's reported as distorting.

**Limitation:** the take is compressed (Opus). A peak very close to full scale can come back just over it, so "distorts" is the safe side of the call.

### Tests

| Command | Result |
|---|---|
| `tests/desktop/audioRepair.test.ts` (9 tests) | Curve math, normalizing, add-on-curve, file time through a ripple cut, drawing, export rows, mix key; make-up gain; mic check verdicts |
| `backend/tests/test_declip.py` (6 tests) | Repair quality at 1.3–3×, clean audio barely touched, end runs kept, the copy (scaled, aligned, less distortion), chunk seams, the engine's header |
| `backend/tests/test_envelope.py` (3 tests) | Exported curve level at six times through an offset track, expression = `curveAt`, validation |

### Manual tests still required

1. **Timeline curve editing in the app:** add, drag and remove points on a selected track, undo, and export. Check by ear that the dip lands where it's drawn.
2. **Repair distortion on a real clipped recording:** compare Cleaned and Original while it plays, then export.
3. **Microphone check with real microphones:** a headset, a laptop microphone, and one turned up too high, in the desktop app (WebView2).

## How preview and export stay the same

| | Preview | Export |
|---|---|---|
| Track file | `playedSourceId` | same (`exportProject.ts`) |
| Track gain | `trackGainAt` (volume, fades, ducking) | volume, duck expression, `afade` (same numbers) |
| Video sound | `clipMixVolume` | sent as each clip's volume |
| Master gain | `masterGainDb` on the Web Audio master | `masterGain`, `volume=…dB` in `master_chain` |
| Limiter | AudioWorklet peak limiter, ceiling 0.89 | `alimiter limit=0.89 latency=1` |
| Mono sources | browser plays them on both sides at full level | `pan=stereo\|c0=c0\|c1=c0` |
| Webcam | layer + CSS mask from the mask PNG | layer + the same PNG (`alphamerge`) |

**Where the preview mixer is used:** the preview plays through Web Audio (`audioMixer.ts`) only once something needs it: a level above 100 %, a master gain, a voice effect, or the open mixer (for the meters). Otherwise elements play directly, as before.

**Known differences:**

- The preview limiter has no look-ahead, so a sharp transient can sound slightly different.
- Voice effects' pitch shift uses different methods in the preview and the export (as before).

## Sync

Tested with real ffmpeg on media whose picture flashes exactly when its sound clicks (`backend/tests/test_audio_mix.py`):

| Scenario | Result |
|---|---|
| Speed change (2×) and a crossfade | every click within one frame of its flash |
| Trimmed clips with +6 dB master gain | same |
| An added track at its timeline time | within 3 ms |
| The limiter (`master_chain`) | adds no delay (impulse at the same sample, same length) |
| A cleaned track copy | clicks within 1 ms of the original, same length within 25 ms |
| Ripple cut/insert with ducking and a cleaned microphone | regions and offsets move with the footage (`tests/desktop/audio.test.ts`) |

## Graceful handling

- **No sound, or silent tracks:** measuring says there's no sound to measure, or that the mix is silent. No gain is set.
- **Muted tracks** are left out of the measurement and the export.
- **Files that can't be read:** decoding fails or the file is over 400 MB. The measurement leaves them out and names them.
- **A file without audio, or in a format the engine can't read:** cleaning gets "The file may have no sound, or a format that can't be read." The engine returns 400 and the project is unchanged.
- **Missing files:**
  - A missing cleaned copy falls back to the original.
  - A missing webcam file leaves the layer where it is.
  - A missing track file in the export fails the export with an error. It never hangs.
- **Browser version (no local engine):** noise reduction explains that it runs in the desktop app. Loudness, the mixer and webcam layouts work in both versions.
- **No Web Audio:** the preview plays directly (levels capped at 100 %).
- **Older projects:** they open unchanged. `master` is absent, so the defaults apply.

## Performance and resources

Measured on this machine (Windows 11, 12 threads):

| What | Measured |
|---|---|
| Loudness measurement (the math) | 10 min of mix: 215 ms; 1 h: 1.1 s |
| Offline mix render | not timed separately; the headless run measured an 8 s project instantly. Memory: 16 kHz mono, about 38 MB per 10 min, plus the decoded sources (like captions) |
| Noise reduction (local engine) | 60 s mono: 4.7 s; 10 min: 42 s (about 14× real time). The copy is AAC 192 kb/s, about 1.2 MB per minute |
| Preview mixer | One analyser per track and a small worklet. CPU not measured; no audible effect noticed in the headless run |
| Package size | No new dependencies. New source about 42 KB (`loudness`, `mix`, `programMix`, `audioMixer`, `webcamLayout`, `MixerPanel`) |

The export's timeline limit (10 minutes) bounds the measurement's memory.

## Webcam background removal: not implemented

**Update (7 November 2026):** implemented in the engine instead of the browser; see [WEBCAM-BACKGROUND.md](WEBCAM-BACKGROUND.md). The text below is this phase's original decision.

**Decision:** not added in this phase. Chroma key on video layers (green screen) still works for webcams.

The preview and the export must show the same matte, which means a per-frame mask for the whole webcam track. The options checked:

| Option | Why not now |
|---|---|
| The engine's rembg / ISNet (already bundled for images) | 0.3–1 s per frame on a CPU: hours for a 10-minute webcam track |
| A browser segmentation model (for example MediaPipe Selfie Segmentation, Apache-2.0, about 250 KB) | Fast enough to preview. The export would need the matte encoded per frame (WebCodecs) and composited by ffmpeg: a new pipeline, plus the CPU/GPU cost and a model download to measure first |

**Next step if wanted:** a browser model that renders the matte to an alpha video next to the webcam file, used by both the preview and the export.

## Tests

| Command | Result |
|---|---|
| `npm run desktop:test:js` (`tests/desktop/audio.test.ts`, 19 tests) | 214/214 pass |
| `python -m pytest tests` in `backend` (`tests/test_audio_mix.py`, 12 tests) | 93/93 pass |
| `node tests/desktop/manual/preview-audio.mjs <url> <out>` (headless Chrome, production build) | 9/9 |
| `preview-focus`, `preview-tutorial`, `preview-draft`, `preview-highlights` | pass |
| `tsc` (root and desktop), ESLint on changed files | pass |

**`audio.test.ts` covers:**

- K-weighting against the standard's table, reference-tone loudness and gating.
- Normalization limits: boost cap, peak protection, cutting.
- The played file, video-sound volume and mute, the track gain curve.
- Solo, `mixKey` staleness and meter math.
- Ducking and a cleaned microphone through ripple cuts.
- Undo and redo of every audio change, and project migration.
- Webcam geometry across five canvas sizes and three camera aspects: inside the frame, corner margins, true circles, size relative to the short side, and side by side.
- Rounded mask corners, and placing again on a canvas change.

**`test_audio_mix.py` covers:**

- Limiter latency.
- A/V sync through speed changes, transitions, trims and added tracks.
- Clipping, with two 200 % tracks plus +12 dB staying under 0 dBFS.
- A missing track file.
- Mono level.
- The cleaned copy's alignment and noise reduction.
- Audio files accepted by the engine, and the no-sound message.

**Measurement accuracy:**

| Signal | Editor (16 kHz mono mix) | ffmpeg `ebur128` (48 kHz stereo) |
|---|---|---|
| Voice-like, same on both channels | -17.43 | -17.5 |
| Voice-like file in the editor (headless check) | -33.6 | -33.7 |
| Music-like, different left/right, highs to 7 kHz | -14.52 | -13.8 |
| Pink noise (energy above 8 kHz) | -30.00 | -28.6 |

Voice is within 0.1 LU. Broadband or wide stereo content reads up to about 1.5 LU low here, so its gain comes out slightly high. The limiter still holds the peaks. Wide, uncorrelated stereo can read up to 3 dB low.

## Manual tests still required

1. **Disk sources in the desktop app (WebView2 and WKWebView):** engage the mixer by opening Audio, and check that a recording still plays with sound. Routed elements switch to CORS. The asset protocol sends `Access-Control-Allow-Origin` (checked in Tauri 2.12's source), but this wasn't run in the app.
2. **Noise reduction on a real noisy microphone recording:**
   - each strength, Compare while playing, export, then listen;
   - check lip sync after cuts.
3. **Loudness on a real narrated recording with music:** measure, export, and check the result with a loudness meter.
4. **Webcam layouts:** each shape and corner, side by side, then switch between 16:9, 9:16 and 1:1 and export each one.
5. **CPU use of the preview mixer** during long playback on a low-end laptop.

## Deployment note

The website's export goes to the cloud backend:

- It needs this backend version for `masterGain` and for clip volumes above 200 % (video sound above 100 %).
- An older backend ignores `masterGain` and rejects those volumes.

The desktop app bundles its engine, so it's consistent.

## Limitations

- Noise reduction handles steady noise only. It doesn't separate voices, music or one-off sounds.
- Noise reduction can't be cancelled once started.
- Noise reduction needs the desktop app.
- The loudness measurement leaves voice effects out.
- 5.1 sources are downmixed by different rules in the preview and the export.
- Solo applies to audio tracks and the video sound; video layers fall silent while anything is soloed.
- Webcam layouts clear the layer's own keyframes. Side by side resets the clips' position and scale when it's turned off.
