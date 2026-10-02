import type { AnchorPoint, Contour, StrokeStyle } from "../../types/geometry";
import type { Vec2 } from "../../types/viewport";
import { createId } from "../../utils/id";
import { reverseContour as reverseInPlace, splitCubic } from "./path";

/**
 * Pure contour-topology operations shared by node editing: cutting a contour's
 * point sequence into pieces (split-on-delete and cut) and fusing two pieces
 * (merge endpoints). Framework-free and unit-tested — the document store and the
 * select tool delegate the tricky sequence math here so it lives in one place.
 *
 * Handles are absolute coords (Invariant 1), so points move as plain structural
 * copies. Reversing a point swaps its in/out handles; splitting a stroked path
 * butt-caps the newly created ends (see extractContours).
 *
 * Every piece is built by SPREADING its source (`{ ...contour, id, points }`) and then
 * overriding what changes — never by listing the fields to keep. A field-by-field copy
 * compiles clean when a new optional field is added and silently drops it; that is how
 * cut / delete-split / scissors / merge once lost paths' colour, corners and fill.
 */

/** A fresh structural copy of an anchor (new object graph, SAME id, every field kept). */
function clonePoint(p: AnchorPoint): AnchorPoint {
  const copy: AnchorPoint = { ...p };
  if (p.handleIn) copy.handleIn = { ...p.handleIn };
  if (p.handleOut) copy.handleOut = { ...p.handleOut };
  return copy;
}

/** A new piece of `src`: every one of `src`'s fields (paint, fill, corners, baked, and
 *  any added later) with a fresh id, the given points/closedness, and its own stroke copy. */
function pieceOf(src: Contour, points: AnchorPoint[], closed: boolean): Contour {
  const piece: Contour = { ...src, id: createId("ct"), closed, points };
  if (src.stroke) piece.stroke = structuredClone(src.stroke);
  return piece;
}

/** The per-TERMINAL stroke fields (`startCap`, `startSerif`, … / `endCap`, …). */
const END_FIELDS = ["Cap", "Serif", "Drop", "Rect", "RoundAtNode"] as const;

/** Copy one terminal's cap settings from `src` (its `from` end) onto `out`'s `to` end. */
function copyEnd(out: StrokeStyle, src: StrokeStyle, from: "start" | "end", to: "start" | "end"): void {
  const o = out as unknown as Record<string, unknown>;
  const s = src as unknown as Record<string, unknown>;
  for (const f of END_FIELDS) {
    const v = s[`${from}${f}`];
    if (v === undefined) delete o[`${to}${f}`];
    else o[`${to}${f}`] = structuredClone(v);
  }
}

const COINCIDENT_EPS = 1e-6;

/** Do two anchors sit on the same spot? (Merge Nodes fuses such ends into one node.) */
export function coincident(a: Vec2, b: Vec2): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= COINCIDENT_EPS;
}

/**
 * Fuse a DROPPED endpoint into a KEPT one. The kept node keeps its position and its
 * inner handle (`keptInner`, which shapes its own path's last curve); its outer side
 * takes the dropped node's inner handle — the one that shaped the dropped node's curve
 * onward — so that curve keeps its shape. The handle is carried as an OFFSET: the dropped
 * node may sit elsewhere (drag-to-merge hands in the pre-drag contour). The node stays
 * `smooth` only when both were smooth and the two handles stay collinear; otherwise it
 * becomes a corner (with handles = a cusp).
 */
function fuseNodes(
  kept: AnchorPoint,
  keptInner: "handleIn" | "handleOut",
  dropped: AnchorPoint,
  droppedInner: "handleIn" | "handleOut",
): AnchorPoint {
  const keptOuter = keptInner === "handleIn" ? "handleOut" : "handleIn";
  const out: AnchorPoint = { ...kept };
  const h = dropped[droppedInner];
  if (h) out[keptOuter] = { x: kept.x + (h.x - dropped.x), y: kept.y + (h.y - dropped.y) };
  else delete out[keptOuter];
  const a = out[keptInner];
  const b = out[keptOuter];
  let smooth = false;
  if (kept.type === "smooth" && dropped.type === "smooth" && a && b) {
    const ax = a.x - kept.x;
    const ay = a.y - kept.y;
    const bx = b.x - kept.x;
    const by = b.y - kept.y;
    const len = Math.hypot(ax, ay) * Math.hypot(bx, by);
    smooth = len > 0 && Math.abs(ax * by - ay * bx) <= 1e-3 * len && ax * bx + ay * by < 0;
  }
  out.type = smooth ? "smooth" : "corner";
  return out;
}

