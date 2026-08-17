import type { Layer } from "../../types/document";
import type { Contour, HandleKind, PointRef } from "../../types/geometry";
import type { Vec2, Viewport } from "../../types/viewport";
import { worldToScreen } from "../../engine/viewport/transform";
import { cubicAt } from "../../engine/geometry/path";

/** Pixel radius within which a click counts as hitting an anchor or handle. */
export const HIT_RADIUS = 7;

/** A bezier handle shorter than this many SCREEN pixels is treated as zero-length:
 *  the handle is dropped so the node becomes a corner (no spurious micro-curve).
 *  Screen-relative, so zooming in still lets the user pull a deliberately small
 *  curve. Used by both the pen (draw) and select (edit) tools. */
export const HANDLE_COLLAPSE_PX = 4;

export type HitResult =
  | { kind: "anchor"; ref: PointRef }
  | { kind: "handle"; ref: PointRef; handle: HandleKind };

function near(a: Vec2, b: Vec2, radius: number): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy <= radius * radius;
}

/** Handles of SELECTED anchors in one layer (drawn on top, so picked first). */
function hitHandleInLayer(
  layer: Layer,
  viewport: Viewport,
  screen: Vec2,
  selectedIds: Set<string>,
): HitResult | null {
  for (const contour of layer.contours) {
    for (const point of contour.points) {
      if (!selectedIds.has(point.id)) continue;
      const ref: PointRef = { layerId: layer.id, contourId: contour.id, pointId: point.id };
      if (point.handleOut) {
        const s = worldToScreen(point.handleOut, viewport);
        if (near(s, screen, HIT_RADIUS)) return { kind: "handle", ref, handle: "out" };
      }
      if (point.handleIn) {
        const s = worldToScreen(point.handleIn, viewport);
        if (near(s, screen, HIT_RADIUS)) return { kind: "handle", ref, handle: "in" };
      }
    }
  }
  return null;
}

/** Anchor points in one layer. */
function hitAnchorInLayer(layer: Layer, viewport: Viewport, screen: Vec2): HitResult | null {
  for (const contour of layer.contours) {
    for (const point of contour.points) {
      const s = worldToScreen(point, viewport);
      if (near(s, screen, HIT_RADIUS)) {
        const ref: PointRef = { layerId: layer.id, contourId: contour.id, pointId: point.id };
        return { kind: "anchor", ref };
      }
    }
  }
  return null;
}

/**
 * Find what the cursor is over in a single layer, in priority order: handles of
 * SELECTED anchors first (they sit on top and are the finer target), then
 * anchors. Hit-testing is done in screen space so the pick radius is a constant
 * number of pixels at any zoom — matching what the user sees.
 */
export function hitTestLayer(
  layer: Layer | null,
  viewport: Viewport,
  screen: Vec2,
  selectedIds: Set<string>,
): HitResult | null {
  if (!layer) return null;
  return (
    hitHandleInLayer(layer, viewport, screen, selectedIds) ??
    hitAnchorInLayer(layer, viewport, screen)
  );
}

/**
 * Hit-test across several layers (Phase 5: cross-layer selection). Layers must
 * be passed in TOP-TO-BOTTOM priority order. Selected handles win globally
 * (they are the finest target wherever they live), then anchors are picked
 * top-to-bottom so the visually frontmost anchor wins ties — exactly what the
 * user expects when clicking a stack of overlapping layers.
 */
export function hitTestLayers(
  layers: Layer[],
  viewport: Viewport,
  screen: Vec2,
  selectedIds: Set<string>,
): HitResult | null {
  for (const layer of layers) {
    const h = hitHandleInLayer(layer, viewport, screen, selectedIds);
    if (h) return h;
  }
  for (const layer of layers) {
    const a = hitAnchorInLayer(layer, viewport, screen);
    if (a) return a;
  }
  return null;
}

/**
 * Find an OPEN contour's terminal (first/last anchor) under the cursor, across
 * layers, excluding one ref (the anchor being dragged). Powers merge-on-drag:
 * the dragged endpoint fuses to the endpoint this returns. Same-contour matches
 * are allowed (dragging a path's own two ends together closes it).
 */
export function hitEndpoint(
  layers: Layer[],
  viewport: Viewport,
  screen: Vec2,
  exclude: PointRef,
): PointRef | null {
  for (const layer of layers) {
    for (const contour of layer.contours) {
      if (contour.closed || contour.points.length < 2) continue;
      const ends = [contour.points[0]!, contour.points[contour.points.length - 1]!];
      for (const point of ends) {
        if (
          point.id === exclude.pointId &&
          contour.id === exclude.contourId &&
          layer.id === exclude.layerId
        ) {
          continue;
        }
        if (near(worldToScreen(point, viewport), screen, HIT_RADIUS)) {
          return { layerId: layer.id, contourId: contour.id, pointId: point.id };
        }
      }
    }
  }
  return null;
}

/** Screen-space distance between a world point and a screen point, in pixels. */
export function screenDistance(world: Vec2, screen: Vec2, viewport: Viewport): number {
  const s = worldToScreen(world, viewport);
  return Math.hypot(s.x - screen.x, s.y - screen.y);
}

