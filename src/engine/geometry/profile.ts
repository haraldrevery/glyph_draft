import type { StrokeProfile } from "../../types/geometry";

/**
 * Pure evaluation of a stroke PROFILE — the 1-D curve the user shapes in the graph
 * panel. Framework-free and deterministic (unit-tested), reused by BOTH the geometry
 * engine (per arc-length sample) and the editor (to draw the smooth curve).
 *
 * Interpolation is monotone cubic (Fritsch–Carlson): smooth, but with NO overshoot —
 * the curve never leaves the [min, max] of its control points on a segment, so a
 * width multiplier can't dip below 0 or spike above the dragged values. `t` is
 * clamped to [0,1]; outside the control points' x-range the nearest endpoint y is
 * returned (the points always span [0,1] by construction). `loop` (y(0)=y(1)) is an
 * editor constraint — value continuity at the seam is all the engine needs, so it is
 * not special-cased here.
 */
export function evalProfile(profile: StrokeProfile, t: number): number {
  const pts = profile.points;
  if (pts.length === 0) return 0;
  if (pts.length === 1) return pts[0]!.y;

  const x = clamp01(t);
  const last = pts.length - 1;
  if (x <= pts[0]!.x) return pts[0]!.y;
  if (x >= pts[last]!.x) return pts[last]!.y;

  // Locate the segment [i, i+1] that contains x.
  let i = 0;
  while (i < last && pts[i + 1]!.x <= x) i += 1;
  const p0 = pts[i]!;
  const p1 = pts[i + 1]!;
  const h = p1.x - p0.x;
  if (h <= 0) return p0.y; // coincident x — degenerate, take the left value

  const { m0, m1 } = segmentTangents(pts, i);
  // Cubic Hermite on the unit interval s = (x - x0)/h.
  const s = (x - p0.x) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  return h00 * p0.y + h10 * h * m0 + h01 * p1.y + h11 * h * m1;
}

/**
 * The monotonicity-limited Hermite tangents at the two ends of segment `i`
 * (Fritsch–Carlson). Computing just the locally-needed tangents keeps `evalProfile`
 * allocation-light while still guaranteeing no overshoot on the segment.
 */
function segmentTangents(
  pts: readonly { x: number; y: number }[],
  i: number,
): { m0: number; m1: number } {
  const secant = (k: number): number => {
    const a = pts[k]!;
    const b = pts[k + 1]!;
    const dx = b.x - a.x;
    return dx > 0 ? (b.y - a.y) / dx : 0;
  };
  const last = pts.length - 1;
  // Raw tangent at vertex k = average of the two adjacent secants (one-sided at ends).
  const tangent = (k: number): number => {
    if (k === 0) return secant(0);
    if (k === last) return secant(last - 1);
    return (secant(k - 1) + secant(k)) / 2;
  };

  const d = secant(i); // the segment's own secant slope
  let m0 = tangent(i);
  let m1 = tangent(i + 1);

  if (d === 0) {
    // Flat segment must stay flat (no overshoot into a bump).
    return { m0: 0, m1: 0 };
  }
  const alpha = m0 / d;
  const beta = m1 / d;
  const mag = alpha * alpha + beta * beta;
  if (mag > 9) {
    const tau = 3 / Math.sqrt(mag);
    m0 = tau * alpha * d;
    m1 = tau * beta * d;
  }
  return { m0, m1 };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