/**
 * The contiguous runs of KEPT points, each as its own contour. A closed source
 * is treated cyclically (a run may wrap the seam); an open source is scanned
 * linearly. Runs shorter than 2 points are dropped. A result stays `closed` only
 * when the whole ring survives as one run; any cut end is open.
 *
 * Stroke handling: a fragment keeps the original `startCap`/`endCap` only at an
 * end that IS the original terminal (open source); every newly created end —
 * and every end of a fragment from a closed source — becomes `"butt"`. The
 * stroke is deep-cloned so fragments are independent.
 */
export function extractContours(
  contour: Contour,
  keepIds: Set<string>,
): Contour[] {
  const pts = contour.points;
  const n = pts.length;
  if (n === 0) return [];

  const kept = pts.map((p) => keepIds.has(p.id));
  const keptCount = kept.filter(Boolean).length;
  if (keptCount === 0) return [];

  // Whole closed ring survives → preserve it as one closed contour.
  if (contour.closed && keptCount === n) {
    return [makeFragment(contour, pts.map((_, i) => i), n, true)];
  }

  // Runs as arrays of original indices.
  const runs: number[][] = [];
  if (contour.closed) {
    // Rotate so we start just after a dropped point, so no run wraps the seam.
    const firstDropped = kept.indexOf(false);
    const order: number[] = [];
    for (let k = 0; k < n; k += 1) order.push((firstDropped + k) % n);
    let run: number[] = [];
    for (const i of order) {
      if (kept[i]) run.push(i);
      else if (run.length) {
        runs.push(run);
        run = [];
      }
    }
    if (run.length) runs.push(run);
  } else {
    let run: number[] = [];
    for (let i = 0; i < n; i += 1) {
      if (kept[i]) run.push(i);
      else if (run.length) {
        runs.push(run);
        run = [];
      }
    }
    if (run.length) runs.push(run);
  }

  return runs
    .filter((r) => r.length >= 2)
    .map((r) => makeFragment(contour, r, n, false));
}

/** Build one open/closed fragment from a run of original indices. */
function makeFragment(
  contour: Contour,
  indices: number[],
  total: number,
  closed: boolean,
): Contour {
  const points = indices.map((i) => clonePoint(contour.points[i]!));
  const fragment = pieceOf(contour, points, closed);
  if (closed) return fragment;

  // An end is NEW unless it is an original terminal of an open source (a closed source
  // has no terminals, so both its fragment ends are new).
  const openSource = !contour.closed;
  const startIsNew = !(openSource && indices[0] === 0);
  const endIsNew = !(openSource && indices[indices.length - 1] === total - 1);
  // A new end's outward handle pointed at the removed neighbour. Left in place it would
  // be read as that end's cap-angle handle and re-cut the fresh butt end — drop it, as
  // the scissors/knife cut (splitContourAtPoints) already does.
  if (startIsNew) delete points[0]!.handleIn;
  if (endIsNew) delete points[points.length - 1]!.handleOut;
  if (fragment.stroke) {
    // Keep an original terminal's cap only where this run still touches it.
    if (startIsNew) fragment.stroke.startCap = "butt";
    if (endIsNew) fragment.stroke.endCap = "butt";
  }
  return fragment;
}

/** A copy (new id) with the point order reversed and each anchor's in/out handles swapped. */
export function reverseContour(contour: Contour): Contour {
  return { ...reverseInPlace(contour), id: createId("ct") };
}

/**
 * Fuse two open contours at the chosen ends into one open contour. Each is oriented so
 * the join runs a's tail → b's head. With `fuse` (default) b's chosen endpoint is merged
 * INTO a's (`fuseNodes` — b's first curve keeps its shape); without it the two ends are
 * connected by a new segment (both nodes kept — Illustrator's Join of ends that are apart).
 *
 * The result is a piece of `a` (its paint, fill, corners, stroke…). Each terminal keeps
 * the cap of the geometric end it IS: the joined start is a's far end (a's own cap there,
 * even when a had to be reversed), the joined end is b's far end (b's cap, when b has a
 * stroke). (Closing a path's own two ends is `closeEnds`.)
 */
