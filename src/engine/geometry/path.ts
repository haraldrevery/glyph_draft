import type { AnchorPoint, Contour, Winding } from "../../types/geometry";
import type { Vec2 } from "../../types/viewport";

/**
 * The bezier math core. Two responsibilities, both pure:
 *   1. turn a Contour (anchors with ABSOLUTE handles) into an SVG path `d`
 *      string, so the renderer never hand-builds path syntax; and
 *   2. answer winding/orientation questions, which the winding-rules pillar and
 *      (later) boolean ops depend on.
 *
 * Handles are stored in absolute coordinates, so a cubic segment between two
 * anchors is simply `C handleOut(a) handleIn(b) b`. A missing handle means that
 * side of the segment is straight, which collapses to a line when BOTH handles
 * are absent.
 *
 * Coordinates are world/font units throughout; the canvas applies the single
 * Y-flip via the group transform, so nothing here ever thinks about screen
 * space. That separation is what lets the same path string render correctly at
 * any zoom and also be written verbatim into an exported SVG later.
 */

/** Round to a few decimals to keep emitted paths compact and stable. */
function n(value: number): string {
  return (Math.round(value * 1000) / 1000).toString();
}

/** Does this anchor have a usable bezier handle on the given side? */
function handle(p: AnchorPoint, side: "in" | "out"): Vec2 | undefined {
  return side === "in" ? p.handleIn : p.handleOut;
}

/** The cubic segment between two anchors, as the tail of a path command. */
function segment(a: AnchorPoint, b: AnchorPoint): string {
  const out = handle(a, "out");
  const inb = handle(b, "in");
  if (!out && !inb) {
    return `L ${n(b.x)} ${n(b.y)}`;
  }
  const c1 = out ?? a;
  const c2 = inb ?? b;
  return `C ${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(b.x)} ${n(b.y)}`;
}

/**
 * One contour to an SVG path. Open contours stop after the last anchor; closed
 * contours add the wrap-around segment back to the first anchor and a `Z`.
 */
export function contourToPath(contour: Contour): string {
  const pts = contour.points;
  if (pts.length === 0) return "";
  const first = pts[0]!;
  let d = `M ${n(first.x)} ${n(first.y)}`;

  const lastIndex = contour.closed ? pts.length : pts.length - 1;
  for (let i = 0; i < lastIndex; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    d += ` ${segment(a, b)}`;
  }
  if (contour.closed) d += " Z";
  return d;
}

/** Many contours to one compound path (for a single filled <path>). */
export function contoursToPath(contours: Contour[]): string {
  return contours
    .map(contourToPath)
    .filter((d) => d.length > 0)
    .join(" ");
}

/**
 * Signed area of the contour's anchor polygon (shoelace). In our Y-up world a
 * POSITIVE result is counter-clockwise and a NEGATIVE result is clockwise.
 *
 * This uses the straight anchor polygon, not the exact bezier outline, which is
 * the standard fast orientation test and is reliable for the shapes Phase 2
 * produces. Exact curve-aware area arrives with the Paper.js geometry service
 * in Phase 5.
 */
export function signedArea(contour: Contour): number {
  const pts = contour.points;
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** Orientation of a contour. Convention: clockwise = negative signed area. */
export function contourWinding(contour: Contour): Winding {
  return signedArea(contour) < 0 ? "cw" : "ccw";
}

/**
 * Reverse a contour's direction. Point order is reversed AND each anchor's in/
 * out handles are swapped, so the geometry is identical and only the winding
 * flips. Used to normalize primitives and (later) to fix hole directions.
 */
export function reverseContour(contour: Contour): Contour {
  const points: AnchorPoint[] = contour.points
    .slice()
    .reverse()
    .map((p) => {
      const swapped: AnchorPoint = { id: p.id, type: p.type, x: p.x, y: p.y };
      if (p.handleOut) swapped.handleIn = p.handleOut;
      if (p.handleIn) swapped.handleOut = p.handleIn;
      return swapped;
    });
  return { ...contour, points };
}

/** Force a contour to a target winding, reversing only if needed. */
export function ensureWinding(contour: Contour, target: Winding): Contour {
  return contourWinding(contour) === target ? contour : reverseContour(contour);
}

/** Evaluate a cubic bezier at t in [0,1]. Handy for hit-testing/splitting. */
export function cubicAt(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/**
 * Split a cubic bezier at `t` (De Casteljau) into two cubics that retrace the same
 * curve. `left`/`right` are each `[p0, c1, c2, p3]`; they meet at the split point
 * `left[3] === right[0]`. Used by the scissors cut to subdivide a segment exactly.
 */
export function splitCubic(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  t: number,
): { left: [Vec2, Vec2, Vec2, Vec2]; right: [Vec2, Vec2, Vec2, Vec2] } {
  const q0 = lerp(p0, p1, t);
  const q1 = lerp(p1, p2, t);
  const q2 = lerp(p2, p3, t);
  const r0 = lerp(q0, q1, t);
  const r1 = lerp(q1, q2, t);
  const s = lerp(r0, r1, t); // the split point
  return {
    left: [p0, q0, r0, s],
    right: [s, r1, q2, p3],
  };
}
