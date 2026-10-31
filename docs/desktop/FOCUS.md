# Focus zooms, click highlights and cursor (Phase 2)

Screen recordings made with the desktop recorder ([RECORDER.md](RECORDER.md)) carry their mouse and keyboard events. The editor uses them to suggest focus zooms, highlight clicks and, where the recording leaves the system cursor out, draw a smooth resizable cursor. Everything is non-destructive: the recording file and its events are never changed; zooms and pointer settings are part of the project (undoable, autosaved, restored on reopen).

Workflow: **open a recording → Focus panel opens → Analyze and suggest zooms (or skip) → preview → adjust zooms on the Zoom track / in the zoom inspector → Export.**

## Where things live

| | |
|---|---|
| `src/lib/editor/types.ts` | `CameraZoom` (source-timed zoom), `PointerStyle`, `Project.zooms`, `Project.pointer`, `{ kind: "zoom" }` selection; `migrateProject` fills defaults |
| `src/lib/editor/camera.ts` | Camera window model, keyframes, easing, chaining, source ↔ timeline mapping, export samples, `windowPixels` |
| `src/lib/editor/pointer.ts` | Pointer reconstruction (grid resampling, hold vs interpolate, pause cuts, smoothing pinned at clicks), click rings, source → canvas mapping, `pointerScene` |
| `src/lib/editor/focus.ts` | Deterministic zoom suggestions, presets, cancellable `analyzeFocus` |
| `src/lib/editor/zoomEdits.ts` | Pure zoom edits used by the editor commands: patch, remove, split, timeline drag, merging new suggestions |
| `src/lib/editor/focusExport.ts` | Camera rows per clip and pointer rows for the export payload |
| `src/lib/editor/pointerDraw.ts` | Cursor and ring drawing (preview canvas and export sprites) |
| `src/components/editor/FocusPanel.tsx` | Focus panel (presets, settings, analyze/cancel, pointer style, zoom list) and zoom inspector |
| `PreviewPlayer.tsx`, `Timeline.tsx`, `VideoEditor.tsx` | Preview integration, Zoom track with click ticks, editing commands |
| `backend/app/pipeline/editor.py` | `PlanClip.camera`, `PlanPointer`, `step_expr`, `_camera_chain`, `_pointer_filters` |
| `backend/app/main.py` | Payload validation (`_camera_rows`, `_pointer_plan`), limits in `config.py` |

## How it works

