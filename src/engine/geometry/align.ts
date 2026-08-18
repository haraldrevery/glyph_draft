import type { Contour } from "../../types/geometry";
import { cubicBounds } from "./path";

/**
 * Pure alignment math (no DOM, no store) — Illustrator-style align + distribute over
 * a set of "objects" (each object = one path's bounding box). Alignment is relative to
 * the union (overall) bounding box of the selection. World space is Y-up, so "top" is
 * the MAX y and "bottom" the MIN y.
 */

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type AlignType =
  | "left"
  | "centerH"
  | "right"
  | "top"
  | "middleV"
  | "bottom"
  | "distributeH"
  | "distributeV";

/** Axis-aligned bounds of a contour over its anchors AND handles (handles bound the
 *  curve extremes), or null for an empty path. */
export function contourBounds(contour: Contour): BBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of contour.points) {
    for (const pt of [p, p.handleIn, p.handleOut]) {
      if (!pt) continue;
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/**
 * EXACT axis-aligned bounds of a contour — every segment measured by `cubicBounds`,
 * so a curve is bounded by the curve itself rather than by its control handles.
 * Tighter than `contourBounds` wherever handles overshoot (which is most curves);
 * identical on handle-free paths. Includes the closing segment when `closed`.
 *
 * `contourBounds` is kept for align/distribute, where the handle-inclusive superset
 * is both cheaper and the long-standing behaviour; use this one where slack shows,
 * e.g. the export's crop-to-artwork frame.
 */
export function contourTightBounds(contour: Contour): BBox | null {
  const pts = contour.points;
  if (pts.length === 0) return null;
  const first = pts[0]!;
  const box: BBox = { minX: first.x, minY: first.y, maxX: first.x, maxY: first.y };
  const last = contour.closed ? pts.length : pts.length - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    // A missing handle collapses onto its own anchor — the cubic degenerates to the
    // straight segment, which is exactly the geometry `contourToPath` emits.
    const seg = cubicBounds(a, a.handleOut ?? a, b.handleIn ?? b, b);
    if (seg.minX < box.minX) box.minX = seg.minX;
    if (seg.minY < box.minY) box.minY = seg.minY;
    if (seg.maxX > box.maxX) box.maxX = seg.maxX;
    if (seg.maxY > box.maxY) box.maxY = seg.maxY;
  }
  return box;
}

function union(boxes: BBox[]): BBox {
  return boxes.reduce((u, b) => ({
    minX: Math.min(u.minX, b.minX),
    minY: Math.min(u.minY, b.minY),
    maxX: Math.max(u.maxX, b.maxX),
    maxY: Math.max(u.maxY, b.maxY),
  }));
}

/** Evenly space the boxes' centers along one axis between the two extreme objects
 *  (needs ≥3 to do anything). Returns a per-box delta on that axis. */
function distribute(boxes: BBox[], axis: "x" | "y"): { dx: number; dy: number }[] {
  const deltas = boxes.map(() => ({ dx: 0, dy: 0 }));
  if (boxes.length < 3) return deltas;
  const center = (b: BBox) => (axis === "x" ? (b.minX + b.maxX) / 2 : (b.minY + b.maxY) / 2);
  const order = boxes.map((b, i) => ({ i, c: center(b) })).sort((a, b) => a.c - b.c);
  const first = order[0]!.c;
  const last = order[order.length - 1]!.c;
  const step = (last - first) / (order.length - 1);
  order.forEach((item, k) => {
    const d = first + step * k - item.c;
    deltas[item.i] = axis === "x" ? { dx: d, dy: 0 } : { dx: 0, dy: d };
  });
  return deltas;
}

/** The per-object translation that aligns/distributes each box per `type`, relative to
 *  the selection's union bbox. Returns one {dx,dy} per input box (same order). */
export function alignDeltas(boxes: BBox[], type: AlignType): { dx: number; dy: number }[] {
  if (boxes.length === 0) return [];
  const u = union(boxes);
  const cx = (u.minX + u.maxX) / 2;
  const cy = (u.minY + u.maxY) / 2;
  switch (type) {
    case "left":
      return boxes.map((b) => ({ dx: u.minX - b.minX, dy: 0 }));
    case "right":
      return boxes.map((b) => ({ dx: u.maxX - b.maxX, dy: 0 }));
    case "centerH":
      return boxes.map((b) => ({ dx: cx - (b.minX + b.maxX) / 2, dy: 0 }));
    case "top":
      return boxes.map((b) => ({ dx: 0, dy: u.maxY - b.maxY }));
    case "bottom":
      return boxes.map((b) => ({ dx: 0, dy: u.minY - b.minY }));
    case "middleV":
      return boxes.map((b) => ({ dx: 0, dy: cy - (b.minY + b.maxY) / 2 }));
    case "distributeH":
      return distribute(boxes, "x");
    case "distributeV":
      return distribute(boxes, "y");
  }
}