export function joinContours(
  a: Contour,
  b: Contour,
  aAtStart: boolean,
  bAtStart: boolean,
  fuse = true,
): Contour {
  const aPts = (aAtStart ? reverseInPlace(a) : a).points.map(clonePoint); // chosen end last
  const bPts = (bAtStart ? b : reverseInPlace(b)).points.map(clonePoint); // chosen end first
  const points = fuse
    ? [...aPts.slice(0, -1), fuseNodes(aPts[aPts.length - 1]!, "handleIn", bPts[0]!, "handleOut"), ...bPts.slice(1)]
    : [...aPts, ...bPts];
  const joined = pieceOf(a, points, false);
  if (joined.stroke && a.stroke) {
    copyEnd(joined.stroke, a.stroke, aAtStart ? "end" : "start", "start");
    if (b.stroke) copyEnd(joined.stroke, b.stroke, bAtStart ? "end" : "start", "end");
    else copyEnd(joined.stroke, a.stroke, aAtStart ? "start" : "end", "end");
  }
  return joined;
}

/**
 * Close an open contour by joining its own two ends. With `dropAt` the end on that side
 * is merged INTO the other (`fuseNodes`, so its curve keeps its shape and no zero-length
 * closing segment is left at the seam); without it a closing segment is added.
 */
export function closeEnds(contour: Contour, dropAt?: "start" | "end"): Contour {
  const pts = contour.points.map(clonePoint);
  if (dropAt && pts.length >= 3) {
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    const points =
      dropAt === "end"
        ? [fuseNodes(first, "handleOut", last, "handleIn"), ...pts.slice(1, -1)]
        : [...pts.slice(1, -1), fuseNodes(last, "handleIn", first, "handleOut")];
    return { ...contour, closed: true, points };
  }
  return { ...contour, closed: true, points: pts };
}

const HANDLE_EPS = 1e-6;

function dropHandle(p: AnchorPoint, key: "handleIn" | "handleOut"): void {
  if (key === "handleIn") delete p.handleIn;
  else delete p.handleOut;
}

/** Assign a handle, dropping it when it collapses onto the anchor (a corner). */
function setHandle(p: AnchorPoint, key: "handleIn" | "handleOut", v: Vec2): void {
  if (Math.hypot(v.x - p.x, v.y - p.y) <= HANDLE_EPS) {
    dropHandle(p, key);
    return;
  }
  if (key === "handleIn") p.handleIn = { x: v.x, y: v.y };
  else p.handleOut = { x: v.x, y: v.y };
}

/** One open fragment from `points`, carrying every field of `src`; a `"butt"` end
 *  overrides that cap (a freshly cut terminal), a `"keep"` end keeps the original. */
function makeCut(
  src: Contour,
  points: AnchorPoint[],
  startCap: "keep" | "butt",
  endCap: "keep" | "butt",
): Contour {
  const frag = pieceOf(src, points, false);
  if (frag.stroke) {
    if (startCap === "butt") frag.stroke.startCap = "butt";
    if (endCap === "butt") frag.stroke.endCap = "butt";
  }
  return frag;
}

/** Subdivide the cubic segment a→b at sorted interior `ts` (each in (0,1)). MUTATES
 *  `a.handleOut`; returns the inserted mid anchors (with handles) and the handleIn to
 *  apply to `b`. A straight segment (no handles) inserts plain corner mids. */
function subdivideSegment(
  a: AnchorPoint,
  b: AnchorPoint,
  ts: number[],
): { mids: AnchorPoint[]; bHandleIn: Vec2 | null } {
  const p0: Vec2 = { x: a.x, y: a.y };
  const p3: Vec2 = { x: b.x, y: b.y };
  if (!a.handleOut && !b.handleIn) {
    return {
      mids: ts.map((t) => ({
        id: createId("pt"),
        type: "corner" as const,
        x: p0.x + (p3.x - p0.x) * t,
        y: p0.y + (p3.y - p0.y) * t,
      })),
      bHandleIn: null,
    };
  }
  let curr: [Vec2, Vec2, Vec2, Vec2] = [p0, a.handleOut ?? p0, b.handleIn ?? p3, p3];
  let prevT = 0;
  const mids: AnchorPoint[] = [];
  for (let i = 0; i < ts.length; i += 1) {
    const localT = (ts[i]! - prevT) / (1 - prevT);
    const { left, right } = splitCubic(curr[0], curr[1], curr[2], curr[3], localT);
    if (i === 0) setHandle(a, "handleOut", left[1]);
    else setHandle(mids[i - 1]!, "handleOut", left[1]);
    const mid: AnchorPoint = { id: createId("pt"), type: "smooth", x: left[3].x, y: left[3].y };
    setHandle(mid, "handleIn", left[2]);
    mids.push(mid);
    curr = right;
    prevT = ts[i]!;
  }
  setHandle(mids[mids.length - 1]!, "handleOut", curr[1]);
  return { mids, bHandleIn: curr[2] };
}

