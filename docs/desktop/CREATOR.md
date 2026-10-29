# Creator tools (Phase 6)

Highlight suggestions, creator canvas presets, and the state of speech and captions. Everything runs on the device. Nothing here needs a new model, a cloud service or a new dependency.

## What was researched and decided

| Need | Options considered | Decision |
|---|---|---|
| Highlight signals | Learned audio-event classifiers (YAMNet: Apache-2.0, ~3.7 M parameters, 521 AudioSet classes; AudioSet labels are CC BY 4.0), learned video highlight models, plain signal measures | **Signal measures only for v1.** A classifier can say "laughter" or "explosion", but not whether a moment is good, and it would add a model download, an inference runtime and licence notices. The signals below are cheap, explainable and already half-measured by the editor. A classifier is worth a look once real users' accept/reject counts exist to evaluate it against (see Measuring) |
| Scene changes and on-screen activity | OpenCV, PySceneDetect, ffmpeg filters | **ffmpeg `scdet`**, already in the bundled build: one pass gives per-frame picture change and scene-change scores |
| Speech recognition | whisper.cpp (MIT), faster-whisper (MIT, CTranslate2), transformers.js Whisper (Apache-2.0 library; Whisper weights MIT) | **Keep what exists**: transformers.js with `onnx-community/whisper-large-v3-turbo_timestamped` (WebGPU, ~700 MB, 4-bit) or `whisper-small_timestamped` (CPU, ~250 MB, 8-bit). Same checkpoints as whisper.cpp, so accuracy would be the same; switching would only move work into the engine and double the bundled code paths |
| Voice activity | Silero VAD (~2 MB; check its LICENSE file: copies of its README disagree between MIT and CC BY-NC), level-based detection | **Keep the level-based detection** (audioAnalysis.ts, tested on noise, music and quiet speech); no licence question to settle |

Sources checked: whisper.cpp and Whisper model cards and comparisons, YAMNet model pages (Google, Qualcomm AI Hub, community ONNX), Silero VAD repository and PyPI pages. Licences need re-checking on the exact repository before anything is bundled.

## Highlights

Toolbar **Highlights**. Settings: time before and after the moment (pre-roll 5 s, post-roll 3 s by default), the most suggestions to make (8), sensitivity. **Find highlights** measures, then lists suggestions; nothing on the timeline changes.

### Signals (`src/lib/editor/highlights.ts`)

Each signal is judged against the timeline's own typical level, so a loud game or a busy screen doesn't count as exciting all the way through.