/** A point on a contour's outline: which contour, which segment (the one leaving
 *  point `segIndex`; a closed contour's closing segment is `n-1`), and its `t`. */
export interface PathHit {
  layerId: string;
  contourId: string;
  segIndex: number;
  t: number;
}

/** Number of coarse samples per segment before refining. */
const SEG_SAMPLES = 24;

/**
 * Project a screen click onto the NEAREST point of any contour's outline across
 * `layers`, within `maxPx`. Returns the cut input the scissors tool needs
 * (`segIndex`/`t`) or null if nothing is close enough. Every segment is treated as
 * a cubic (a missing handle = the anchor itself), sampled coarsely, then `t` is
 * ternary-refined around the best sample. Screen-space throughout, so the pick
 * radius is constant px at any zoom.
 */
export function nearestPointOnContours(
  layers: Layer[],
  viewport: Viewport,
  screen: Vec2,
  maxPx: number,
): PathHit | null {
  let best: PathHit | null = null;
  let bestDist = maxPx;

  for (const layer of layers) {
    for (const contour of layer.contours) {
      const pts = contour.points;
      const n = pts.length;
      if (n < 2) continue;
      const segCount = contour.closed ? n : n - 1;
      for (let i = 0; i < segCount; i += 1) {
        const a = pts[i]!;
        const b = pts[(i + 1) % n]!;
        const p0: Vec2 = { x: a.x, y: a.y };
        const p3: Vec2 = { x: b.x, y: b.y };
        const p1 = a.handleOut ?? p0;
        const p2 = b.handleIn ?? p3;
        const distAt = (t: number) => screenDistance(cubicAt(p0, p1, p2, p3, t), screen, viewport);

        let coarseT = 0;
        let coarseD = Infinity;
        for (let k = 0; k <= SEG_SAMPLES; k += 1) {
          const d = distAt(k / SEG_SAMPLES);
          if (d < coarseD) {
            coarseD = d;
            coarseT = k / SEG_SAMPLES;
          }
        }
        // Ternary-refine within the neighbouring sample window.
        let lo = Math.max(0, coarseT - 1 / SEG_SAMPLES);
        let hi = Math.min(1, coarseT + 1 / SEG_SAMPLES);
        for (let iter = 0; iter < 16; iter += 1) {
          const t1 = lo + (hi - lo) / 3;
          const t2 = hi - (hi - lo) / 3;
          if (distAt(t1) < distAt(t2)) hi = t2;
          else lo = t1;
        }
        const t = (lo + hi) / 2;
        const d = distAt(t);
        if (d < bestDist) {
          bestDist = d;
          best = { layerId: layer.id, contourId: contour.id, segIndex: i, t };
        }
      }
    }
  }
  return best;
}

/**
 * Where the (finite) knife segment `a→b` crosses a contour's outline — `{segIndex, t}`
 * per crossing (the cut input the knife/scissors share). Per segment, samples `cubicAt`
 * and watches the sign of the sample's side of the infinite line `a–b`; a sign change
 * is bisection-refined to where side = 0, then kept only if the crossing's foot lies
 * within the `a–b` segment (not the infinite line). World-space.
 */
export function lineCrossings(contour: Contour, a: Vec2, b: Vec2): { segIndex: number; t: number }[] {
  const pts = contour.points;
  const n = pts.length;
  if (n < 2) return [];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return [];
  const side = (p: Vec2) => dx * (p.y - a.y) - dy * (p.x - a.x);
  const within = (p: Vec2) => {
    const u = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    return u >= 0 && u <= 1;
  };
  const segCount = contour.closed ? n : n - 1;
  const out: { segIndex: number; t: number }[] = [];
  for (let i = 0; i < segCount; i += 1) {
    const pa = pts[i]!;
    const pb = pts[(i + 1) % n]!;
    const p0: Vec2 = { x: pa.x, y: pa.y };
    const p3: Vec2 = { x: pb.x, y: pb.y };
    const p1 = pa.handleOut ?? p0;
    const p2 = pb.handleIn ?? p3;
    const at = (t: number) => cubicAt(p0, p1, p2, p3, t);
    let s0 = side(p0);
    for (let k = 0; k < SEG_SAMPLES; k += 1) {
      const t0 = k / SEG_SAMPLES;
      const t1 = (k + 1) / SEG_SAMPLES;
      const s1 = side(at(t1));
      if (s0 === 0) {
        if (within(at(t0))) out.push({ segIndex: i, t: t0 });
      } else if (s0 * s1 < 0) {
        let lo = t0;
        let hi = t1;
        let slo = s0;
        for (let it = 0; it < 24; it += 1) {
          const mid = (lo + hi) / 2;
          const sm = side(at(mid));
          if (sm === 0 || slo * sm < 0) hi = mid;
          else {
            lo = mid;
            slo = sm;
          }
        }
        const tc = (lo + hi) / 2;
        if (within(at(tc))) out.push({ segIndex: i, t: tc });
      }
      s0 = s1;
    }
  }
  return out;
}
