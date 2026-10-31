/** Automatic focus-zoom suggestions from recorded interaction events.
 * Pure and deterministic - see tests/desktop/focus.test.ts.
 *
 * It works only from what was actually recorded: click positions and
 * times, how still the pointer was before a click, drags, scroll bursts,
 * shortcuts, typing (when and where the text cursor was - never which
 * keys), user markers and pause cuts. It does not look at the pixels
 * and knows nothing about buttons, text or apps, so focus regions are
 * sized from where the interactions happened, with padding so the
 * surroundings of a click stay readable.
 *
 * Pipeline:
 *   1. interactions: clicks (double-clicks merged, drags followed), scroll
 *      bursts, shortcuts, typing bursts, each with a significance score;
 *   2. clusters: consecutive interactions close in time and space,
 *      broken at pauses and when a cluster gets too long;
 *   3. candidates: clusters scoring above the preset's threshold (or
 *      holding a marker), with a focus box padded around their points -
 *      or, when the points are too spread out for the preset's zoom, a
 *      path the camera follows (it pans from point to point, keeping each
 *      one in view, instead of zooming out to fit them all);
 *   4. pacing: near neighbours are merged or chained (the camera pans
 *      instead of zooming out and in), and the densest stretches are
 *      thinned to the preset's zooms-per-minute.
 */
import { CHAIN_GAP } from "./camera.ts";
import type { CameraZoom, ZoomEase, ZoomPathPoint } from "./types.ts";
import type { InteractionEvent } from "../recorder/format.ts";

export interface FocusSettings {
  /** Zoom for a typical focus (a tight cluster may go up to maxZoom). */
  zoom: number;
  maxZoom: number;
  minDuration: number;
  maxDuration: number;
  /** Fully zoomed in this long before the first interaction. */
  lead: number;
  /** Stay this long after the last interaction. */
  hold: number;
  easeIn: number;
  easeOut: number;
  ease: ZoomEase;
  /** Interactions further apart than this start a new cluster (seconds). */
  clusterGap: number;
  /** ...or further than this from the cluster (fraction of frame width). */
  clusterRadius: number;
  /** Clusters scoring lower get no zoom (one deliberate click ~ 1.6). */
  minScore: number;
  /** Zooms closer than this are merged or chained. */
  minGap: number;
  maxPerMinute: number;
  includeScroll: boolean;
  useMarkers: boolean;
  /** Zoom in on typing (recordings with typing activity). */
  includeTyping: boolean;
  /** Pan with the action inside a zoom instead of zooming out to fit it. */
  follow: boolean;
}

export type FocusPreset = "subtle" | "balanced" | "dynamic";

export const FOCUS_PRESETS: Record<FocusPreset, FocusSettings> = {
  subtle: {
    zoom: 1.4,
    maxZoom: 1.8,
    minDuration: 2.2,
    maxDuration: 7,
    lead: 0.5,
    hold: 1.6,
    easeIn: 0.9,
    easeOut: 0.9,
    ease: "gentle",
    clusterGap: 1.6,
    clusterRadius: 0.22,
    minScore: 2.4,
    minGap: 2.5,
    maxPerMinute: 4,
    includeScroll: false,
    useMarkers: true,
    includeTyping: true,
    follow: true,
  },
  balanced: {
    zoom: 1.8,
    maxZoom: 2.3,
    minDuration: 1.8,
    maxDuration: 8,
    lead: 0.45,
    hold: 1.5,
    easeIn: 0.65,
    easeOut: 0.7,
    ease: "smooth",
    clusterGap: 1.3,
    clusterRadius: 0.18,
    minScore: 1.5,
    minGap: 1.5,
    maxPerMinute: 8,
    includeScroll: true,
    useMarkers: true,
    includeTyping: true,
    follow: true,
  },
  dynamic: {
    zoom: 2.3,
    maxZoom: 2.8,
    minDuration: 1.4,
    maxDuration: 10,
    lead: 0.35,
    hold: 1.2,
    easeIn: 0.45,
    easeOut: 0.55,
    ease: "smooth",
    clusterGap: 1.1,
    clusterRadius: 0.15,
    minScore: 1.0,
    minGap: 0.9,
    maxPerMinute: 14,
    includeScroll: true,
    useMarkers: true,
    includeTyping: true,
    follow: true,
  },
};

