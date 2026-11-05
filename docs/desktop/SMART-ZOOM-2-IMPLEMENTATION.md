# Smart Zoom 2: focus sessions, natural motion and a zoom-aware cursor

Date: 5 November 2026. Builds on [FOCUS.md](FOCUS.md) (Phase 2 and 3). Everything here was measured or tested as described; anything not tested is listed under "Not tested".

## 1. Initial audit

The audit covered the code itself; the documentation was checked against it rather than trusted.

| Area | Where | Finding |
|---|---|---|
| Native input | `src-tauri/src/input/{mod,windows,macos,keys}.rs` | Pointer moves at up to `sampleHz`, buttons, scroll, shortcuts, and typing (no key identity, at most one event per 120 ms, optional text-cursor rect). Desktop coordinates in physical pixels (Windows) or points (macOS). |
| Event schema | `src/lib/recorder/format.ts`, `events.ts`, `coords.ts` | `events.jsonl`. With a known display, x/y are fractions of the captured surface (`desktopToCapture`). The surface and the events share one unit, so the fractions don't depend on resolution or DPI. **No DPI bug in the coordinates.** |
| Focus generation | `src/lib/editor/focus.ts` | Interactions, then clusters, then candidates (box or follow path), then pacing (merge, chain, back-and-forth), then thinning per minute. |
| Camera | `src/lib/editor/camera.ts` | Window `{x, y, s}` inside the crop. Keyframes are eased by interpolating the rectangle. Zooms closer than `CHAIN_GAP` (0.8 s) pan directly. |
| Zoom data | `types.ts` `CameraZoom` (source time), `focusPrefs.ts` (intensity, original view, exclusions, ignored clicks), `zoomEdits.ts` (edits, `mergeSuggestions`) | Every edit is one undo step through the project history. Manual zooms always win over suggestions. |
| Cursor and rings | `pointer.ts` (`pointerScene`), `pointerDraw.ts` | Size = `cursorSize × canvas height`, fixed. Ring radius is also fixed relative to the canvas. |
| Preview | `PreviewPlayer.tsx` | The camera is applied as an extra crop of the video slot. Pointer and masks are drawn on canvases above the video. |
| Export | `focusExport.ts`, `exportProject.ts`, `backend/app/pipeline/editor.py` | The browser evaluates the camera and pointer per output frame. The backend only positions sprites and scales frames (step expressions). |
| Persistence | `migrateProject` | `pointer` is merged over `DEFAULT_POINTER`, so new optional fields get their defaults. |
| Tests | `tests/desktop/focus.test.ts`, `focusPrefs.test.ts`, `backend/tests/test_focus_export.py`, `tests/desktop/manual/preview-focus.mjs` | Baseline: 234/234 JS, focus backend 10/10. |

## 2. Root causes

Each issue was reproduced with `tests/desktop/manual/smart-zoom-scenarios.mts` before any change.

1. **The drawn cursor didn't scale with the zoom.** `pointerScene` returned only a position, and `drawCursor` used `style.cursorSize × canvas height`. The export sprite was rendered once at that size. Ring radii were also fixed. The camera window never reached the size calculation.
2. **Zoom out and back in when clicks are 3–5 s apart.** Two neighbouring zooms were only merged or chained if the next one started before `prev.end + minGap`, where `prev.end = click + hold + easeOut`. For Dynamic this covers clicks less than about 3.4 s apart, and for Balanced about 4.8 s. Beyond that, every click became its own zoom-in and zoom-out (Dynamic, clicks 3.5 s apart: **7 zoom-outs for 8 clicks**). Thinning to the zooms-per-minute limit ran after chaining, so it also left holes that the camera dropped into.
3. **Unnecessary zooms while typing.**
   - (a) A shortcut pressed while typing (Ctrl+S) became an interaction placed at the *pointer*, which may be anywhere on screen. This split one typing session into separate clusters (Dynamic: 5 zooms, 4 zoom-outs).
   - (b) Typing zooms were capped at 45 s, so the rest of a longer text got no zoom.
   - (c) The follow path chased the text cursor across every line wrap: 14 pans in 45 s.
