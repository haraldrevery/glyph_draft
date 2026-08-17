import type { Contour } from "../../types/geometry";
import type { Vec2 } from "../../types/viewport";
import { cubicAt } from "./path";

/**
 * Low-level polygon math for the boolean engine. Everything here works on flat
 * point rings (Vec2[]) in world/font units, Y-up. Contours are flattened to
 * dense polygons here; the actual clipping (in clip.ts) and winding correction
 * (in winding.ts) build on these primitives. Kept dependency-free and pure so
 * it is easy to test in isolation — the whole point of the GeometryService
 * isolation boundary.
 */

export type Pt = Vec2;

/** Target segment length when flattening curves, in font units. */
const FLATNESS = 10;
/** Coordinate quantization step — collapses near-coincident points so the
 *  arrangement's vertices match exactly when stitched. */
const QUANT = 1000; // round to 1e-3 font units

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Snap a point to the quantization grid (stabilises vertex matching). */
export function quantize(p: Pt): Pt {
  return { x: Math.round(p.x * QUANT) / QUANT, y: Math.round(p.y * QUANT) / QUANT };
}

export function ptKey(p: Pt): string {
  return `${p.x},${p.y}`;
}

export function almostEqual(a: Pt, b: Pt, tol = 1e-6): boolean {
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
}

function curveSteps(a: Pt, c1: Pt, c2: Pt, b: Pt): number {
  const approx = dist(a, c1) + dist(c1, c2) + dist(c2, b);
  return Math.min(32, Math.max(4, Math.round(approx / FLATNESS)));
}

/**
 * Flatten a contour to a dense closed ring of points (no duplicated closing
 * point — edges wrap from last back to first). Straight segments contribute
 * just their endpoints; curved segments are sampled by arc-length estimate.
 */
export function flattenContour(contour: Contour): Pt[] {
  const pts = contour.points;
  if (pts.length < 2) return pts.map((p) => ({ x: p.x, y: p.y }));

  const out: Pt[] = [];
  const n = pts.length;
  const segCount = contour.closed ? n : n - 1;
  for (let i = 0; i < segCount; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    out.push({ x: a.x, y: a.y });
    const c1 = a.handleOut;
    const c2 = b.handleIn;
    if (c1 || c2) {
      const p0 = { x: a.x, y: a.y };
      const p3 = { x: b.x, y: b.y };
      const h1 = c1 ?? p0;
      const h2 = c2 ?? p3;
      const steps = curveSteps(p0, h1, h2, p3);
      for (let s = 1; s < steps; s += 1) out.push(cubicAt(p0, h1, h2, p3, s / steps));
    }
  }
  if (!contour.closed) {
    const last = pts[n - 1]!;
    out.push({ x: last.x, y: last.y });
  }
  return out;
}

/** Signed area of a point ring (shoelace). Y-up: positive = CCW, negative = CW. */
export function ringSignedArea(ring: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function isLeft(a: Pt, b: Pt, p: Pt): number {
  return (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
}

/**
 * Winding number of a point with respect to a set of oriented rings (Dan
 * Sunday's algorithm, half-open edge convention for robustness). Nonzero means
 * "inside" under the nonzero fill rule — so consistently-oriented holes (run
 * opposite to their outer) correctly subtract.
 */
export function windingNumber(p: Pt, rings: Pt[][]): number {
  let wn = 0;
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i < n; i += 1) {
      const a = ring[i]!;
      const b = ring[(i + 1) % n]!;
      if (a.y <= p.y) {
        if (b.y > p.y && isLeft(a, b, p) > 0) wn += 1;
      } else if (b.y <= p.y && isLeft(a, b, p) < 0) {
        wn -= 1;
      }
    }
  }
  return wn;
}

/** Inside test under the nonzero rule. */
export function insideNonzero(p: Pt, rings: Pt[][]): boolean {
  return windingNumber(p, rings) !== 0;
}

/** Even-odd point-in-ring (used for containment/nesting depth). */
export function pointInRing(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    const intersects =
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export interface SegHit {
  x: number;
  y: number;
  t: number; // param along segment 1
  u: number; // param along segment 2
}

/**
 * Proper intersection of two segments p1→p2 and p3→p4. Returns the crossing
 * with both parameters, or null if parallel/non-crossing. Endpoints count
 * (params are clamped to [0,1] inclusive) so T-junctions split correctly;
 * collinear overlaps are treated as non-crossing (a known limitation of the
 * flatten-based engine, which Paper.js would remove).
 */
export function segmentIntersection(p1: Pt, p2: Pt, p3: Pt, p4: Pt): SegHit | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-12) return null; // parallel or degenerate

  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;

  return { x: p1.x + t * d1x, y: p1.y + t * d1y, t, u };
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export { lerp };

/** Perpendicular distance from p to the infinite line a→b. */
function perpDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return dist(p, a);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/** Douglas–Peucker simplification of an OPEN polyline. */
function simplifyOpen(points: Pt[], tol: number): Pt[] {
  if (points.length <= 2) return points.slice();
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let maxDist = -1;
  let index = -1;
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = perpDistance(points[i]!, first, last);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > tol && index > 0) {
    const left = simplifyOpen(points.slice(0, index + 1), tol);
    const right = simplifyOpen(points.slice(index), tol);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

/**
 * Simplify a CLOSED ring: rotate to a deterministic extreme vertex so the
 * result is stable, run open simplification across the wrap, and drop the
 * duplicated endpoint. Removes flattening's dense points and any collinear runs
 * while preserving the silhouette within `tol`.
 */
export function simplifyClosed(ring: Pt[], tol: number): Pt[] {
  if (ring.length <= 3) return ring.slice();
  // Pick the lexicographically smallest point as a fixed anchor.
  let start = 0;
  for (let i = 1; i < ring.length; i += 1) {
    const p = ring[i]!;
    const s = ring[start]!;
    if (p.x < s.x || (p.x === s.x && p.y < s.y)) start = i;
  }
  const rotated: Pt[] = [];
  for (let i = 0; i < ring.length; i += 1) rotated.push(ring[(start + i) % ring.length]!);
  rotated.push({ ...rotated[0]! }); // close for open-DP
  const simplified = simplifyOpen(rotated, tol);
  simplified.pop(); // remove duplicated closing point
  return simplified;
}
