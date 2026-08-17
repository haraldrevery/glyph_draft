import type { Vec2 } from "../../types/viewport";
import type { AnchorPoint, Contour } from "../../types/geometry";

/**
 * 2D affine transforms for the transform box (Ctrl+T). Pure and framework-free:
 * the overlay builds a matrix from the drag (scale/rotate/translate about a pivot)
 * and `transformSelected` applies it to the selected anchors — handles included,
 * since they're absolute coords (Invariant 1). Worked in WORLD space (Y-up), the
 * same space anchors live in, so no screen/Y-flip concerns leak in here.
 *
 * Matrix is [a c e; b d f]: x' = a·x + c·y + e, y' = b·x + d·y + f.
 */
export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** Compose two matrices: the result applies `n` first, then `m`. */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

export function apply(m: Matrix, p: Vec2): Vec2 {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

export function translate(dx: number, dy: number): Matrix {
  return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy };
}

/** Scale by (sx, sy) about a fixed pivot (the pivot point stays put). */
export function scaleAbout(sx: number, sy: number, pivot: Vec2): Matrix {
  return multiply(
    translate(pivot.x, pivot.y),
    multiply({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }, translate(-pivot.x, -pivot.y)),
  );
}

/** Horizontal shear by factor `k`: x' = x + k·y, y' = y (about the line y=0). The
 *  italic slant — `k = tan(angle)`. */
export function shearX(k: number): Matrix {
  return { a: 1, b: 0, c: k, d: 1, e: 0, f: 0 };
}

/** Rotate by `rad` (CCW in world space) about a fixed pivot. */
export function rotateAbout(rad: number, pivot: Vec2): Matrix {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return multiply(
    translate(pivot.x, pivot.y),
    multiply({ a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 }, translate(-pivot.x, -pivot.y)),
  );
}

/** Transform an anchor and whichever handles it carries. */
export function transformAnchor(p: AnchorPoint, m: Matrix): AnchorPoint {
  const a = apply(m, p);
  const out: AnchorPoint = { id: p.id, type: p.type, x: a.x, y: a.y };
  if (p.handleIn) out.handleIn = apply(m, p.handleIn);
  if (p.handleOut) out.handleOut = apply(m, p.handleOut);
  return out;
}

/** Apply `m` to the anchors in `ids`, leaving the rest of each contour untouched. */
export function transformSelected(
  contours: Contour[],
  ids: Set<string>,
  m: Matrix,
): Contour[] {
  return contours.map((c) => {
    if (!c.points.some((p) => ids.has(p.id))) return c;
    return { ...c, points: c.points.map((p) => (ids.has(p.id) ? transformAnchor(p, m) : p)) };
  });
}