4. **Poor framing near screen edges.** In `followPath`, a point pressed against a frame edge always counted as "outside the dead zone", but the clamped camera center couldn't move. The result was pans that went nowhere, and they could replace a real pan that was pending within 0.5 s.
5. **Cursor position differed between preview and export.**
   - (a) The preview cropped the video with the camera at the clock time *before* advancing it in the frame loop, but drew the pointer and masks at the *advanced* time. While the camera moved, the cursor was a frame ahead of the picture under it.
   - (b) Once the zoom is applied, the size differences from cause 1 also apply. The export itself already used the preview's functions.

## 3. Architecture and decisions

### A. Focus sessions and cooldown (`focus.ts`)

There is a new stage after pacing, run before *and* after thinning (so holes left by thinning are bridged too):

- **`joinSessions`.** When the camera would rest at full view for less than `sessionGap`, the two zooms are joined:
  - *merged* if they show the same area (within the cluster radius) and the result is at most `maxSession` long;
  - otherwise *chained*: the first zoom holds until the second starts, then the camera pans.
- **`cooldown`.** A rest longer than `sessionGap` but shorter than `cooldown`:
  - same area: the camera stays;
  - different areas: the weaker zoom is dropped, unless both are important (a marker, or twice the preset's score threshold).
- **Safety: `showsActivity`.** Joining never holds the camera on one area while a recorded interaction happens outside the view. This includes interactions that got no zoom of their own. In that case the camera zooms out to show it. This guard came from a regression found during development: one click out of 8 was hidden.
- **Long typing** is split into chained pieces of at most `maxSession` (`splitLong`) instead of being cut off at 45 s.
- **Shortcuts** within 1.5 s of a typing burst count as part of the typing.
- **Typing follow** aims at the middle of the text-cursor positions within ±4 s when they fit (`TYPING_FRAME_SPAN`). A whole line stays framed, and wrapping to the next line doesn't pan.
- **Edges**: no pan when the clamped center can't move.
- **Settings.** The new settings are optional (`sessionGap`, `cooldown`, `maxSession`, `includeShortcuts`). Settings objects without them use `DEFAULT_SESSION`. This is tested.

### B. Creator profiles (`focusSettings(preset, profile)`)

| Profile | What changes from the preset |
|---|---|
| Tutorial | Preset as is: typing, shortcuts, follow, sessions up to 60 s |
| Demo | Zoom ×0.8 above 1× (at least 1.3×), threshold +0.3, 75 % of the zooms per minute, session gap ×0.8, sessions up to 30 s |
| Gaming | Zoom ≤1.5× (max 1.8×), gentle and slower easing, threshold +1.5, at most 3 zooms per minute. No typing (movement keys look like typing), no shortcuts, no scrolling, no follow. Session gap 1.5 s, cooldown 8 s, sessions up to 15 s. Markers still zoom. |

### C. Natural motion (`camera.ts`)

- **New ease `natural`**: cubic Bezier (0.45, 0, 0.15, 1), with a prompt start and a soft landing. It is the default for Balanced and Dynamic suggestions.
- **Perceptual zoom rate.** For `natural`, the window size changes geometrically instead of linearly (`along()`). The zoom then seems to change at a steady rate instead of speeding up as it closes in.
- **Same path.** Only the speed along the path changes. The window stays on the straight segment between two keyframes, so it never leaves the frame and the focus point stays fixed (tested).
- **Older zooms are unchanged.** Zooms with `smooth`, `gentle` or `linear` interpolate exactly as before, so older projects animate as they did.

### D. Zoom-aware cursor (`pointer.ts`, `pointerDraw.ts`, `focusExport.ts`, backend)

`pointerScale(style, crop, camCrop, box)` is used by both the preview and the export rows, every frame:

- `scaleWithZoom` (default and migration: **on**): the scale includes `crop.h / camCrop.h`, the camera magnification. The rings get the same factor.
- `sizeBase: "recording"` (opt-in): sizes are fractions of the *recording's* height (`box.h / crop.h` of the canvas). The cursor then keeps its size next to the screen whatever the canvas shape, fit or region crop.
- **Match recording size**: `nativeCursorSize(capture)` = 22 logical px ÷ the display's logical height (physical px ÷ scaleFactor on Windows, points on macOS). 1080p at 100 % and 4K at 200 % give the same value (tested).
- **Scale limit**: at most 6×. The sprite height stays within the backend's limit.

**Export of the cursor:**

- Cursor rows get a 4th column `k` (0..1, size relative to the sprite) **only when the size varies**. Otherwise they keep the old 3-column rows, so a cursor with a constant size still works with an older backend.
- The sprite is rendered at the largest scale, so it is sharp when zoomed in.
- The backend (`_scaled_cursor`) never resizes an overlay per frame, which was measured as very slow for rings. It uses three kinds of layer:
  - **exact static layers** for the up to 3 sizes held at least 0.5 s (rest, and the zoom levels the camera holds);
  - **static layers on a 1 % ladder** for sizes passed through during transitions, at most 0.5 % size error;
  - **`geq` resampling around the hotspot** for whatever is left beyond 48 layers.

Each layer only runs while its size is shown. The tip stays exactly on the recorded position (tested with real ffmpeg).

### E. Preview time fix (`PreviewPlayer.tsx`)

`frameT` is the time the video slots were cropped for. The pointer and the masks are drawn for that same time.

### F. User controls

These are kept, and tests still pass:

- zoom intensity;
- presets;
- ignore click at playhead;
- no zooms for a range;
- compare with original / original view;
- manual zoom editing on the Zoom track (including `mergeSuggestions`: suggestions never overlap a manual zoom, tested again with sessions).

New controls in the Focus panel:

- **Recording type**: Tutorial / Demo / Gaming.
- **Customize**: "Stay zoomed between actions" (`sessionGap`), "Rest between zooms" (`cooldown`), "Use shortcuts".
- **Easing**: "Natural".
- **Pointer**: "Grow with the zoom", "Match recording size", "Size relative to the recording".

## 4. Files changed

- **Engine**:
  - `src/lib/editor/focus.ts` (sessions, cooldown, profiles, typing, follow)
  - `src/lib/editor/camera.ts` (natural ease, perceptual interpolation)
  - `src/lib/editor/types.ts` (`ZoomEase` "natural", `PointerStyle.scaleWithZoom` / `sizeBase`)
- **Pointer**:
  - `src/lib/editor/pointer.ts` (`pointerScale`, `nativeCursorSize`, scaled scene)
  - `pointerDraw.ts` (scaled drawing, sprite at max scale)
  - `focusExport.ts` (size column, `cursorScale`, limits)
  - `exportProject.ts`
- **UI**:
  - `src/components/editor/FocusPanel.tsx`
  - `VideoEditor.tsx` (passes `nativeCursorSize`)
  - `PreviewPlayer.tsx` (`frameT`)
- **Backend**:
  - `backend/app/pipeline/editor.py` (`cursor_scales`, `_scaled_cursor`; 3-column path unchanged)
  - `backend/app/main.py` (accepts 3- or 4-column cursor rows, validates k)
- **Tests**:
  - new: `tests/desktop/smartZoom.test.ts`
  - changed: `tests/desktop/focus.test.ts` (fixture extended with a drawn cursor; typing-path assertion relaxed to ≥1 pan, since fewer pans is the intended change), `backend/tests/test_focus_export.py` (4 new tests)
  - fixture: `backend/tests/fixtures/focus_payload.json` (regenerated)
- **Tools**:
  - `tests/desktop/manual/smart-zoom-scenarios.mts`
  - `tests/desktop/manual/bench-smart-zoom.mts`
  - `backend/tests/bench_cursor_scale.py`

The working tree already held uncommitted crossfade work: `xfade.ts`, `Inspector.tsx`, `Timeline.tsx`, `timeline.ts`, and parts of `VideoEditor.tsx`, `PreviewPlayer.tsx` and `editor.py`. That work is not part of this change and was left as it was.

## 5. Tests executed (exact results)

| Command | Result |
|---|---|
| `npm run desktop:test:js` (before) | 234/234 |
| `npm run desktop:test:js` (after) | **259/259** (25 new in `smartZoom.test.ts`) |
| `cd backend && python -m unittest tests.test_focus_export` | **14/14** (4 new: cursor grows with zoom via static and geq paths, 20 s growing-cursor speed, row validation, frontend fixture cursor rendered like the preview) |
| `cd backend && python -m pytest tests -q` | **146 passed** |
| `npx tsc --noEmit` root and `-p desktop/tsconfig.json` | pass |
| ESLint on changed files | pass (0 problems) |
| `node tests/desktop/manual/preview-focus.mjs http://localhost:3100/ <out> default\|half\|original\|ignored` against `next dev desktop` in headless Chrome | **4/4 variants pass**, no console errors. In the screenshots the cursor is about 44 px at rest and about 88 px at 2× zoom, with the tip on the click. |

New JS tests cover:

- **Clicks**:
  - consecutive clicks 2–5 s apart (both presets);
  - independent clicks still separate;
  - alternating areas, no click hidden;
  - joining never hides an action;
  - cooldown (weak dropped, marker kept, both important kept, off);
  - session length bound;
  - old settings objects.
- **Typing**:
  - 90 s of continuous typing, every caret in view, ≤6 pans;
  - thinking pauses with far-away shortcuts give one zoom.
- **Drag and multiple focus points**: a drag is followed; multiple focus points are each visible.
- **Screen edges**: four edge and corner positions, no idle pans.
- **Profiles and manual zooms**:
  - profiles (gaming ignores typing, shortcuts and scroll; markers still zoom; demo is wider and makes fewer zooms);
  - manual zooms are never overlapped.
- **Motion**: natural ease (monotone, exact ends, on the straight path, older eases unchanged); chained pans with no jump.
- **Cursor size**:
  - cursor and ring scale with zoom, intensity and original view, with the tip exact;
  - multiple source resolutions (720p to 4K, ultrawide);
  - high DPI (Windows 100/150/200 %, macOS points);
  - canvas aspect changes (landscape, portrait, square, fit and fill);
  - the scale limit;
  - a region crop.
- **Editing, consistency and persistence**:
  - timeline edits (split, reorder, 2× speed);
  - preview and export rows agree on every frame (position 1e-4, size 1e-3);
  - 3-column rows when the size is constant;
  - save and reopen, and migration.

## 6. Before and after

`tests/desktop/manual/smart-zoom-scenarios.mts`. **Zoom-outs** counts the times the camera returns to full view between the first zoom-in and the last zoom-out. **Moves** counts camera moves (each zoom-in, pan or zoom-out). Clicks hidden was 0 in every row, before and after.

| Scenario (8 clicks unless noted) | Before: zooms / zoom-outs / moves | After |
|---|---|---|
| Balanced, same area, clicks 2 s apart | 3 / 0 / 2 | 1 / 0 / 2 |
| Balanced, same area, clicks 5 s apart | 8 / **7** / 16 | 1 / 0 / 2 |
| Dynamic, same area, clicks 3.5 s apart | 8 / **7** / 16 | 1 / 0 / 2 |
| Dynamic, same area, clicks 4 s apart | 8 / **7** / 16 | 1 / 0 / 2 |
| Dynamic, same area, clicks 5 s apart | 8 / **7** / 16 | 1 / 0 / 2 |
| Dynamic, two areas, clicks 4 s apart | 8 / **7** / 16 | 8 / 0 / 9 (pans) |
| Balanced, two areas, clicks 3 s apart | 7 / 1 / 9 | 6 / 1 / 8 (the one zoom-out shows a click no zoom covers) |
| Balanced, 90 s of multi-line typing | 1 zoom ending at 44 s / 0 / **16** | 2 chained, whole text / 0 / 4 |
| Dynamic, typing with pauses and far-away shortcuts | 5 / **4** / 10 | 1 / 0 / 2 |

Cursor size at a 2.5× zoom on a 1080p canvas with a cursor of 0.045, computed from `pointerScale` and checked by the unit tests: before, 49 px at rest and **49 px** zoomed. After, 49 px at rest and 122 px zoomed, which matches the 2.5× magnification of the screen under it. Measured in the headless preview at 2×: about 44 px at rest and about 88 px zoomed.

## 7. Performance

| Benchmark | Before | After |
|---|---|---|
| Analysis, 1 min / 15 min / 60 min recording (`bench-smart-zoom.mts`, best of 3) | 1.2 / 15.0 / 112.4 ms | 1.1 / 12.4 / 101.9 ms |
| Camera rows, 60 min | 22.9 ms | 29.8 ms |
| Pointer rows (drawn cursor), 1 / 15 / 60 min | 36 / 95 / 325 ms | 28 / 107 / 354 ms |
| Export, 30 s at 1080p (`bench_cursor_scale.py`): no pointer / fixed cursor / growing cursor with a zoom every 4 s | 11.0 / 13.6 s / - | growing: geq only **18.1 s**, ladder hybrid (shipped) **16.3 s** |
| Backend test: 20 s growing cursor at 320×180 | - | 1.5–2.0 s |

The ladder hybrid costs about 20 % more than a fixed cursor in this stress case: a zoom every 4 s, cursor visible throughout. With typical zoom density the share of transition frames is smaller.

## 8. Compatibility

- **Older projects open unchanged**: new fields are optional.
- **Behaviour change for existing projects**: a project with a drawn cursor or click rings *and* zooms now shows the cursor and rings growing with the zoom. This is the bug fix. It can be turned off with "Grow with the zoom".
- **Unchanged for existing projects**:
  - Older zooms keep their easing curves.
  - Projects without zooms produce the same export graph as before.
  - Suggestions already in a project don't change until the recording is analyzed again.
- **Backend**: a varying cursor size sends 4-column rows, which needs this backend. An older backend rejects them with "Invalid pointer data". The desktop app bundles its engine, so they ship together. The website's backend must be deployed before a web build sends such rows. A constant-size cursor still sends 3-column rows.

## 9. Known limitations

- No visual target detection. Focus is still derived from events (see FOCUS.md).
- Cooldown drops the weaker of two zooms on unrelated areas. A quick action in a third area right after can still get a zoom-out: the camera shows it rather than hide it.
- The size of the native cursor is an estimate: 22 logical px for the standard arrow. Custom large system cursors aren't recorded.
- The drawn arrow shape is still fixed (no text beam or hand).
- Gaming profile thresholds are reasoned defaults. They were not tuned on real gameplay recordings.
- `maxSession` splitting can leave a chained seam at the split point. The camera stays zoomed, but a follow path restarts from the last pan position.
- In the export, transition sizes are within 0.5 % of the preview (ladder), and beyond 48 distinct sizes geq is used.

## 10. Not tested (manual checks still required)

- Real recordings on real hardware:
  - Windows at 125/150/200 % scaling;
  - a macOS Retina display;
  - multiple monitors.
  The DPI paths are covered by unit tests on the manifest data only.
- A full desktop export in the Tauri app with the bundled engine. The backend was tested directly with ffmpeg, and the preview in headless Chrome against `next dev`.
- A subjective review of the natural easing and of the profiles on real tutorials, demos and games.
