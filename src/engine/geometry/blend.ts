import type { AnchorPoint, Contour } from "../../types/geometry";
import type { Vec2 } from "../../types/viewport";
import { createId } from "../../utils/id";
import { flattenContour, ringSignedArea } from "./polygon";

/**
 * Pure A→B shape interpolation — the engine behind the "Blend" layer pair (the 5th
 * Pathfinder op, an Illustrator-style echo). Returns a sequence of `steps + 2`
 * in-between shapes (endpoints included, so A and B still render). Each step carries
 * the source contour's stroke/paint/corner so the caller renders it like a normal
 * layer (strokes expand, colour survives).
 *
 * Two paths:
 *  - MATCHING structure (same contour + point counts) → exact per-anchor interpolation
 *    that preserves bezier handles (crisp curves) — the common "B is a copy of A" case.
 *  - DIFFERENT shapes → each matched contour pair is arc-length **resampled** to a common
 *    point count and cyclically **aligned** (so the morph doesn't twist), then lerped as
 *    polylines (handles dropped — fine for transient echo steps). Different CONTOUR counts
 *    pair greedily by proximity, with unmatched contours collapsing to their centroid.
 * Returns `null` only when a side is empty. DOM-free and deterministic.
 */

/** Hard cap on interpolation steps (perf guard for the caller). */
export const MAX_BLEND_STEPS = 64;
/** Resample point-count bounds (per contour pair) for the different-shapes morph. */
const MIN_SAMPLES = 8;
const MAX_SAMPLES = 256;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Lerp a point, treating a missing handle as the anchor itself (zero-length). */
function lerpHandle(
  aPt: Vec2,
  aH: Vec2 | undefined,
  bPt: Vec2,
  bH: Vec2 | undefined,
  t: number,
): Vec2 | undefined {
  // No handle on EITHER end → stays a corner (omit it, so straight stays straight).
  if (!aH && !bH) return undefined;
  const a = aH ?? aPt;
  const b = bH ?? bPt;
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

/** True when A and B can be interpolated point-for-point (same contour + point counts
 *  and matching closed flags). */
function sameTopology(a: Contour[], b: Contour[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]!.closed !== b[i]!.closed) return false;
    if (a[i]!.points.length !== b[i]!.points.length) return false;
  }
  return true;
}

/** Carry a contour's style onto an interpolated step so each step renders like its source
 *  layer (strokes expand, corners apply, colour survives). `cb` is the t=1 contour
 *  (operand **A** / the upper layer in the blend call). **Colour always comes from A**
 *  (`cb.paint`) so the whole echo reads as one colour regardless of B's paint. Stroke
 *  style/corner come from whichever side has them, and stroke WIDTH morphs A↔B. */
function carryStyle(out: Contour, ca: Contour, cb: Contour, t: number): Contour {
  const stroke = ca.stroke ?? cb.stroke;
  if (stroke) {
    out.stroke =
      ca.stroke && cb.stroke
        ? { ...stroke, width: lerp(ca.stroke.width, cb.stroke.width, t) }
        : stroke;
  }
  if (cb.paint) out.paint = cb.paint; // operand A's colour
  const corner = ca.corner ?? cb.corner;
  if (corner) out.corner = corner;
  return out;
}

/** One interpolated contour set at parameter `t` (0 = A, 1 = B). Fresh ids throughout. */
function blendAt(a: Contour[], b: Contour[], t: number): Contour[] {
  return a.map((ca, i) => {
    const cb = b[i]!;
    const points: AnchorPoint[] = ca.points.map((pa, j) => {
      const pb = cb.points[j]!;
      const x = lerp(pa.x, pb.x, t);
      const y = lerp(pa.y, pb.y, t);
      const out: AnchorPoint = { id: createId("bl"), type: pa.type, x, y };
      const hIn = lerpHandle(pa, pa.handleIn, pb, pb.handleIn, t);
      const hOut = lerpHandle(pa, pa.handleOut, pb, pb.handleOut, t);
      if (hIn) out.handleIn = hIn;
      if (hOut) out.handleOut = hOut;
      return out;
    });
    return carryStyle({ id: createId("blc"), closed: ca.closed, points }, ca, cb, t);
  });
}