/** Below this the zoom isn't worth the motion. */
const MIN_USEFUL_ZOOM = 1.15;
/** Padding around a focus box, fraction of frame width (height scaled to
 * the same pixels), so labels next to a click aren't cut off. */
const PAD = 0.07;
const DOUBLE_CLICK = 0.45;
const DWELL_WINDOW = 0.4;
/** Pointer speed (frame widths per second) below which it counts as
 * having settled on a target before the click. */
const DWELL_SPEED = 0.25;
/** A pointer that moved this far (frame widths) with the button held dragged. */
const DRAG_DISTANCE = 0.03;
/** Typing events further apart than this (s) are separate bursts. */
const TYPING_GAP = 1.5;
/** Fewer typing events than this (one per 120 ms of typing at most) aren't
 * worth a zoom. */
const TYPING_MIN_EVENTS = 4;
/** Without a text cursor position, typing is placed at a click this
 * recent (s) - people click into a field, then type. */
const TYPING_CLICK_WINDOW = 30;
/** A followed point inside the middle of the window doesn't move the
 * camera (half-width of that dead zone, fraction of the window). */
const DEAD_ZONE = 0.32;
/** Points this close in time (s) need to be in view together. */
const TOGETHER = 0.6;
/** Typing zooms may run this long (s) - a sentence takes a while. */
const TYPING_MAX_DURATION = 45;

interface Interaction {
  t: number; // seconds
  /** Last moment of the interaction (a drag's release, a typing burst's
   * last key); t for instant ones. */
  tEnd: number;
  x: number;
  y: number;
  score: number;
  kind: "click" | "scroll" | "key" | "typing";
  /** Later positions while it lasts (drag, text cursor while typing). */
  path: ZoomPathPoint[];
  marker?: string;
}

interface Cluster {
  items: Interaction[];
  score: number;
  markers: string[];
}

export interface FocusInput {
  events: InteractionEvent[];
  /** Source duration, seconds. */
  duration: number;
  /** Frame width / height. */
  aspect: number;
  sourceId: string;
}

export interface FocusResult {
  zooms: CameraZoom[];
  stats: { clicks: number; clusters: number; suggested: number; skippedSmall: number; skippedPacing: number };
}

const inside = (x: number, y: number) => x >= 0 && x <= 1 && y >= 0 && y <= 1;

/** Events inside the recording with usable numbers, in time order. A
 * damaged or hand-edited events file can hold NaN, a time past the end
 * or a negative one; those used to produce a zoom with no end. */
function validEvents(events: InteractionEvent[], duration: number): InteractionEvent[] {
  const endMs = duration * 1000;
  const ok = events.filter((e) => {
    if (!Number.isFinite(e.t) || e.t < 0 || e.t > endMs) return false;
    if ("x" in e && !(Number.isFinite(e.x) && Number.isFinite(e.y))) return false;
    return true;
  });
  for (let i = 1; i < ok.length; i++) if (ok[i].t < ok[i - 1].t) return ok.sort((a, b) => a.t - b.t);
  return ok;
}

/** Pointer speed just before `t`, from move samples (frame widths/s). */
function speedBefore(moves: { t: number; x: number; y: number }[], t: number, aspect: number): number {
  // Binary search for the last move at or before t.
  let lo = 0;
  let hi = moves.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (moves[mid].t <= t) lo = mid + 1;
    else hi = mid;
  }
  let dist = 0;
  for (let i = lo - 1; i > 0 && moves[i].t >= t - DWELL_WINDOW; i--) {
    const a = moves[i - 1];
    const b = moves[i];
    dist += Math.hypot(b.x - a.x, (b.y - a.y) / aspect);
  }
  return dist / DWELL_WINDOW;
}

