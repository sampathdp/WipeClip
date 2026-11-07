# Webcam background removal

Removes, blurs or replaces a webcam's background without a green screen.
It runs on the user's computer, in the desktop app; no frame is uploaded.

## How it works

```
webcam.webm ──engine (matte.py)──▶ matted .mp4 (picture on top, mask below) ──┬─▶ preview (matte.ts drawMatteFrame)
                                                                              └─▶ export  (editor.py _matte_head)
```

1. **Mask pass, once per video** (`backend/app/pipeline/matte.py`, `POST /api/matte/render`).
   ffmpeg decodes the webcam at up to 1280 px wide and a constant frame rate. For each frame:
   - the model runs on 3 threads at once;
   - its 256×144 mask is smoothed over time (motion-aware, so no trails);
   - the outline is fitted to the frame's own edges with a fast guided filter (He & Sun), only along the outline. Inside the body and in the far background, the model's mask stays as it is, so dark clothes can't turn see-through. **Fine hair** (default) uses a color guide, which separates hair from a wall of the same brightness; **Faster** uses a gray guide. Each detail level has its own cached file. This step also runs on 3 threads.

   The video is a file on disk (`path`), or one the editor holds in memory (a layer added from a file). That one is handed to the engine once, on this machine, under a key from its name, size and date (`matte.ts memoryKey`), and kept in the cache's `sources` folder. The editor asks by key first and sends the file only on 409 `need_file`.

   ffmpeg then writes the picture and the mask into one H.264 file, picture on top and mask below, both sizes multiples of 16. The file is cached in `WIPECLIP_MATTE_DIR` (the app's local data folder, `matte-cache`), named by the video's path, size and modification time plus `PIPELINE_VERSION`. The cache holds at most 8 GB; the oldest files are removed first.
2. **Preview and export read that one file.** Picture and mask come from the same decoded frame, so they can't drift apart.
   - **Preview:** `OverlayLayer` plays it hidden and draws each frame onto a canvas (`drawMatteFrame`).
   - **Export:** the file replaces the layer's video input, and `_matte_head` builds the person over the chosen background.
   - **Shared adjustments:** the edge curve, softness and background blur use the same formulas on both sides. Sizes are relative to the height, so they match at any size (`matte.ts` and `editor.py` `matte_curve` / `matte_soft_sigma` / `matte_blur_sigma` / `matte_bg_rect`, checked by both test suites). The blurs pad the frame's edges, as ffmpeg's `gblur` does, so edges don't fade.
3. **The project** stores only the settings: `Overlay.matte` on video layers (`WebcamMatte`), with undo, autosave and project files as for any layer field. The matted file is derived and is made again when missing.
   - An image or video background is a project source (`bgSourceId`), included in `.wipeclip` files and remapped like the others.
   - Projects without the field are unchanged.

## Model

**Google MediaPipe selfie segmenter, Apache-2.0**, pinned to `float16/1` with SHA-256 checksums:
- landscape model (256×144) for wide frames;
- general model (256×256) for the rest.

Each is about 250 KB. They run through OpenCV's DNN module, which the engine already ships, so there is no new runtime. They are bundled with the engine: `python -m app.pipeline.matte` (CI and `release-local.mjs`) fetches them, `desktop.spec` packs them, and they are listed in the third-party notices. If they're missing, the engine downloads them once from Google's model storage and checks them.

**Rejected:**
- **Robust Video Matting:** GPL-3.0.
- **MODNet:** its weights are CC BY-NC-SA, non-commercial.
- **BiRefNet and rembg:** about 0.3–1 s per frame on a CPU.
- **MediaPipe multiclass (hair class):** OpenCV can't load it (`TRANSPOSE_CONV`).

## Measured (i7-9750H, 6 cores, CPU only)

| Step | Time |
|---|---|
| Model load | 13 ms (landscape, cached per thread) |
| Inference, landscape 256×144 | 12.5 ms/frame; 15.7 ms with resizing |
| Whole pass, 1280×720 at 30 fps, 24 s clip, **Fine hair** | 20.9 fps (about 0.7× real time) |
| Whole pass, same clip, **Faster** | 28.1 fps (about 0.9× real time) |
| First version (one thread, guided filter at 640 px, side-by-side layout) | 13.6 fps |
| GPU (OpenCL on the GTX 1650), model only | 12.9 ms/frame, **slower** than the CPU (10.9 ms): the model is too small for the copies to pay off |
| Live recorder preview, one 256×144 frame | about 11 ms in the engine plus a local request |

A 10-minute 720p webcam takes about 14 minutes (Fine hair) or 11 minutes (Faster), in the background; the editor keeps working and shows progress. An earlier note here said 38 fps; that came from 6-second runs and didn't hold on a longer clip.

The GPU isn't used, on purpose: measured above, it's slower for this model. OpenCV's OpenCL target would need no new dependency if a bigger model ever makes it worth it.

Not measured: CPU and memory use during the pass, other machines, and 1080p webcams. Webcams wider than 1280 px are scaled down to 1280.

## Modes and controls

In the recorder, the camera preview offers **Background: Original / Remove / Blur**. It shows the effect live: small frames go to the engine on this machine (`POST /api/matte/frame`), and the mask is smoothed and scaled up in the page. The recording stays the original camera; the choice is saved on the webcam track (`RecordingTrack.background`), and the recording opens in the editor with that background on. Full quality is made there.

- **Original:** no matte.
- **Remove:** clear background; the canvas shows through.
- **Blur:** the webcam's own picture, blurred, behind the person.
- **Image:** a PNG, JPG or WebP image behind the person.
- **Video:** a video behind the person, picked on disk. It starts with the layer, then loops or holds its last frame.

For Image and Video: Fill or Fit, zoom from 1× to 4×, and position. With Fit, the area outside the image stays clear.

**Edge detail:** Fine hair or Faster (above).

Under the **Edge** section:
- **Outline** (tighter or looser): moves the threshold over the softened mask;
- **Softness**;
- **Reset adjustments**.

Each control changes the rendered result.

## Tests

- `backend/tests/test_matte.py`:
  - real ffmpeg renders of every mode, fit, loop and hold, and the outline moving;
  - the plan's JSON round trip;
  - the shared math;
  - an engine pass with the real model (frame count and size, caching, a cancel leaving no file, an empty frame);
  - fine and fast cached apart;
  - the API: an in-memory video handed over once, then found by key; bad keys and non-videos refused; the stored copy can't pass as a matted file;
  - a live frame.
- `tests/desktop/matte.test.ts`:
  - the math against the export's formulas;
  - placement and background video time;
  - one job per video and detail, retried after a failure;
  - in-memory keys;
  - the recorder's background opening with the recording (`recorder.test.ts`);
  - the background source in project files and migration.
- `src-tauri/src/media.rs` `matte_files_only_from_the_cache`: the app plays only `.mp4` files directly in the matte cache.

## Limits and what's left

- **Desktop app only.** The website has no engine, and webcam frames are never sent to a server for this; the website says it's a desktop feature.
- **Hair:** Fine hair recovers strands a gray guide misses, but it's still a segmentation model, not a dedicated hair-matting one. No permissively licensed matting model runs fast enough on a CPU here (see Rejected).
- **The live recorder preview is coarser** than the editor's result: it uses the model's 256-pixel mask without edge fitting, to stay real-time.
- **Preview blur is CSS `blur()`, export blur is `gblur`.** Same sigma, so they are very close but not identical to the pixel. Making them identical would mean baking the blur in the engine, so the Blur slider would no longer be instant.
- **Green screen on disk videos** (fixed alongside): layer videos now load with CORS, so a keyed recorded webcam can be read by the canvas.
- **Manual tests still required:**
  - a real webcam recording in the app: the live recorder preview, then the editor's preview, seeking, each mode, project reopen, export;
  - a video layer added from a file (the hand-over);
  - green screen on a recorded webcam (the CORS fix);
  - a WebM without a duration header (the progress bar then uses the editor's duration);
  - a low-end machine.
