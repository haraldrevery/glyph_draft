import type { AnchorPoint } from "../../types/geometry";
import type { Vec2 } from "../../types/viewport";
import { createId } from "../../utils/id";

/**
 * Pure freehand → smooth bezier fitting for the pencil tool. No DOM, no Paper.
 *
 * `simplifyRDP` decimates the raw cursor trail (Ramer–Douglas–Peucker), then
 * `fitFreehand` turns the kept points into our cubic `AnchorPoint` model with
 * Catmull-Rom tangent handles (C1-smooth), keeping genuinely sharp turns as corner
 * nodes and closing the path when the gesture ends where it began. Handles are
 * absolute coords (Invariant 1).
 */

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
const len = (a: Vec2): number => Math.hypot(a.x, a.y);
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Distance from `p` to the infinite line through `a`,`b` (RDP's metric). */
function perpDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  return Math.abs(dx * (a.y - p.y) - (a.x - p.x) * dy) / Math.sqrt(l2);
}

/** Drop points farther than `tolerance` from the chord they sit on. Endpoints kept. */
export function simplifyRDP(points: Vec2[], tolerance: number): Vec2[] {
  const n = points.length;
  if (n <= 2 || tolerance <= 0) return points.slice();
  const keep = new Array<boolean>(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = first + 1; i < last; i += 1) {
      const d = perpDistance(points[i]!, points[first]!, points[last]!);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tolerance && idx !== -1) {
      keep[idx] = true;
      stack.push([first, idx], [idx, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Collapse consecutive points closer than `eps` (avoids zero-length tangents). */
function dedupe(points: Vec2[], eps: number): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || dist(prev, p) > eps) out.push(p);
  }
  return out;
}

export interface FitOptions {
  /** RDP decimation tolerance (world units). */
  tolerance: number;
  /** Turns sharper than this (degrees) stay corner nodes. Default 70. */
  cornerAngle?: number;
  /** Close the path if the ends land within this distance. Default = tolerance. */
  closeTolerance?: number;
}

export interface FitResult {
  points: AnchorPoint[];
  closed: boolean;
}

/** Fit a raw freehand polyline to a simplified, smooth bezier contour. */
export function fitFreehand(raw: Vec2[], opts: FitOptions): FitResult {
  const tol = Math.max(0, opts.tolerance);
  const cornerCos = Math.cos(((opts.cornerAngle ?? 70) * Math.PI) / 180);
  const closeTol = opts.closeTolerance ?? tol;

  const cleaned = dedupe(raw, Math.max(tol * 0.25, 1e-6));
  if (cleaned.length < 2) return { points: [], closed: false };

  let pts = simplifyRDP(cleaned, tol);

  // Closed when the gesture returns near its start (needs a real loop).
  let closed = false;
  if (pts.length >= 4 && dist(pts[0]!, pts[pts.length - 1]!) <= closeTol) {
    closed = true;
    pts = pts.slice(0, -1); // drop the near-duplicate end; the wrap reconnects
  }

  const n = pts.length;
  // A bare two-point stroke is just a straight segment (no spurious handles).
  if (!closed && n === 2) {
    return {
      points: pts.map((p) => ({ id: createId("pt"), type: "corner" as const, x: p.x, y: p.y })),
      closed: false,
    };
  }

  const anchors: AnchorPoint[] = pts.map((p, i) => {
    const prev = closed ? pts[(i - 1 + n) % n]! : pts[i - 1];
    const next = closed ? pts[(i + 1) % n]! : pts[i + 1];

    // Open-path endpoints: a single one-sided tangent toward the neighbour.
    if (!prev || !next) {
      const a: AnchorPoint = { id: createId("pt"), type: "smooth", x: p.x, y: p.y };
      if (!prev && next) a.handleOut = add(p, scale(sub(next, p), 1 / 3));
      if (!next && prev) a.handleIn = add(p, scale(sub(prev, p), 1 / 3));
      return a;
    }

    // Sharp turn → corner node (no handles), so intentional corners survive.
    const inDir = sub(p, prev);
    const outDir = sub(next, p);
    const li = len(inDir);
    const lo = len(outDir);
    if (li > 0 && lo > 0) {
      const cos = (inDir.x * outDir.x + inDir.y * outDir.y) / (li * lo);
      if (cos < cornerCos) {
        return { id: createId("pt"), type: "corner" as const, x: p.x, y: p.y };
      }
    }

    // Smooth interior node: mirrored Catmull-Rom handles (tension 0).
    const t = scale(sub(next, prev), 1 / 6);
    return {
      id: createId("pt"),
      type: "smooth" as const,
      x: p.x,
      y: p.y,
      handleIn: sub(p, t),
      handleOut: add(p, t),
    };
  });

  return { points: anchors, closed };
}