export function collectInteractions(events: InteractionEvent[], aspect: number, s: FocusSettings) {
  const moves: { t: number; x: number; y: number }[] = [];
  const cuts: number[] = [];
  const markers: { t: number; label: string }[] = [];
  for (const e of events) {
    if (e.type === "move") moves.push({ t: e.t / 1000, x: e.x, y: e.y });
    else if (e.type === "pause") cuts.push(e.t / 1000);
    else if (e.type === "marker") markers.push({ t: e.t / 1000, label: e.label });
  }
  const out: Interaction[] = [];
  const typing: { t: number; caret: { x: number; y: number } | null }[] = [];
  let clicks = 0;
  let lastScroll: Interaction | null = null;
  let lastPointer: { x: number; y: number } | null = null;
  let pressed: Interaction | null = null; // left button down, for drags
  for (const e of events) {
    if ("x" in e && typeof e.x === "number") lastPointer = { x: e.x, y: e.y };
    if (e.type === "button" && !e.down && e.button === "left" && pressed) {
      followDrag(pressed, moves, e.t / 1000, aspect);
      pressed = null;
    } else if (e.type === "button" && e.down && (e.button === "left" || e.button === "right")) {
      if (!inside(e.x, e.y)) continue; // on another display
      clicks++;
      const t = e.t / 1000;
      const prev = out[out.length - 1];
      if (prev?.kind === "click" && t - prev.t < DOUBLE_CLICK && Math.hypot(prev.x - e.x, (prev.y - e.y) / aspect) < 0.02) {
        prev.score += 0.3; // double-click: one deliberate action
        if (e.button === "left") pressed = prev;
        continue;
      }
      const dwell = speedBefore(moves, t, aspect) < DWELL_SPEED ? 0.6 : 0;
      const click: Interaction = { t, tEnd: t, x: e.x, y: e.y, score: (e.button === "left" ? 1 : 0.8) + dwell, kind: "click", path: [] };
      out.push(click);
      if (e.button === "left") pressed = click;
    } else if (e.type === "typing" && s.includeTyping) {
      typing.push({ t: e.t / 1000, caret: e.caret && inside(e.caret.x, e.caret.y) ? { x: e.caret.x, y: e.caret.y } : null });
    } else if (e.type === "scroll" && s.includeScroll && inside(e.x, e.y)) {
      const t = e.t / 1000;
      // One interaction per scroll burst.
      if (lastScroll && t - lastScroll.t < 0.6 && Math.hypot(lastScroll.x - e.x, lastScroll.y - e.y) < 0.05) {
        lastScroll.t = t;
        continue;
      }
      lastScroll = { t, tEnd: t, x: e.x, y: e.y, score: 0.4, kind: "scroll", path: [] };
      out.push(lastScroll);
    } else if (e.type === "key" && lastPointer && inside(lastPointer.x, lastPointer.y)) {
      const t = e.t / 1000;
      out.push({ t, tEnd: t, x: lastPointer.x, y: lastPointer.y, score: 0.3, kind: "key", path: [] });
    }
  }
  out.push(...typingBursts(typing, out, moves, cuts));
  out.sort((a, b) => a.t - b.t);
  return { interactions: out, moves, cuts, markers, clicks };
}

