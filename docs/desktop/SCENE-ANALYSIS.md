# Scene analysis

Reads what a screen recording shows, on the user's computer, and turns it
into scenes and suggestions the user reviews in the Draft:
- chapters titled from what was on screen;
- cuts for waiting;
- annotations naming clicked buttons and commands;
- privacy masks for possible sensitive text.

Nothing is uploaded, and screen text is never logged.

## Pipeline

```
screen video ──scan (1–4 fps, 160 px gray)──▶ still / active / scroll / layout jumps
             ──pick frames where the screen settles (budget per minute)
             ──OCR (changed area in Quick, whole frame in Thorough) + small crops at clicks
             ──describe: headings, dialog, terminal prompt, code, settings/form words, error/success, address host
             ──privacy checks on every line read ──▶ masks for as long as that patch stays unchanged
   (engine: backend/app/pipeline/scenes.py, ocr.py, sensitive.py; POST /api/scene/analyze; cached per file, level and clicks)

+ recorder events (clicks, typing, windows, markers) + captions
   ──▶ events → scenes → chapters, cuts, annotations, masks   (editor: src/lib/editor/sceneAnalysis.ts)
   ──▶ Draft items (draft.ts): privacy and annotation kinds; privacy is never part of "Accept all"
```

**Evidence only:**
- Every event and scene says what it's based on, with a confidence.
- Text is only quoted when it was read on screen or said.
- With too little evidence, an event is "The screen changed" and a scene is "Unclear".
- No vision-language model: the ones small enough to run here would describe the screen fluently but unreliably.

## Models

**PaddleOCR PP-OCRv3 English** detector and recognizer (Apache-2.0):
- the ONNX exports published by RapidOCR, pinned to a revision and checked with SHA-256;
- run by the engine's existing onnxruntime on the CPU, about 11 MB;
- bundled with the engine (`python -m app.pipeline.ocr`, `desktop.spec`);
- reads English and other Latin-script text only.

**Measured and dropped:**
- **Int8 quantization of the recognizer:** slower here (2.7 s against 2.3 s for 16 lines × 640 px).
- **GPU:** for the same reason as background removal, the copies cost more than they save for models this small.

## Low-end machines

- **Scan:**
  - decoded by ffmpeg straight to small gray frames, on half the cores;
  - per sample it keeps an 80×45 copy (about 9 MB for 10 minutes).
- **OCR budget:**
  - at most 4 frames a minute (Quick) or 10 (Thorough);
  - per frame, at most 4,000 (Quick) or 12,000 (Thorough) pixel columns of text, at a cost of about 0.23 ms each;
  - tall lines (headings) and short ones (labels) are read first;
  - click crops read the line under the pointer first.
- **Engine:** one analysis at a time, cancellable, with progress.
- **Cache:** results are cached, so analyzing the same file again is instant.

## Measured (i7-9750H, CPU, two real 1080p recordings)

| Recording | Quick | Thorough | Peak Python memory |
|---|---|---|---|
| 57 s, 14 clicks | 12.7 s (scan 3.9 s) | 32.2 s | 70 MB / 152 MB |
| 65 s, 3 clicks | 9.1 s (scan 1.8 s) | 21.2 s | 58 MB / 71 MB |

Quick is about 0.15–0.2× real time on this machine. Not measured: a real low-end machine, or recordings over a few minutes. Expect the read step to be 2–3× slower on a 4-core laptop.

## Privacy checks (sensitive.py)

**Looked for**, each with a check to cut false alarms:
- emails;
- phone numbers: they need a "+", brackets or a nearby word such as "phone", since screens are full of digit groups;
- payment card numbers (Luhn check);
- bank account numbers (IBAN mod-97 check);
- known key and token formats;
- private key blocks;
- connection strings with a password;
- bearer tokens;
- secret-named assignments with a random-looking value;
- password fields, found by their label.

**Rules:**
- A finding keeps only its category, position, time span and reason, never the value.
- Lines it flags are never kept as text, not even as headings or labels.
- Masks are pending Draft items that need one accept each; export warns when any are left unreviewed.

**It misses:** text the OCR can't read (tiny, blurred, non-Latin, inside images), formats it doesn't know, and content that moves. A mask covers a spot only while that patch of screen stays unchanged, so scrolling ends it.

## Tests

- `backend/tests/test_scenes.py`:
  - checks for each kind of sensitive text, with made-up values;
  - false alarms;
  - values never kept;
  - classifying cursor, scroll, cut and dialog changes;
  - frame features;
  - an end-to-end run on a generated settings / dialog / terminal video: headings, the dialog title, the clicked "Delete" button, an email masked for exactly its time on screen and never kept as text;
  - caching, cancelling, the API.
- `tests/desktop/scenes.test.ts`:
  - grounded event descriptions;
  - scene boundaries and titles, "Unclear" without evidence;
  - chapters;
  - waiting cuts, none when something is said;
  - annotations;
  - masks in video space;
  - trimmed footage;
  - placing annotations on the canvas;
  - the whole draft round trip, including reopening.
