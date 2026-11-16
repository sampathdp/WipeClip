// Run with: npm run desktop:test:js
// Layer boxes, alignment, snapping, crop and placement (src/lib/editor/layerGeometry.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  alignRects,
  applyCrop,
  centerCrop,
  cornerPosition,
  cropEdge,
  distributeRects,
  equalSize,
  fitToCanvas,
  frameLayer,
  layerAspect,
  layerRect,
  placeInCell,
  rectBounds,
  resetTransform,
  sizePatch,
  snapBounds,
  type LayerRect,
  type VideoLayer,
} from "../../src/lib/editor/layerGeometry.ts";
import { overlayValues } from "../../src/lib/editor/keyframes.ts";

const CANVAS = { width: 1920, height: 1080 };
const HD = { width: 1920, height: 1080 };
const near = (a: number, b: number, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const video = (patch: Partial<VideoLayer> = {}): VideoLayer => ({
  id: "v",
  kind: "video",
  sourceId: "s",
  offset: 0,
  volume: 1,
  start: 0,
  end: 10,
  x: 0.5,
  y: 0.5,
  width: 0.5,
  rotation: 0,
  opacity: 1,
  animIn: "none",
  animOut: "none",
  hidden: false,
  locked: false,
  ...patch,
});

const rect = (id: string, x: number, y: number, w: number, h: number, rotation = 0): LayerRect => ({ id, x, y, w, h, rotation });

test("a layer's box follows its picture, its crop and its stretch", () => {
  near(layerAspect(video(), HD), 16 / 9);
  near(layerAspect(video({ crop: { x: 0, y: 0, w: 0.5, h: 1 } }), HD), 8 / 9);
  near(layerAspect(video({ aspect: 2 }), HD), 2);
  // Half the canvas wide, same shape as the canvas: half as high.
  const r = layerRect(video(), 0.5, HD, CANVAS, 0);
  near(r.w, 0.5);
  near(r.h, 0.5);
  // Cropped to its left half: the box is half as wide for the same height.
  const c = layerRect(video({ width: 0.25, crop: { x: 0, y: 0, w: 0.5, h: 1 } }), 0.25, HD, CANVAS, 0);
  near(c.h, 0.5);
});

test("bounds of a turned box", () => {
  const b = rectBounds(rect("a", 0.5, 0.5, 0.5, 0.5, 90), CANVAS);
  // 960 x 540 px turned a quarter: 540 wide, 960 high.
  near(b.r - b.l, 540 / 1920);
  near(b.b - b.t, 960 / 1080);
});

test("align: one layer to the canvas, several to their own bounds", () => {
  const one = alignRects([rect("a", 0.5, 0.5, 0.2, 0.2)], "left", CANVAS);
  near(one.get("a")!.x, 0.1);
  const bottom = alignRects([rect("a", 0.5, 0.5, 0.2, 0.2)], "bottom", CANVAS);
  near(bottom.get("a")!.y, 0.9);
  const two = [rect("a", 0.3, 0.3, 0.2, 0.2), rect("b", 0.7, 0.6, 0.4, 0.2)];
  const left = alignRects(two, "left", CANVAS);
  near(left.get("a")!.x, 0.3); // already the leftmost edge (0.2)
  near(left.get("b")!.x, 0.4);
  const mid = alignRects(two, "vcenter", CANVAS);
  near(mid.get("a")!.y, 0.45);
  near(mid.get("b")!.y, 0.45);
  // The same two, to the canvas instead.
  near(alignRects(two, "right", CANVAS, true).get("a")!.x, 0.9);
});

test("distribute: centres evenly, or equal gaps", () => {
  const rs = [rect("a", 0.1, 0.5, 0.1, 0.1), rect("b", 0.2, 0.5, 0.2, 0.1), rect("c", 0.9, 0.5, 0.1, 0.1)];
  const centers = distributeRects(rs, "h", "centers", CANVAS);
  near(centers.get("a")!.x, 0.1);
  near(centers.get("b")!.x, 0.5);
  near(centers.get("c")!.x, 0.9);
  const gaps = distributeRects(rs, "h", "gaps", CANVAS);
  // a ends at 0.15, c starts at 0.85: 0.7 of room, b takes 0.2, two gaps of 0.25.
  near(gaps.get("b")!.x, 0.15 + 0.25 + 0.1);
  assert.equal(distributeRects(rs.slice(0, 2), "h", "gaps", CANVAS).size, 0);
  const v = distributeRects([rect("a", 0.5, 0.1, 0.1, 0.1), rect("b", 0.5, 0.3, 0.1, 0.1), rect("c", 0.5, 0.7, 0.1, 0.1)], "v", "centers", CANVAS);
  near(v.get("b")!.y, 0.4);
});

test("equal width and height keep each layer's proportions", () => {
  const rs = [rect("a", 0.3, 0.3, 0.2, 0.2), rect("b", 0.7, 0.6, 0.4, 0.1)];
  const w = equalSize(rs, "width", "a");
  near(w.get("a")!, 1);
  near(w.get("b")!, 0.5);
  near(equalSize(rs, "height", "b").get("a")!, 0.5);
  // The factor becomes a width (or a text size).
  near((sizePatch(video({ width: 0.4 }), 0.5, 0) as { width: number }).width, 0.2);
});

test("fit to canvas contains the turned box", () => {
  const f = fitToCanvas(rect("a", 0.2, 0.2, 0.25, 0.5), CANVAS);
  near(f.factor, 2);
  near(f.x, 0.5);
});

test("snapping pulls edges and centres onto the canvas and other layers", () => {
  const canvas = { l: 0, t: 0, r: 1, b: 1 };
  const other = { l: 0.6, t: 0.2, r: 0.9, b: 0.5 };
  const th = { x: 0.01, y: 0.01 };
  // Left edge 0.004 from the canvas edge.
  const a = snapBounds({ l: 0.004, t: 0.3, r: 0.204, b: 0.45 }, [canvas, other], th);
  near(a.dx, -0.004);
  assert.deepEqual(a.x, [0]);
  assert.equal(a.dy, 0);
  // Right edge near the other layer's left edge, top near its top.
  const b = snapBounds({ l: 0.43, t: 0.205, r: 0.595, b: 0.4 }, [canvas, other], th);
  near(b.dx, 0.005);
  near(b.dy, -0.005);
  assert.deepEqual(b.x, [0.6]);
  assert.deepEqual(b.y, [0.2]);
  // Centre on the canvas centre.
  const c = snapBounds({ l: 0.397, t: 0.7, r: 0.597, b: 0.8 }, [canvas], th);
  near(c.dx, 0.003);
  assert.deepEqual(c.x, [0.5]);
  // Nothing close: no pull.
  assert.deepEqual(snapBounds({ l: 0.13, t: 0.63, r: 0.33, b: 0.73 }, [canvas], th), { dx: 0, dy: 0, x: [], y: [] });
});

test("corner placement leaves the same margin on both axes", () => {
  const r = rect("a", 0.5, 0.5, 0.2, 0.2);
  const br = cornerPosition(r, CANVAS, "bottom-right");
  // 4% of the short side (43.2 px) from each edge.
  near((1 - br.x - 0.1) * 1920, 43.2, 0.01);
  near((1 - br.y - 0.1) * 1080, 43.2, 0.01);
  assert.deepEqual(cornerPosition(r, CANVAS, "center"), { x: 0.5, y: 0.5 });
  near(cornerPosition(r, CANVAS, "top").x, 0.5);
});

test("placing in a rectangle: fill crops, fit contains, stretch reshapes", () => {
  const left = { x: 0, y: 0, w: 0.5, h: 1 };
  assert.deepEqual(centerCrop(16 / 9, 8 / 9), { x: 0.25, y: 0, w: 0.5, h: 1 });
  const fill = placeInCell(HD, undefined, left, CANVAS, "fill");
  assert.deepEqual(fill, { x: 0.25, y: 0.5, width: 0.5, crop: { x: 0.25, y: 0, w: 0.5, h: 1 } });
  const fit = placeInCell(HD, undefined, left, CANVAS, "fit");
  near(fit.width, 0.5);
  assert.equal(fit.crop, undefined);
  // A tall video fitted in the left half: as high as the canvas.
  const tall = placeInCell({ width: 1080, height: 1920 }, undefined, left, CANVAS, "fit");
  near(tall.width, (1080 / 1920) * (1080 / 1920));
  const stretch = placeInCell(HD, undefined, left, CANVAS, "stretch");
  near(stretch.aspect!, 8 / 9);
  // A picture already the rectangle's shape isn't cropped.
  assert.equal(placeInCell(HD, undefined, { x: 0, y: 0, w: 0.5, h: 0.5 }, CANVAS, "fill").crop, undefined);
});

test("cropping by an edge keeps the picture where it is", () => {
  const o = video({ width: 0.5 }); // box 960 x 540 px at the centre
  const p = cropEdge(o, HD, CANVAS, "right", -0.125, 0); // right edge in by 240 px
  assert.deepEqual(p.crop, { x: 0, y: 0, w: 0.75, h: 1 });
  near(p.width!, 0.375);
  near(p.x!, 0.5 - 0.0625); // the box's centre moves left by half of it
  near(p.y!, 0.5);
  // The left edge stays where it was.
  near(p.x! - p.width! / 2, 0.25);
  // Back out past the frame's edge: stops at the whole frame.
  const back = cropEdge({ ...o, ...p } as VideoLayer, HD, CANVAS, "right", 0.5, 0);
  assert.equal(back.crop, undefined);
  near(back.width!, 0.5);
  near(back.x!, 0.5);
  // Top edge down by a quarter of the box's height: the height follows.
  const top = cropEdge(o, HD, CANVAS, "top", -0.125, 0);
  assert.deepEqual(top.crop, { x: 0, y: 0.25, w: 1, h: 0.75 });
  near(top.width!, 0.5);
  near(top.y!, 0.5 + 0.0625);
  near(layerRect({ ...o, ...top } as VideoLayer, 0.5, HD, CANVAS, 0).h, 0.375);
  // Never below the smallest crop.
  near(cropEdge(o, HD, CANVAS, "left", -5, 0).crop!.w, 0.05);
});

test("cropping a turned layer moves it along its own axis", () => {
  const o = video({ width: 0.5, rotation: 90 });
  const p = cropEdge(o, HD, CANVAS, "right", -0.125, 0);
  near(p.x!, 0.5);
  // Its right edge points down the screen: the centre moves up by 120 px.
  near(p.y!, 0.5 - 120 / 1080);
});

test("cropping an animated layer keeps its keyframes", () => {
  const kfs = [
    { t: 0, x: 0.2, y: 0.2, scale: 1, rotation: 0, opacity: 1, ease: "smooth" as const },
    { t: 5, x: 0.8, y: 0.8, scale: 2, rotation: 0, opacity: 0.5, ease: "smooth" as const },
  ];
  const o = video({ width: 0.2, keyframes: kfs });
  const p = applyCrop(o, HD, CANVAS, { x: 0, y: 0, w: 0.5, h: 1 }, 0);
  assert.equal(p.keyframes!.length, 2);
  assert.equal(p.keyframes![1].scale, 2);
  assert.equal(p.keyframes![1].opacity, 0.5);
  near(p.width!, 0.1);
  assert.equal(p.x, undefined);
});

test("stretch follows a crop", () => {
  const o = video({ width: 0.5, aspect: 2 });
  const p = cropEdge(o, HD, CANVAS, "right", -0.25, 0);
  near(p.aspect!, 1);
});

test("fit, fill and stretch over the whole canvas", () => {
  const sq = { width: 1000, height: 1000 };
  const fill = frameLayer(video({ rotation: 20, camLayout: { shape: "circle", size: "medium", corner: "top-left" }, mask: { shape: "circle", x: 0.5, y: 0.5, w: 1, h: 1, rotation: 0, feather: 0, invert: false } }), sq, CANVAS, "fill", 0);
  near(fill.width, 1);
  assert.equal(fill.rotation, 0);
  near(fill.crop!.h, 9 / 16);
  assert.equal(fill.camLayout, undefined);
  assert.equal(fill.mask, null);
  const fit = frameLayer(video(), sq, CANVAS, "fit", 0);
  near(fit.width, 1080 / 1920);
  assert.equal(fit.crop, undefined);
  near(frameLayer(video(), sq, CANVAS, "stretch", 0).aspect!, 16 / 9);
});

test("fit on an animated layer adds a keyframe instead of removing any", () => {
  const kfs = [{ t: 0, x: 0.2, y: 0.2, scale: 1, rotation: 0, opacity: 1, ease: "smooth" as const }];
  const o = frameLayer(video({ width: 0.25, keyframes: kfs }), HD, CANVAS, "fit", 4);
  assert.equal(o.keyframes!.length, 2);
  assert.equal(o.width, 0.25);
  const at = overlayValues(o, 4);
  near(at.x, 0.5);
  near(at.scale, 4);
});

test("reset transform", () => {
  const o = resetTransform(video({ x: 0.1, y: 0.9, width: 0.9, rotation: 33, opacity: 0.4, crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, aspect: 3 }), HD, CANVAS, 0) as VideoLayer;
  assert.equal(o.x, 0.5);
  assert.equal(o.rotation, 0);
  assert.equal(o.opacity, 1);
  assert.equal(o.crop, undefined);
  assert.equal(o.aspect, undefined);
  near(o.width, 0.4);
});
