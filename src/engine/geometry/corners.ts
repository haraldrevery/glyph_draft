import type { AnchorPoint, Contour, CornerStyle } from "../../types/geometry";
import type { Vec2 } from "../../types/viewport";

/**
 * Non-destructive PATH-corner rounding: rewrite every `corner`-type node of a
 * contour into a fillet (round), a flat cut (chamfer), or a concave scoop
 * (invertedRound), at render/export time. Pure — the stored points stay sharp; this
 * runs upstream of stroke expansion in `renderContours`. Distinct from the stroke
 * `join` (which corners the OUTLINE).
 *
 * Each corner P (with anchor neighbours prev/next) becomes two points A and B, trimmed
 * `r` back along each edge, where `r = min(style.radius, ½·edgePrev, ½·edgeNext)` — the
 * clamp that keeps a big radius (or two corners on a short edge) from self-intersecting.
 * Node order/direction is preserved, so winding is unchanged.
 */

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
const len = (a: Vec2): number => Math.hypot(a.x, a.y);
const norm = (a: Vec2): Vec2 => {
  const l = len(a);
  return l < 1e-9 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};

/** Edge direction at P toward a neighbour: the bezier tangent if the segment is curved
 *  (a handle is present), else the straight chord to the neighbour anchor. */
function edgeDir(P: AnchorPoint, handle: Vec2 | undefined, neighbour: AnchorPoint): Vec2 {
  return norm(sub(handle ?? neighbour, P));
}

const MIN_R = 0.01; // below this a corner isn't worth rounding
const COLLINEAR = 0.001; // |sin(turn)| under this ⇒ no real corner, skip

/**
 * Replace one corner P (between prev/next) with the two trimmed points A, B for the
 * given style, or null when there's nothing to round (radius clamps to ~0, or the node
 * is collinear). `u`/`v` are the unit edge directions from P toward prev/next.
 */
function roundOne(P: AnchorPoint, prev: AnchorPoint, next: AnchorPoint, style: CornerStyle): AnchorPoint[] | null {
  const u = edgeDir(P, P.handleIn, prev);
  const v = edgeDir(P, P.handleOut, next);
  const lenPrev = len(sub(prev, P));
  const lenNext = len(sub(next, P));
  const r = Math.min(style.radius, 0.5 * lenPrev, 0.5 * lenNext);
  if (r < MIN_R) return null;

  // Interior angle β between the two edges; skip a straight-through (collinear) node.
  const cosB = Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y));
  const sinB = Math.abs(u.x * v.y - u.y * v.x);
  if (sinB < COLLINEAR) return null;
  const beta = Math.acos(cosB);

  const A = add(P, scale(u, r)); // on the incoming edge
  const B = add(P, scale(v, r)); // on the outgoing edge

  if (style.type === "chamfer") {
    // A straight cut: both ends are plain corners, no handles between them.
    return [
      { id: `${P.id}_a`, type: "corner", x: A.x, y: A.y },
      { id: `${P.id}_b`, type: "corner", x: B.x, y: B.y },
    ];
  }

  if (style.type === "invertedRound") {
    // Concave scoop: a circular arc CENTERED at the corner P (radius r), so it cups
    // INTO the corner. Its tangents at A/B are ⟂ the edges (vs the round fillet, whose
    // handles lie along the edges) — that's the opposite curvature.
    const L = r * (4 / 3) * Math.tan(beta / 4);
    const chord = norm(sub(B, A));
    const perp = (w: Vec2): Vec2 => ({ x: -w.y, y: w.x });
    const toward = (t: Vec2): Vec2 => (t.x * chord.x + t.y * chord.y < 0 ? scale(t, -1) : t);
    const tA = toward(perp(u)); // travel direction at A (A→B around P)
    const tB = toward(perp(v));
    return [
      { id: `${P.id}_a`, type: "smooth", x: A.x, y: A.y, handleOut: add(A, scale(tA, L)) },
      { id: `${P.id}_b`, type: "smooth", x: B.x, y: B.y, handleIn: sub(B, scale(tB, L)) },
    ];
  }

  // Circular fillet (round, convex): radius R from the trim distance, single-cubic
  // handles of length L along each edge tangent toward P, so the arc is tangent to both
  // edges and bulges toward the corner.
  const R = r * Math.tan(beta / 2);
  const sweep = Math.PI - beta;
  const L = R * (4 / 3) * Math.tan(sweep / 4);
  // -u / -v point from A / B toward the corner P (the convex bulge direction).
  const hOutA = sub(A, scale(u, L));
  const hInB = sub(B, scale(v, L));
  return [
    { id: `${P.id}_a`, type: "smooth", x: A.x, y: A.y, handleOut: hOutA },
    { id: `${P.id}_b`, type: "smooth", x: B.x, y: B.y, handleIn: hInB },
  ];
}

/** Memo entry: the result AND the style it was computed for. The style must be part
 *  of the validity check — keying on the contour alone silently returns the first
 *  style's geometry when the same contour is rendered with a different one. Mirrors
 *  `PaperGeometryService.expandStroke`, which validates `stroke ===` the same way. */
const cache = new WeakMap<Contour, { style: CornerStyle; result: Contour }>();

/** Round every eligible corner node of `contour` per `style`.
 *
 *  Memoized by contour identity + style REFERENCE: immutable contours make identity =
 *  content, so an edit recomputes. In the render path the style always comes from
 *  `contour.corner`, so contour identity implies style identity and the memo hits on
 *  every frame of a drag; a caller passing a fresh style object recomputes (correct,
 *  if slightly conservative — reference equality, not deep equality). */
export function roundCorners(contour: Contour, style: CornerStyle): Contour {
  const hit = cache.get(contour);
  if (hit && hit.style === style) return hit.result;

  const pts = contour.points;
  const n = pts.length;
  const out: AnchorPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const P = pts[i]!;
    // Only sharp corner nodes with two neighbours are eligible. Open-path endpoints
    // (i=0 / i=n-1) have one neighbour → left as-is.
    const hasPrev = contour.closed || i > 0;
    const hasNext = contour.closed || i < n - 1;
    if (P.type !== "corner" || !hasPrev || !hasNext) {
      out.push(P);
      continue;
    }
    const prev = pts[(i - 1 + n) % n]!;
    const next = pts[(i + 1) % n]!;
    const rounded = roundOne(P, prev, next, style);
    if (rounded) out.push(...rounded);
    else out.push(P);
  }

  const result: Contour = { ...contour, points: out };
  cache.set(contour, { style, result });
  return result;
}