/**
 * Cut a contour at MANY points — the knife/eraser primitive (`splitContourAt` is the
 * single-cut case). Each cut is `{ segIndex, t }` (the segment leaving point
 * `segIndex`); a near-node `t` snaps to the node, else the cubic is subdivided
 * (`splitCubic`) so the cut lands exactly on the curve. An OPEN source breaks into the
 * runs between consecutive cuts (plus the two original ends); a CLOSED source breaks
 * into the arcs between cuts (one cut → one opened loop). Every cut point is duplicated
 * as a `"butt"`-capped terminal; original terminals keep their cap. `n<2` / no effective
 * cut → `[contour]`.
 */
export function splitContourAtPoints(
  contour: Contour,
  cuts: { segIndex: number; t: number }[],
): Contour[] {
  const n = contour.points.length;
  if (n < 2 || cuts.length === 0) return [contour];
  const EPS = 1e-6;
  const segCount = contour.closed ? n : n - 1;

  const nodeCuts = new Set<number>();
  const segCuts = new Map<number, number[]>();
  for (const { segIndex, t } of cuts) {
    if (segIndex < 0 || segIndex >= segCount) continue;
    if (t <= EPS) nodeCuts.add(segIndex % n);
    else if (t >= 1 - EPS) nodeCuts.add((segIndex + 1) % n);
    else {
      const arr = segCuts.get(segIndex);
      if (arr) arr.push(t);
      else segCuts.set(segIndex, [t]);
    }
  }
  if (nodeCuts.size === 0 && segCuts.size === 0) return [contour];

  // Augmented point list with cut mids inserted; `isCut[i]` flags cut nodes.
  const work: AnchorPoint[] = [];
  const isCut: boolean[] = [];
  let pendingIn: Vec2 | null = null;
  for (let i = 0; i < n; i += 1) {
    const node = clonePoint(contour.points[i]!);
    if (pendingIn) {
      setHandle(node, "handleIn", pendingIn);
      pendingIn = null;
    }
    work.push(node);
    isCut.push(nodeCuts.has(i));
    const ts = segCuts.get(i);
    if (ts) {
      ts.sort((x, y) => x - y);
      const { mids, bHandleIn } = subdivideSegment(node, contour.points[(i + 1) % n]!, ts);
      for (const mid of mids) {
        work.push(mid);
        isCut.push(true);
      }
      pendingIn = bHandleIn;
    }
  }
  if (pendingIn && contour.closed) setHandle(work[0]!, "handleIn", pendingIn);

  const m = work.length;
  const cutPositions: number[] = [];
  for (let i = 0; i < m; i += 1) if (isCut[i]) cutPositions.push(i);

  if (!contour.closed) {
    const interior = cutPositions.filter((i) => i > 0 && i < m - 1);
    if (interior.length === 0) return [contour];
    const bounds = [0, ...interior, m - 1];
    const pieces: Contour[] = [];
    for (let k = 0; k < bounds.length - 1; k += 1) {
      const lo = bounds[k]!;
      const hi = bounds[k + 1]!;
      const pts = work.slice(lo, hi + 1).map(clonePoint);
      const startCap: "keep" | "butt" = lo === 0 ? "keep" : "butt";
      const endCap: "keep" | "butt" = hi === m - 1 ? "keep" : "butt";
      if (startCap === "butt") {
        dropHandle(pts[0]!, "handleIn");
        pts[0]!.id = createId("pt"); // unique id for the duplicated cut point
      }
      if (endCap === "butt") dropHandle(pts[pts.length - 1]!, "handleOut");
      pieces.push(makeCut(contour, pts, startCap, endCap));
    }
    return pieces;
  }

  // Closed: the arcs between consecutive cuts (wrapping); one cut → one opened loop.
  const pieces: Contour[] = [];
  for (let k = 0; k < cutPositions.length; k += 1) {
    const lo = cutPositions[k]!;
    const hi = cutPositions[(k + 1) % cutPositions.length]!;
    const order: number[] = [lo];
    let idx = lo;
    do {
      idx = (idx + 1) % m;
      order.push(idx);
    } while (idx !== hi);
    const pts = order.map((i) => clonePoint(work[i]!));
    dropHandle(pts[0]!, "handleIn");
    dropHandle(pts[pts.length - 1]!, "handleOut");
    pts[pts.length - 1]!.id = createId("pt"); // unique id for the duplicated cut point
    pieces.push(makeCut(contour, pts, "butt", "butt"));
  }
  return pieces;
}

/** Single-cut convenience (the scissors case): cut a contour at one point. */
export function splitContourAt(contour: Contour, segIndex: number, t: number): Contour[] {
  return splitContourAtPoints(contour, [{ segIndex, t }]);
}
