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