| Signal | Measured from | Counts when |
|---|---|---|
| Sound | 20 ms levels of the timeline's sound (the speech mix: clip sound, recorded microphone and system audio; uploaded music is left out) | The level jumps at least 6 dB above **both** the median of the 4 s before and the timeline's median, and reaches its loud moments (90th percentile − 3 dB). Speech starting after a pause doesn't count: it only reaches the usual level |
| Picture | `scdet` mean frame difference, 4 frames/s at 160 px (`activity.motion_profile`, `/api/video/motion`, desktop engine only) | Movement 1.5×+ the usual amount (the larger of 2× the median and the 90th percentile); a scene cut's own frame isn't movement |
| Scene | `scdet` scene score ≥ 8 (hard cuts score ~18) | Weak signal (in screen recordings it's usually a window switch); also used to start a clip on the cut |
| Input | Recorded clicks, keys, scrolls | 4+ in 3 s and 2×+ the recording's usual rate |
| Marker | Markers placed while recording, or **Mark at playhead** | Always suggested, high confidence |

**Loud or busy isn't treated as good.** Signals within 2 s of each other count as agreeing. Two or more agreeing signals score 1.6× their weighted sum (sound 0.4, picture 0.3, input 0.2, scene 0.1). One signal alone scores 0.4×, so it only appears at high sensitivity and at low confidence. Confidence: high for markers or 3 signals, medium for 2, low for 1. Each suggestion lists what it's based on ("Sound jumps 14 dB above the moments before", "The picture moves 5× more than usual", "A burst of input: 9 clicks, keys or scrolls in 3 s").

**Ranges**: peak − pre-roll to peak + post-roll, clamped to the timeline. The start moves to a scene cut when one is in the first half of the pre-roll. Otherwise each end moves up to 1 s to a quieter frame, so a clip doesn't start or end mid-shout or mid-word. Suggestions are spaced at least 0.8 × (pre + post) apart.

### Review, edit, save

- **Preview** plays only the highlight and stops at its end.
- **Start / End** fields and **Start/End at playhead** edit the range (at least 0.5 s); the item shows "Range edited by you".
- **Keep**, **Reject** (rejected ones are hidden; undo brings one back), **Mark at playhead** (a kept highlight around the playhead).
- **Export clip…** opens the normal export dialog ("Export highlight", file `…-highlight-N.mp4`) on a **copy** of the project cut to the range with the same ripple cut accepted cuts use (`highlightProject`): video, microphone, system audio, webcam, captions, text, masks and zooms all stay in sync. The project itself never changes. Ranges touching a transition are refused, with the reason (as for cuts).
- Saved with the project (`Project.highlights`, versioned; invalid or newer sets are dropped on load). Finding again keeps kept and edited highlights and replaces the pending and rejected ones. If the clips changed since, a notice says the times may point elsewhere.

### Cancelling and caching

Cancel stops between steps: mixing, each 60 s picture chunk, analysis. The sound levels are reused while the timeline's sound is the same (same key as the Review analysis). Picture profiles are cached per file and 60 s source chunk, aligned to a grid, so trimming or re-finding with other settings doesn't decode again. Finding again with nothing changed says it's up to date.

### Measured (this machine, Windows 11, 12 threads)

- Analysis of a synthetic hour (sound levels + picture samples + 2,000 inputs): **~250 ms** (`tests/desktop/highlights.test.ts`).
- Picture profile: 12 s of 720p in 0.32 s; **120 s of a real 1080p30 desktop recording in 11.9 s** (~10× real time, measured while an export benchmark was also running).
- How useful the suggestions are on real recordings has **not** been measured: there are no users yet. See Measuring.

### Limitations

- Nothing understands content: no game-specific indicators (kill feeds, score changes) and no speech meaning. Game indicators were not added: none can be read reliably across games without per-game work.
- Without the local engine (website), or for videos not on disk (dropped into the window), only sound, inputs and markers are used; the panel says so.
- A loud room, constant commentary or music in the clip's own sound flattens the sound signal (jumps are measured against the timeline's own levels, so a constantly loud track produces few).
- Rejecting has no "why" field, so the counts can't yet tell bad suggestions from unwanted ones.

## Creator presets

**Canvas > Made for** applies one of these as one undo step. It only sets ordinary project settings, so every one of them stays adjustable in Canvas, Focus and Tutorial, and the export renders them as usual (`src/lib/editor/creatorPresets.ts`).

| Preset | Sets |
|---|---|
| Landscape | 16:9, Fit (whole picture). Blurred background when a clip isn't 16:9 and the background was a plain color |
| Vertical | 9:16, Fill, reframed (below) |
| Square | 1:1, Fill, reframed |
| Software tutorial | 16:9, Fit, canvas frame (4% padding, rounded corners, shadow) on a gradient. Recordings: click highlights on, the drawn cursor only when the recording has no cursor of its own, shortcut indicators from the recorded shortcuts (replacing earlier ones). Other videos get only the layout, and the note says why |

**Reframing** a landscape video for 9:16 or 1:1 cuts its sides, and the preset keeps what matters in view:

