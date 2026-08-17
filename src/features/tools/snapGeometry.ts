import type { Layer } from "../../types/document";
import type { PointRef } from "../../types/geometry";
import type { Vec2, Viewport } from "../../types/viewport";
import { worldToScreen } from "../../engine/viewport/transform";
import { cubicAt } from "../../engine/geometry/path";
import { screenDistance, nearestPointOnContours, type PathHit } from "./hitTest";

/**
 * Snap-to-geometry (Illustrator "Snap to Point"): pull the cursor / a dragged node
 * onto an existing ANCHOR (Stage 1) or PATH edge (Stage 2) of the visible layers,
 * within a screen-pixel tolerance. Pure + screen-space, like `hitTest.ts`, so the
 * radius is constant px at any zoom.
 *
 * `exclude` keeps a drag from snapping to ITSELF: anchor snap skips the moving point
 * ids; path snap (Stage 2) skips contours that contain a moving point. For placing
 * NEW geometry (pen, shapes) the exclusion is empty — you want to land on what's there.
 */

/** Default snap tolerance in screen px (matches the anchor `HIT_RADIUS`). */
export const SNAP_RADIUS = 8;

export interface SnapExclude {
  pointIds: Set<string>;
  contourIds: Set<string>;
}

export const NO_EXCLUDE: SnapExclude = { pointIds: new Set(), contourIds: new Set() };

export interface GeomSnap {
  point: Vec2;
  kind: "anchor" | "path";
}

/** Nearest anchor (excluding `excludePointIds`) within `maxPx`, or null. */
export function nearestAnchor(
  layers: Layer[],
  viewport: Viewport,
  screen: Vec2,
  maxPx: number,
  excludePointIds: Set<string>,
): { point: Vec2; ref: PointRef } | null {
  let best: { point: Vec2; ref: PointRef } | null = null;
  let bestDist = maxPx;
  for (const layer of layers) {
    for (const contour of layer.contours) {
      for (const p of contour.points) {
        if (excludePointIds.has(p.id)) continue;
        const d = screenDistance(p, screen, viewport);
        if (d < bestDist) {
          bestDist = d;
          best = { point: { x: p.x, y: p.y }, ref: { layerId: layer.id, contourId: contour.id, pointId: p.id } };
        }
      }
    }
  }
  return best;
}

/** Evaluate the world point of a PathHit (the same cubic `nearestPointOnContours` ranks). */
function pathHitPoint(layers: Layer[], hit: PathHit): Vec2 | null {
  const layer = layers.find((l) => l.id === hit.layerId);
  const c = layer?.contours.find((x) => x.id === hit.contourId);
  if (!c) return null;
  const n = c.points.length;
  const a = c.points[hit.segIndex];
  const b = c.points[(hit.segIndex + 1) % n];
  if (!a || !b) return null;
  const p0: Vec2 = { x: a.x, y: a.y };
  const p3: Vec2 = { x: b.x, y: b.y };
  return cubicAt(p0, a.handleOut ?? p0, b.handleIn ?? p3, p3, hit.t);
}

/**
 * Resolve a geometry snap for `screen` over `layers`, precedence ANCHOR → PATH (a
 * point is the stronger target). Path snap skips contours in `exclude.contourIds`
 * (a dragged contour can't snap to its own edge). Returns null when nothing is within
 * `maxPx` (caller falls back to grid/raw).
 */
export function snapToGeometry(
  layers: Layer[],
  viewport: Viewport,
  screen: Vec2,
  maxPx: number,
  exclude: SnapExclude,
): GeomSnap | null {
  const anchor = nearestAnchor(layers, viewport, screen, maxPx, exclude.pointIds);
  if (anchor) return { point: anchor.point, kind: "anchor" };

  const pathLayers = exclude.contourIds.size
    ? layers.map((l) => ({ ...l, contours: l.contours.filter((c) => !exclude.contourIds.has(c.id)) }))
    : layers;
  const hit = nearestPointOnContours(pathLayers, viewport, screen, maxPx);
  if (hit) {
    const point = pathHitPoint(pathLayers, hit);
    if (point) return { point, kind: "path" };
  }
  return null;
}

/**
 * Build the node-drag snap callback for `dragDelta`: given the grabbed node's desired
 * world position it returns the snapped point (anchor/path of `targets`) or null. The
 * `movingRefs` are excluded so the node can't snap to itself or its own contour. Pure
 * (no store read — the caller decides whether the toggle is on).
 */
export function dragSnapFn(
  targets: Layer[],
  viewport: Viewport,
  movingRefs: PointRef[],
): (worldPt: Vec2) => Vec2 | null {
  const exclude: SnapExclude = {
    pointIds: new Set(movingRefs.map((r) => r.pointId)),
    contourIds: new Set(movingRefs.map((r) => r.contourId)),
  };
  return (worldPt) => {
    const hit = snapToGeometry(targets, viewport, worldToScreen(worldPt, viewport), SNAP_RADIUS, exclude);
    return hit ? hit.point : null;
  };
}