const clampInt = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, Math.round(v)));

/** Resample a flattened polyline to exactly `K` arc-length-even points. Closed rings
 *  sample `K` points around the loop (no duplicate at the seam); open paths sample `K`
 *  points from start to end inclusive. */
function resamplePolyline(poly: Vec2[], closed: boolean, K: number): Vec2[] {
  const n = poly.length;
  if (n === 0) return [];
  if (n === 1) return Array.from({ length: K }, () => ({ ...poly[0]! }));
  const segs = closed ? n : n - 1;
  const cum: number[] = [0];
  for (let i = 0; i < segs; i += 1) {
    const a = poly[i]!;
    const c = poly[(i + 1) % n]!;
    cum.push(cum[i]! + Math.hypot(c.x - a.x, c.y - a.y));
  }
  const total = cum[segs]!;
  if (total === 0) return Array.from({ length: K }, () => ({ ...poly[0]! }));
  const out: Vec2[] = [];
  for (let k = 0; k < K; k += 1) {
    const target = (closed ? k / K : k / (K - 1)) * total;
    let i = 0;
    while (i < segs - 1 && cum[i + 1]! < target) i += 1;
    const segLen = cum[i + 1]! - cum[i]!;
    const local = segLen > 0 ? (target - cum[i]!) / segLen : 0;
    const a = poly[i]!;
    const c = poly[(i + 1) % n]!;
    out.push({ x: a.x + (c.x - a.x) * local, y: a.y + (c.y - a.y) * local });
  }
  return out;
}

const sqDist = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

/** Rotate `b`'s K samples to the cyclic offset that minimises Σ squared distance to `a`
 *  — the step that stops a closed-ring morph from twisting. O(K²), K capped. */
function alignCyclic(a: Vec2[], b: Vec2[]): Vec2[] {
  const K = a.length;
  let best = 0;
  let bestCost = Infinity;
  for (let o = 0; o < K; o += 1) {
    let cost = 0;
    for (let i = 0; i < K && cost < bestCost; i += 1) cost += sqDist(a[i]!, b[(i + o) % K]!);
    if (cost < bestCost) {
      bestCost = cost;
      best = o;
    }
  }
  return a.map((_, i) => b[(i + best) % K]!);
}

const totalSqDist = (a: Vec2[], b: Vec2[]): number =>
  a.reduce((s, p, i) => s + sqDist(p, b[i]!), 0);

/** Resample + orient + align two contours to K matched points (a closed pair is winding-
 *  matched then cyclically aligned; an open pair keeps the closer of the two directions). */
function matchPoints(ca: Contour, cb: Contour): { a: Vec2[]; b: Vec2[] } {
  const fa = flattenContour(ca);
  const fb = flattenContour(cb);
  const K = clampInt(Math.max(fa.length, fb.length), MIN_SAMPLES, MAX_SAMPLES);
  const closed = ca.closed && cb.closed;
  const a = resamplePolyline(fa, ca.closed, K);
  let b = resamplePolyline(fb, cb.closed, K);
  if (closed) {
    const sa = ringSignedArea(a);
    const sb = ringSignedArea(b);
    if (sb !== 0 && Math.sign(sa) !== Math.sign(sb)) b = b.slice().reverse();
    b = alignCyclic(a, b);
  } else {
    const rev = b.slice().reverse();
    if (totalSqDist(a, rev) < totalSqDist(a, b)) b = rev;
  }
  return { a, b };
}

/** One output contour's matched K-point arrays (A-side and B-side) plus the source
 *  contours its style/closed-flag come from. */
interface MatchedPair {
  ca: Contour;
  cb: Contour;
  a: Vec2[];
  b: Vec2[];
}