/** A left press that moved: the zoom follows the drag to its release. */
function followDrag(press: Interaction, moves: { t: number; x: number; y: number }[], up: number, aspect: number) {
  const path: ZoomPathPoint[] = [];
  let far = false;
  let last = { t: press.t, x: press.x, y: press.y };
  for (const m of moves) {
    if (m.t <= press.t) continue;
    if (m.t > up) break;
    if (!inside(m.x, m.y)) continue;
    if (Math.hypot(m.x - press.x, (m.y - press.y) / aspect) > DRAG_DISTANCE) far = true;
    if (m.t - last.t >= 0.15 && Math.hypot(m.x - last.x, (m.y - last.y) / aspect) > 0.02) {
      last = { t: m.t, x: m.x, y: m.y };
      path.push(last);
    }
  }
  if (!far) return;
  press.path = path;
  press.tEnd = up;
  press.score += 0.2;
}

/** Typing events grouped into bursts, each one interaction at the text
 * cursor (or, when the app didn't expose one, the click that most likely
 * focused the field, else the pointer), following the cursor as it moves. */
function typingBursts(
  typing: { t: number; caret: { x: number; y: number } | null }[],
  clicks: Interaction[],
  moves: { t: number; x: number; y: number }[],
  cuts: number[]
): Interaction[] {
  const bursts: (typeof typing)[] = [];
  for (const k of typing) {
    const cur = bursts[bursts.length - 1];
    const prev = cur?.[cur.length - 1];
    if (prev && k.t - prev.t <= TYPING_GAP && !cutBetween(cuts, prev.t, k.t)) cur.push(k);
    else bursts.push([k]);
  }
  const out: Interaction[] = [];
  for (const b of bursts) {
    if (b.length < TYPING_MIN_EVENTS) continue;
    const t = b[0].t;
    const tEnd = b[b.length - 1].t;
    const carets = b.filter((k) => k.caret);
    let start: { x: number; y: number } | null = carets[0]?.caret ?? null;
    let placed = 1.4; // known text cursor
    if (!start) {
      const click = [...clicks].reverse().find((c) => c.kind === "click" && c.t <= t && t - c.t <= TYPING_CLICK_WINDOW);
      start = click ? { x: click.x, y: click.y } : null;
      placed = 1.1;
    }
    if (!start) {
      let p: { x: number; y: number } | null = null;
      for (const m of moves) {
        if (m.t > t) break;
        p = m;
      }
      start = p && inside(p.x, p.y) ? p : null;
      placed = 0.7;
    }
    if (!start) continue;
    const path: ZoomPathPoint[] = [];
    let last = start;
    for (const k of carets) {
      const c = k.caret!;
      if (k.t <= t || Math.hypot(c.x - last.x, c.y - last.y) < 0.01) continue;
      last = c;
      path.push({ t: k.t, x: c.x, y: c.y });
    }
    // Longer typing matters more; a known text cursor is the surest spot.
    const score = placed + Math.min(1, (tEnd - t) * 0.35);
    out.push({ t, tEnd, x: start.x, y: start.y, score, kind: "typing", path });
  }
  return out;
}

function cutBetween(cuts: number[], a: number, b: number) {
  return cuts.some((c) => c > a && c <= b);
}

function centroid(items: Interaction[]) {
  let x = 0;
  let y = 0;
  let w = 0;
  for (const it of items) {
    x += it.x * it.score;
    y += it.y * it.score;
    w += it.score;
  }
  return { x: x / w, y: y / w };
}

export function clusterInteractions(interactions: Interaction[], cuts: number[], aspect: number, s: FocusSettings): Cluster[] {
  const clusters: Cluster[] = [];
  const maxSpan = Math.max(0.5, s.maxDuration - s.lead - s.hold - s.easeIn - s.easeOut);
  let cur: Interaction[] = [];
  const flush = () => {
    if (cur.length) clusters.push({ items: cur, score: cur.reduce((n, i) => n + i.score, 0), markers: [] });
    cur = [];
  };
  for (const it of interactions) {
    const last = cur[cur.length - 1];
    if (last) {
      const c = centroid(cur);
      const far = Math.hypot(it.x - c.x, (it.y - c.y) / aspect) > s.clusterRadius;
      const late = it.t - last.tEnd > s.clusterGap;
      const long = it.t - cur[0].t > maxSpan;
      if (far || late || long || cutBetween(cuts, last.t, it.t)) flush();
    }
    cur.push(it);
  }
  flush();
  return clusters;
}