- **Recordings**: each clip is centered on the middle 80% (10th–90th percentile) of the clicks, typing and pointer positions during that clip, kept so the video still covers the canvas.
- If that activity is wider than about 90% of the visible width, a crop would hide some of it, so the preset switches to **Fit** with a blurred background and says so.
- **Other videos** are centered, and the note asks you to check the sides. Nothing tells the preset where the subject is.
- Drag the video in the preview to move it. Focus zooms already respect the visible part in Fill mode (camera.ts `visibleView`).

Export resolution and quality stay in the export dialog (plan rules unchanged).

## Speech and captions (status)

Part B of this phase was already implemented in Phase 3 and is unchanged. It is optional: nothing downloads until the user asks, and editing doesn't need it.

- Local Whisper (above); the model is downloaded once from Hugging Face after the user confirms its size. Audio never leaves the device.
- 24 selectable languages plus auto-detect: English, Sinhala, Tamil, Hindi, Spanish, French, German, Italian, Portuguese, Dutch, Russian, Ukrainian, Polish, Turkish, Arabic, Bengali, Urdu, Indonesian, Malay, Thai, Vietnamese, Chinese, Japanese, Korean. Accuracy varies a lot by language: the large-v3-turbo decoder is pruned, and Whisper small (the CPU fallback) is clearly weaker on low-resource languages such as Sinhala. Users must review the captions.
- Timestamped captions become caption text layers: text and timing are editable, styles and positions apply to all, there are show/hide-all and size/alignment controls, and an export as SRT, WebVTT or plain transcript. Visible captions are burned into the export.
- Source audio is preserved (captions only read a 16 kHz mix).
- Silence and pause suggestions come from level-based speech detection (Review tab), and edit-by-text deletes words.
- Correction frequency is not measured (no telemetry). See Measuring.

## Measuring

The app sends no usage telemetry. In the desktop app, `@vercel/analytics` has no endpoint to reach: the CSP allows only the site APIs, the engine, Supabase and Hugging Face. The following are therefore **local counts only** or **not measured yet**:

| Metric | Status |
|---|---|
| Highlights suggested / kept / edited / rejected / exported | Counted per project (`Project.highlights.stats`), shown in the panel, never sent. A beta survey can ask testers to report them |
| Caption correction frequency | Not measured. Would need a count of edited caption layers since generation; add it with the beta survey |
| Time saved vs manual editing | Not measured. Needs a timed study (same recording, edited by hand vs with draft + highlights) |
| Crash rate, export reliability | Not measured in the field. Exports now verify every output file (streams, size, length, decodable end) and log one line per export with encoder and timings to the app log; a crash reporter is a post-beta item |
| Recording performance | Measured on this machine (see RECORDER.md and BETA-READINESS.md) |
| User-reported defects | None: no beta testers yet |

## Tests

| | |
|---|---|
| `tests/desktop/highlights.test.ts` (11) | Speech after pauses isn't a highlight; a shout alone is low confidence and only at high sensitivity; agreeing signals rank first; a constantly loud, busy game only where it's busier still; markers always, with label, pre-roll clamped; scene-cut start, end not mid-sound; max count, spacing, notes; an hour in ~250 ms; kept and edited survive finding again, counts; saved/reloaded, invalid sets dropped; picture samples through trims and speed; export copy holds only the range, microphone in sync, project unchanged |
| `tests/desktop/creatorPresets.test.ts` (6) | centerOn clamping; per-clip activity centering keeps the activity visible; wide activity falls back to Fit + blur; plain videos centered with a note, portrait sources untouched; landscape blur for other shapes; tutorial frame, rings, cursor only without a captured one, shortcut indicators replace old ones; non-recordings get the layout only |
| `backend/tests/test_activity.py` (+2) | Real ffmpeg: motion profile still / moving / caret-only, both hard cuts found and nothing else, ranges in source seconds; endpoint validation and local-only |

Not yet done: a run of the Highlights panel and presets inside the desktop app or headless Chrome (only type checks, lint and the pure-logic tests above cover the UI wiring).