/** Lerp every matched pair across `n + 2` steps → polyline contour sets (carrying style). */
function stepsFromMatched(matched: MatchedPair[], n: number): Contour[][] {
  const out: Contour[][] = [];
  for (let k = 0; k <= n + 1; k += 1) {
    const t = k / (n + 1);
    out.push(
      matched.map(({ ca, cb, a: aPts, b: bPts }) => {
        const points: AnchorPoint[] = aPts.map((pa, i) => ({
          id: createId("bl"),
          type: "corner" as const,
          x: lerp(pa.x, bPts[i]!.x, t),
          y: lerp(pa.y, bPts[i]!.y, t),
        }));
        return carryStyle({ id: createId("blc"), closed: ca.closed, points }, ca, cb, t);
      }),
    );
  }
  return out;
}

/** Average of a contour's anchor points (its collapse target). */
function centroid(c: Contour): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of c.points) {
    x += p.x;
    y += p.y;
  }
  const k = c.points.length || 1;
  return { x: x / k, y: y / k };
}

/** Blend two contour LISTS of EQUAL length but differing point structure: resample each
 *  matched pair (by index) and lerp as polylines. */
function blendResampled(a: Contour[], b: Contour[], n: number): Contour[][] {
  return stepsFromMatched(
    a.map((ca, i) => ({ ca, cb: b[i]!, ...matchPoints(ca, b[i]!) })),
    n,
  );
}

/** Blend two contour lists of DIFFERENT length: greedily pair contours by centroid
 *  proximity; each unmatched contour grows from / shrinks to its own centroid (appears or
 *  disappears across the morph) — Illustrator-ish. */
function blendDifferentCounts(a: Contour[], b: Contour[], n: number): Contour[][] {
  const aSmaller = a.length <= b.length;
  const small = aSmaller ? a : b;
  const large = aSmaller ? b : a;
  const usedLarge = new Set<number>();
  const matched: MatchedPair[] = [];

  for (const cs of small) {
    const cS = centroid(cs);
    let best = -1;
    let bestD = Infinity;
    large.forEach((cl, j) => {
      if (usedLarge.has(j)) return;
      const d = sqDist(cS, centroid(cl));
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    });
    usedLarge.add(best);
    const cl = large[best]!;
    const ca = aSmaller ? cs : cl;
    const cb = aSmaller ? cl : cs;
    matched.push({ ca, cb, ...matchPoints(ca, cb) });
  }

  // Unmatched (only in the larger list) collapse to a point on the missing side.
  large.forEach((cl, j) => {
    if (usedLarge.has(j)) return;
    const K = clampInt(flattenContour(cl).length, MIN_SAMPLES, MAX_SAMPLES);
    const pts = resamplePolyline(flattenContour(cl), cl.closed, K);
    const point: Vec2[] = Array.from({ length: K }, () => ({ ...centroid(cl) }));
    const largeIsA = !aSmaller; // the larger list is operand A?
    matched.push({ ca: cl, cb: cl, a: largeIsA ? pts : point, b: largeIsA ? point : pts });
  });

  return stepsFromMatched(matched, n);
}

/**
 * The full blend sequence A → B (`steps + 2` sets at t = k/(steps+1), first = A, last = B).
 * Matching point structure → exact bezier interpolation; differing shapes → resampling
 * (see the file header). `null` only when a side has no contours (caller renders both
 * operands). `steps` is clamped to [0, MAX_BLEND_STEPS].
 */
export function blendContours(a: Contour[], b: Contour[], steps: number): Contour[][] | null {
  if (a.length === 0 || b.length === 0) return null;
  const n = Math.max(0, Math.min(MAX_BLEND_STEPS, Math.floor(steps)));
  // Exact (handle-preserving) path when A and B share structure.
  if (sameTopology(a, b)) {
    const out: Contour[][] = [];
    for (let k = 0; k <= n + 1; k += 1) out.push(blendAt(a, b, k / (n + 1)));
    return out;
  }
  // Same number of contours, different point structure → resample each matched pair.
  if (a.length === b.length) return blendResampled(a, b, n);
  // Different contour counts → greedy pairing; unmatched paths collapse to a point.
  return blendDifferentCounts(a, b, n);
}