interface Candidate {
  start: number;
  end: number;
  x: number;
  y: number;
  zoom: number;
  path: ZoomPathPoint[];
  score: number;
  reason: string;
  /** Interaction points with their times, for re-framing after a merge. */
  points: ZoomPathPoint[];
  forced: boolean;
  long: boolean;
  /** Frames two areas the camera went back and forth between: kept
   * still (no follow path) when more is merged in. */
  wide?: boolean;
}

/** Every position of a cluster in time order: each interaction and the
 * points it moved through. */
function clusterPoints(items: Interaction[]): ZoomPathPoint[] {
  const pts: ZoomPathPoint[] = [];
  for (const it of items) pts.push({ t: it.t, x: it.x, y: it.y }, ...it.path);
  return pts.sort((a, b) => a.t - b.t);
}

/** Zoom that keeps points happening together (within TOGETHER) in view. */
function localZoom(pts: ZoomPathPoint[], aspect: number, s: FocusSettings) {
  let zoom = Math.min(s.zoom, s.maxZoom);
  for (let i = 0; i < pts.length; i++) {
    const near = pts.filter((p) => Math.abs(p.t - pts[i].t) <= TOGETHER);
    zoom = Math.min(zoom, focusBox(near, aspect, s).zoom);
  }
  return zoom;
}

/** Where the camera points over time at `zoom`: it starts on the first
 * point and only moves when a later one leaves the middle of the window
 * (no jitter for small moves); moves less than PAN apart collapse into the
 * later one. Centers are clamped like the camera clamps its window. */
function followPath(pts: ZoomPathPoint[], zoom: number, aspect: number) {
  const w = 1 / zoom;
  const clampC = (v: number) => Math.min(1 - w / 2, Math.max(w / 2, v));
  let cx = clampC(pts[0].x);
  let cy = clampC(pts[0].y);
  const start = { x: cx, y: cy };
  const path: ZoomPathPoint[] = [];
  for (const p of pts.slice(1)) {
    const out = Math.abs(p.x - cx) > DEAD_ZONE * w || Math.abs(p.y - cy) > DEAD_ZONE * w;
    if (!out) continue;
    cx = clampC(p.x);
    cy = clampC(p.y);
    const prev = path[path.length - 1];
    const point = { t: p.t, x: round3(cx), y: round3(cy) };
    if (prev && p.t - prev.t < 0.5) path[path.length - 1] = point;
    else if (!prev && p.t - pts[0].t < 0.5) {
      start.x = cx;
      start.y = cy;
    } else path.push(point);
  }
  void aspect;
  return { x: start.x, y: start.y, path };
}

/** Framing for a set of points: one box when they fit at (close to) the
 * preset's zoom, else - with follow on - the preset's zoom (or what the
 * simultaneous points allow) and a path. null when nothing is worth it. */
function frameFor(pts: ZoomPathPoint[], aspect: number, s: FocusSettings): { x: number; y: number; zoom: number; path: ZoomPathPoint[] } | null {
  const box = focusBox(pts, aspect, s);
  const wanted = Math.min(s.zoom, s.maxZoom);
  if (box.zoom >= wanted * 0.95 || !s.follow || pts.length < 2) {
    return box.zoom >= MIN_USEFUL_ZOOM ? { ...box, path: [] } : null;
  }
  const zoom = localZoom(pts, aspect, s);
  if (zoom < MIN_USEFUL_ZOOM || zoom <= box.zoom) return box.zoom >= MIN_USEFUL_ZOOM ? { ...box, path: [] } : null;
  return { ...followPath(pts, zoom, aspect), zoom };
}