**Zooms are stored in source time** (seconds of the recording, like a clip's start/end), so trimming, splitting, reordering or changing speed never moves a zoom off its moment. The timeline shows each zoom once per clip that contains part of it.

**Camera.** A zoom is a camera window: the visible part of the clip's (cropped) frame, same aspect ratio, always inside the frame, so recording bounds and aspect are respected and edges never show black. When the canvas cuts the frame (canvas fill, e.g. a landscape recording in a 9:16 or 1:1 project, or a clip moved partly off-canvas), the camera knows which part of the window actually reaches the canvas (`clipView`/`visibleView` in camera.ts) and centers the focus point there; if a point near a frame edge would still land off-canvas, the window zooms in further, at most 1.75× beyond the zoom's own strength (never past 4×). Preview, masks, pointer and export all use the same view, so they still match. Each zoom becomes keyframes (rest → target over `easeIn`, hold, back over `easeOut`); between keyframes the window rectangle is interpolated with the chosen ease (smooth = smoothstep, gentle = smootherstep, linear). Interpolating the rectangle makes the camera close in along a straight line toward the focus point. Zooms less than 0.8 s apart chain into a direct pan instead of zooming out and back in. Near an edge the window slides inside the frame; the focus point stays visible but off-center.

**Pointer.** The recorder stores pointer samples only when the pointer moves, so long gaps are holds, not slow glides; only samples less than 100 ms apart are interpolated, and never across a pause cut. The path is resampled to a 60 Hz grid once (O(1) lookups). Smoothing is a Gaussian (up to 120 ms), faded back to the raw path within 150 ms of every click, so a click is always exactly where it happened. Rings grow (ease-out) and fade over their duration; left and right clicks use separate colors.

**Duplicate cursors.** The drawn cursor is offered only when the recording's manifest says `capture.cursorCaptured: false`, which the recorder sets only if the web engine confirmed it left the cursor out ("Leave the mouse pointer out of the video"). Otherwise the video already shows the system cursor and only click highlights are available. Older recordings (field missing) count as captured.

## Suggestion engine (`focus.ts`)

Deterministic and based only on recorded data: click positions/times, whether the pointer had settled before a click (speed over the previous 0.4 s), double-clicks, drags, scroll bursts, shortcuts, typing activity (when, and where the text cursor was - never which keys), markers, pause cuts and the frame bounds. **It does not analyze pixels and doesn't detect buttons, text or applications.** The project has no local computer-vision model suited to UI target detection (its OpenCV/rembg code is server-side and built for inpainting/background removal), so none was added; focus regions are padded boxes around the interaction points instead (7% of the frame width on each side, same in pixels vertically).

1. Interactions with a significance score: left click 1.0, right click 0.8, +0.6 if the pointer had settled, +0.3 for a double-click (counted once), +0.2 for a drag (the press is followed to its release), scroll burst 0.4, shortcut 0.3. Typing: events at most 1.5 s apart form a burst (4+ events, about half a second of typing); it is placed at the text cursor (1.4), else at the click that focused the field within 30 s (1.1), else at the pointer (0.7), plus 0.35 per second of typing (up to 1). A typing zoom may last up to 45 s. Clicks outside the captured display are ignored.
2. Clusters: consecutive interactions within the preset's time gap and radius; broken at pauses and when too long for one zoom.
3. Candidates: clusters above the preset's threshold (markers always qualify; a marker with no nearby click focuses where the pointer was). Zoom = the preset's zoom, lowered so all the cluster's points plus padding fit, skipped below 1.15× (activity spread over the screen). **Follow** (on by default): when the points don't fit at the preset's zoom - a drag, the text cursor moving along a line, clicks across a form - the zoom keeps the preset's zoom (lowered only so points less than 0.6 s apart are in view together) and gets a `path`: the camera starts on the first point and pans (0.5 s, arriving on time) whenever a later point leaves the middle 64% of the view; pans less than 0.5 s apart collapse into one. Small moves never move the camera.
4. Pacing: neighbours closer than the preset's minimum gap merge (same area) or chain (different area); then the busiest minutes are thinned to the preset's zooms-per-minute, keeping the most significant.
   - **Back and forth** (Phase 3): when a zoom chains to another area and the next one returns near the first soon after, the three become one still zoom wide enough for both areas (no follow path inside it; reason "…, back and forth"). If no useful zoom (1.15× or more) fits both, the return trip gets no zoom of its own. When such a zoom reaches its maximum length, the next one keeps its framing if the action still fits, so the camera doesn't start panning at the seam.
   - **Chaining never starts a zoom late**: when two zooms overlap, the earlier one ends once its own last action is done (plus its zoom-out time, which is when a chained pan leaves), instead of the later one starting after its own click. Before, the camera could still be on the previous spot when the click happened.
   - Events outside the recording or with non-numeric positions are dropped before analysis (they used to produce a zoom with no end).

| Preset | Zoom (max) | Duration | Transition | Threshold | Zooms/min |
|---|---|---|---|---|---|
| Subtle | 1.4× (1.8×) | 2.2–7 s | 0.9 s, gentle | 2.4 (two deliberate clicks) | 4 |
| Balanced | 1.8× (2.3×) | 1.8–8 s | 0.65 s, smooth | 1.5 (one deliberate click) | 8 |
| Dynamic | 2.3× (2.8×) | 1.4–10 s | 0.45 s, smooth | 1.0 (any click) | 14 |

All values can be customized in the panel. Suggestions are ordinary zooms marked `auto`; editing one clears the mark, and re-analyzing replaces only unedited suggestions. A new suggestion that would overlap a manual or edited zoom is dropped: the user's zoom wins (`mergeSuggestions` in `zoomEdits.ts`). Analysis runs in chunks off the main path with progress and Cancel (100k events take tens of milliseconds).

## Editing

- **Zoom track** (shown for recordings or when zooms exist): drag to move (the length is kept and the zoom stays inside the recording), drag edges to change start/end (0.6 s minimum), click to select. Recorded clicks appear as ticks (cyan left, amber right).
- **Zoom inspector**: enable/disable, strength, duration, zoom-in and zoom-out time, easing, focus position (setting it by hand ends following; moving or resizing the zoom keeps its path in step, a split divides it), "Focus on pointer" (pointer position at the playhead), Split at playhead, Delete (also the Delete key).
- **Focus panel**: presets and settings, Analyze/Cancel, Remove suggestions, Add zoom at playhead (at the pointer if known), zoom list, pointer style (click highlights on/off, colors, ring size, duration, intensity; drawn cursor size, color, smoothing).
- **View** (Focus panel, once there are zooms): **Compare with original** (Phase 3) shows the preview without zooms while it's pressed in. It's preview only: not saved, not an undo step, and the export is unchanged (`previewWithoutZooms` in focusPrefs.ts). **Original view** shows and exports the recording without any zoom, keeping every zoom for later; **Zoom intensity** (25–150%) scales the strength of all zooms at once (`1 + (zoom − 1) × intensity`, capped at 4×) without changing them.
- **Leave out**: **No zooms for 10 s from playhead** and the zoom inspector's **No zooms here** (deletes that zoom) add a source-time range where analysis suggests nothing, and remove the unedited suggestions it overlaps; **Ignore click at playhead** (nearest click within 0.5 s) removes that click's ring from preview and export and leaves it out of the next analysis. Its tick on the Zoom track turns grey. Both are listed with **Allow**/**Restore**. The user's own zooms are never removed by either.
- These live in `Project.focus` (`src/lib/editor/focusPrefs.ts`), optional, defaults when absent, so older projects open unchanged. They apply where zooms and rings are evaluated: `appliedZooms(project)` feeds the camera tracks of the preview, masks, pointer and export rows, and `pointerScene` skips ignored clicks for both preview and export. The backend receives ordinary camera and ring rows.
- All edits are one undo step each (sliders as one step per drag); everything is saved with the project.
- Preview plays everything live; no render needed.

## Preview and export use the same values

The preview applies the camera window as an extra crop of the video slot and draws the pointer on a canvas above the video and below text/stickers. The export reuses the existing server pipeline: the browser evaluates the camera window per clip and the cursor/ring state per output frame **with the same functions the preview uses** and sends only the rows where a value changes. The backend turns rows into per-frame step expressions of each frame's own timestamp (a balanced `if(lt(t,…))` tree, log₂ n comparisons per frame) driving a per-clip zoom (`split → scale → overlay` inside the fitted box) and a cursor sprite plus four click-ring layers: each ring sprite keeps one size and grows inside it through `geq` (which also applies the opacity), and the opacity pass and overlay only run while a ring is visible (timeline `enable`). Resizing the sprite per frame made ffmpeg reconfigure the overlay on every change and was ~6x slower. Each layer starts hidden, so no ring shows before its click. The output frame rate for recordings is the capture rate sent by the editor, not the probed average of the variable-frame-rate file. The whole export plan, masks and pointer included, crosses the API→worker boundary through `plan_to_json`/`plan_from_json`. It never recomputes easing or smoothing.

`sendcmd` was tried first and rejected: it changes another filter when a frame passes, and with ffmpeg 7's threaded inputs that landed a few frames early or late, which showed up as missing rings in repeated test runs.

Stacking order is the same in both: video and timed effects, then the pointer layers, then text, stickers and images. Projects without zooms or pointer effects produce byte-identical export graphs to before (checked against the committed `editor.py`).

**Deployment:** zooms and pointer effects only render with the updated backend. An older backend ignores the new fields and exports without them. Deploy the backend before shipping the desktop build. The Focus tool is shown only in the desktop app (or when a project already has zooms), so website users don't hit this.

Limits (`backend/app/config.py`): 100,000 camera rows per clip, 200,000 pointer rows per export (the client refuses before that with a clear message).

## Tests

| Command | Covers |
|---|---|
| `npm run desktop:test:js` (`tests/desktop/focus.test.ts`) | Camera easing, hold, return, edges, crop/region, chaining, overlap normalization, source↔timeline through split/speed/reverse, export samples equal preview values; pointer hold/interpolate/pause cuts, smoothing pinned at clicks, ring growth/fade per button, canvas mapping incl. portrait and rotation; landscape/portrait/square output with fit and fill (edge clicks stay on the canvas, export rows equal preview in portrait fill, every click of a 60-click session is visible inside its zoom in all six shape/fit combinations); zoom edits (split, drag clamping, suggestions vs user zooms) and undo/redo through the real history reducer; suggestions (deliberate vs hurried clicks, preset thresholds, double-clicks, fast successive clicks, chaining, pauses, recording end, markers, other displays, pacing, 15-min/16k-event recording speed, cancel); save/reopen migration; payload fixture and pixel-geometry vectors |
| `cd backend && python -m unittest tests.test_focus_export` | Real ffmpeg renders: zoom in and back, zoom at an edge of a cropped clip, cursor and ring timing/position, the browser-built payload fixture rendered with the zoom and ring where the preview puts them, invalid rows rejected, 20 s stress (zoom every second, ring every 0.3 s) under 60 s, step-expression semantics, shared geometry vectors |
| `npm run desktop:test:js` (`tests/desktop/focusPrefs.test.ts`) | Intensity scaling and limits; export camera rows at 50% identical to a 1.5× zoom and equal to the preview's window; original view (no rows, rings at the unzoomed place, restored exactly); ignored click absent from preview and export, restored exactly; excluded ranges and ignored clicks keep suggestions away while pause cuts stay; exclusion never removes manual zooms; undo/redo, save and reopen, older projects |
| `node tests/desktop/manual/preview-focus.mjs <editor url> <out> [default\|half\|original\|ignored]` | Real editor in headless Chrome: saved project with a recording, zoom and click is resumed; checks framing before/during/after the zoom, ring and drawn cursor at the click, Zoom track item, click tick, no console errors. The variants check 50% intensity framing, original view and an ignored click (no ring, grey tick) |

Fixtures: `backend/tests/fixtures/focus_payload.json` is written by the frontend test (`UPDATE_FIXTURES=1 npm run desktop:test:js` after an intended change to the camera or pointer math; commit it). `camera_vectors.json` is a hand-kept list of window → pixel cases that both `windowPixels` (camera.ts) and `camera_geometry` (editor.py) must reproduce; add cases when changing either.

## Phase 3 before/after (alternating clicks)

Eight deliberate clicks alternating between x = 0.2 and x = 0.8, measured on the camera track at 30 Hz (`reversals` in focus.test.ts):

| Click spacing, preset | Before: zooms / camera reversals / clicks outside the view | After |
|---|---|---|
| 1.2 s, balanced | 8 / 8 / 7 of 8 | 4 / 2 / 0 |
| 1.2 s, dynamic | 8 / 8 / 7 of 8 | 4 / 2 / 0 |
| 2 s, balanced | 8 / 8 / 7 of 8 | 4 / 2 / 0 |
| 2 s, dynamic | 8 / 8 / 0 | 4 / 2 / 0 |
| 3 s, balanced | 8 / 8 / 0 | 7 / 8 / 0 |
| 4 s, balanced or dynamic | 8 / 8 / 0 | 8 / 8 / 0 |

At 3–4 s spacing each click keeps its own zoom and the camera eases out between them (slow, readable moves), so it was left as is.

Blur with a zoom, export vs the preview's order (zoom, then blur): mean pixel difference 3.29 before, 0.35 after (`test_blur_is_applied_after_the_zoom_like_the_preview`).

## Limitations

- No visual target detection (see above). Zoom size comes from interaction spread plus padding, not from element bounds.
- Recordings of a single window, or where the display couldn't be identified, store events in desktop coordinates; they can't be placed on the video, so automatic zoom and click highlights are unavailable (manual zooms still work).
- The drawn cursor needs a recording without the system cursor. On Windows the native capture leaves it out when "Leave the mouse pointer out of the video" is on (`IsCursorCaptureEnabled`, Windows 10 2004+); older WebView2 captures always include the pointer (and misreport `cursor: "never"`), so those get click highlights only. macOS (WKWebView) is unverified; the drawn cursor is offered only when "never" was requested and confirmed.
- The drawn cursor has a fixed arrow shape; it doesn't follow the system cursor's shape (text beam, hand) - that isn't recorded.
- With canvas fill the sides of the frame are cut by the canvas. The camera compensates (see Camera), but the window must stay inside the recording, so the outermost strip can't always be brought into view: for a 16:9 recording at 2× in a 9:16 project, clicks within about 11% of the left/right frame edge stay off-canvas (about 8% in a 1:1 project). Use fit, or a stronger zoom, for those. Letting the window leave the frame on the hidden side would fix it but needs a backend geometry change.
- Freeze-frame clips show no rings; reversed clips show the camera but no rings.
- The drawn cursor and click rings keep their canvas size when the camera zooms in. Scaling them with the zoom would mean resizing their sprites per frame in the export, which was measured about 6x slower for rings.
- Clicks alternating between two areas 3–4 s apart still get one zoom each, with the camera easing out and back in between.
- Export needs the updated backend (see Deployment).