/** Zoom that keeps all points plus padding in view, capped by the preset. */
function focusBox(points: { x: number; y: number }[], aspect: number, s: FocusSettings) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  // The window keeps the frame's aspect, so in frame fractions it needs
  // the larger of the two extents; padding is the same in pixels both ways.
  const need = Math.max(x1 - x0 + 2 * PAD, y1 - y0 + 2 * PAD * aspect);
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom: Math.min(s.zoom, s.maxZoom, 1 / need) };
}

function rangeFor(first: number, last: number, cuts: number[], duration: number, s: FocusSettings, long = false) {
  let start = first - s.lead - s.easeIn;
  let end = last + s.hold + s.easeOut;
  const max = long ? Math.max(s.maxDuration, TYPING_MAX_DURATION) : s.maxDuration;
  if (end - start < s.minDuration) end = start + s.minDuration;
  if (end - start > max) end = start + max;
  // Stay inside the stretch between pause cuts: the video jumps there.
  const before = Math.max(0, ...cuts.filter((c) => c <= first));
  const after = Math.min(duration, ...cuts.filter((c) => c > last));
  start = Math.max(start, before);
  end = Math.min(end, after);
  return { start, end };
}

export function suggestZooms(input: FocusInput, s: FocusSettings, ids: () => string): FocusResult {
  const { events, duration, aspect, sourceId } = input;
  const { interactions, moves, cuts, markers, clicks } = collectInteractions(validEvents(events, duration), aspect, s);
  const clusters = clusterInteractions(interactions, cuts, aspect, s);

  // Markers boost the cluster around them, or get their own focus.
  const pointerAt = (t: number) => {
    let p: { x: number; y: number } | null = null;
    for (const m of moves) {
      if (m.t > t) break;
      p = m;
    }
    return p;
  };
  const orphanMarkers: { t: number; label: string }[] = [];
  if (s.useMarkers) {
    for (const m of markers) {
      const c = clusters.find((cl) => m.t >= cl.items[0].t - 2 && m.t <= cl.items[cl.items.length - 1].t + 2);
      if (c) c.markers.push(m.label);
      else orphanMarkers.push(m);
    }
  }

  let skippedSmall = 0;
  const cands: Candidate[] = [];
  for (const c of clusters) {
    const forced = c.markers.length > 0;
    if (c.score < s.minScore && !forced) {
      skippedSmall++;
      continue;
    }
    const points = clusterPoints(c.items);
    const frame = frameFor(points, aspect, s);
    if (!frame) {
      skippedSmall++; // spread over most of the screen: nothing to focus on
      continue;
    }
    const long = c.items.some((i) => i.kind === "typing");
    const lastT = Math.max(...c.items.map((i) => i.tEnd));
    const { start, end } = rangeFor(c.items[0].t, lastT, cuts, duration, s, long);
    if (end - start < 2 * 0.15 + 0.2) continue;
    const clicksIn = c.items.filter((i) => i.kind === "click").length;
    const dragged = c.items.some((i) => i.kind === "click" && i.path.length > 0);
    const reason = forced
      ? c.markers.join(", ")
      : long
        ? clicksIn > 0
          ? `Typing + ${clicksIn} click${clicksIn === 1 ? "" : "s"}`
          : "Typing"
        : clicksIn > 0
          ? `${dragged ? "Drag, " : ""}${clicksIn} click${clicksIn === 1 ? "" : "s"}`
          : c.items[0].kind === "scroll"
            ? "Scrolling"
            : "Shortcuts";
    cands.push({ start, end, ...frame, path: frame.path.filter((p) => p.t > start && p.t < end), score: c.score + (forced ? 10 : 0), reason, points, forced, long });
  }
  for (const m of orphanMarkers) {
    const p = pointerAt(m.t);
    if (!p || !inside(p.x, p.y)) continue;
    const box = focusBox([p], aspect, s);
    const { start, end } = rangeFor(m.t, m.t, cuts, duration, s);
    cands.push({ start, end, x: box.x, y: box.y, zoom: Math.min(box.zoom, s.zoom), path: [], score: 10, reason: m.label, points: [{ t: m.t, x: p.x, y: p.y }], forced: true, long: false });
  }
  cands.sort((a, b) => a.start - b.start);

  // Pacing: merge or chain neighbours that come too soon.
  const isNear = (a: Candidate, b: Candidate) => Math.hypot(a.x - b.x, (a.y - b.y) / aspect) < s.clusterRadius * 1.5;
  const lengthLimit = (...cs: Candidate[]) => (cs.some((x) => x.long) ? Math.max(s.maxDuration, TYPING_MAX_DURATION) : s.maxDuration);
  const paced: Candidate[] = [];
  let skippedBack = 0;
  for (const c of cands) {
    const prev = paced[paced.length - 1];
    const before = paced[paced.length - 2];
    // Back and forth: A, then B right after, then A again soon. Panning
    // there and back reverses the camera every second or two, which is
    // hard to follow; one still zoom wide enough for both areas shows the
    // same clicks calmly. If no useful zoom fits both, the return trip
    // gets no zoom of its own (that area was just shown).
    if (
      prev &&
      before &&
      c.start < prev.end + s.minGap &&
      prev.start <= before.end + CHAIN_GAP &&
      isNear(c, before) &&
      !isNear(c, prev) &&
      !cutBetween(cuts, before.end, c.start)
    ) {
      const end = Math.max(prev.end, c.end);
      const points = [...before.points, ...prev.points, ...c.points].sort((a, b) => a.t - b.t);
      const frame = end - before.start <= lengthLimit(before, prev, c) ? frameFor(points, aspect, { ...s, follow: false }) : null;
      if (frame) {
        Object.assign(before, {
          end,
          x: frame.x,
          y: frame.y,
          zoom: frame.zoom,
          path: [],
          points,
          wide: true,
          long: before.long || prev.long || c.long,
          score: before.score + prev.score + c.score,
          forced: before.forced || prev.forced || c.forced,
          reason: `${before.reason} + ${prev.reason}, back and forth`,
        });
        paced.pop();
        continue;
      }
      if (!c.forced && c.start - before.end < 2 * s.minGap) {
        skippedBack++;
        continue;
      }
    }
    if (prev && c.start < prev.end + s.minGap) {
      const near = isNear(c, prev);
      const mergedLength = Math.max(prev.end, c.end) - prev.start;
      const maxLength = lengthLimit(prev, c);
      if (near && mergedLength <= maxLength && !cutBetween(cuts, prev.end, c.start)) {
        const points = [...prev.points, ...c.points].sort((a, b) => a.t - b.t);
        const frame = frameFor(points, aspect, prev.wide ? { ...s, follow: false } : s);
        if (frame) {
          const end = Math.max(prev.end, c.end);
          Object.assign(prev, {
            end,
            x: frame.x,
            y: frame.y,
            zoom: frame.zoom,
            path: frame.path.filter((p) => p.t > prev.start && p.t < end),
            points,
            long: prev.long || c.long,
            score: prev.score + c.score,
            forced: prev.forced || c.forced,
            reason: prev.reason === c.reason ? prev.reason : `${prev.reason} + ${c.reason}`,
          });
          continue;
        }
      }
      // A back-and-forth zoom that reached its length limit: the next one
      // keeps its framing when the action still fits, so the camera stays
      // put across the seam instead of panning between the two areas.
      if (prev.wide && near && !cutBetween(cuts, prev.end, c.start)) {
        const half = 1 / (2 * prev.zoom);
        const fits = c.points.every((q) => Math.abs(q.x - prev.x) <= half - PAD && Math.abs(q.y - prev.y) <= half - PAD * aspect);
        if (fits) Object.assign(c, { x: prev.x, y: prev.y, zoom: prev.zoom, path: [], wide: true, reason: prev.reason });
      }
      // Different spot soon after: pan straight there (chained), no
      // zoom-out in between. When they overlap, the previous zoom ends
      // once its own action is done (the pan away starts easeOut before
      // its end) rather than this one starting late: starting late left
      // the camera on the previous spot when this click happened.
      if (c.start < prev.end) {
        const prevLast = prev.points.length ? prev.points[prev.points.length - 1].t : prev.start;
        prev.end = Math.max(prev.start + 0.5, Math.min(prev.end, Math.max(prevLast + 0.3 + s.easeOut, c.start)));
        c.start = prev.end;
      } else if (c.start - prev.end > CHAIN_GAP * 0.5) prev.end = Math.max(prev.start + 0.5, c.start - CHAIN_GAP * 0.5);
      if (c.end - c.start < 0.6) {
        if (c.score > prev.score && !prev.forced) paced[paced.length - 1] = c;
        continue;
      }
    }
    paced.push(c);
  }

  // Thin the busiest minutes, keeping the most significant zooms.
  let skippedPacing = 0;
  const keep = new Set(paced);
  const byScore = [...paced].sort((a, b) => a.score - b.score);
  for (const c of byScore) {
    if (c.forced) continue;
    const mid = (c.start + c.end) / 2;
    const inWindow = [...keep].filter((o) => Math.abs((o.start + o.end) / 2 - mid) < 30).length;
    if (inWindow > s.maxPerMinute) {
      keep.delete(c);
      skippedPacing++;
    }
  }

  const zooms: CameraZoom[] = paced
    .filter((c) => keep.has(c))
    .map((c) => ({
      id: ids(),
      sourceId,
      start: round3(c.start),
      end: round3(c.end),
      zoom: Math.round(c.zoom * 100) / 100,
      x: round3(c.x),
      y: round3(c.y),
      easeIn: s.easeIn,
      easeOut: s.easeOut,
      ease: s.ease,
      enabled: true,
      auto: true,
      reason: c.reason,
      ...(c.path.length ? { path: c.path.map((p) => ({ t: round3(p.t), x: round3(p.x), y: round3(p.y) })) } : {}),
    }));
  return { zooms, stats: { clicks, clusters: clusters.length, suggested: zooms.length, skippedSmall, skippedPacing: skippedPacing + skippedBack } };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

export interface AnalyzeProgress {
  stage: "reading" | "analyzing" | "done";
  value: number; // 0..1
}

/** suggestZooms off the critical path: yields to the UI between stages
 * and stops with an AbortError when `signal` aborts. The work itself is
 * linear in the number of events (100k events ~ tens of ms). */
export async function analyzeFocus(
  input: FocusInput,
  s: FocusSettings,
  ids: () => string,
  opts: { signal?: AbortSignal; onProgress?: (p: AnalyzeProgress) => void } = {}
): Promise<FocusResult> {
  const check = () => {
    if (opts.signal?.aborted) throw new DOMException("Analysis cancelled", "AbortError");
  };
  const breathe = () => new Promise<void>((r) => setTimeout(r, 0));
  opts.onProgress?.({ stage: "reading", value: 0 });
  await breathe();
  check();
  // Validate in chunks so a huge event list never blocks for long.
  const events: InteractionEvent[] = [];
  const CHUNK = 20_000;
  for (let i = 0; i < input.events.length; i += CHUNK) {
    for (const e of input.events.slice(i, i + CHUNK)) if (Number.isFinite(e.t)) events.push(e);
    opts.onProgress?.({ stage: "reading", value: Math.min(1, (i + CHUNK) / Math.max(1, input.events.length)) });
    await breathe();
    check();
  }
  opts.onProgress?.({ stage: "analyzing", value: 0 });
  await breathe();
  check();
  const result = suggestZooms({ ...input, events }, s, ids);
  check();
  opts.onProgress?.({ stage: "done", value: 1 });
  return result;
}
