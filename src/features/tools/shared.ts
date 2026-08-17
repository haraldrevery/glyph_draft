import type { AnchorPoint, Contour, PointRef } from "../../types/geometry";
import type { Layer } from "../../types/document";
import type { GridSettings, Vec2 } from "../../types/viewport";
import { pointInRing } from "../../engine/geometry/polygon";
import { snapPoint } from "../../engine/snapping/snap";
import type { ToolPointerContext } from "./types";

/**
 * Helpers shared by the node tools (select, lasso). These were duplicated verbatim
 * across both; kept here as one pure home so the two tools stay thin and can't
 * drift apart. (Tool-specific scopes — e.g. select's all-editable hit-test order —
 * stay in their own file.)
 */

/** Set of selected point ids (for fast hover/selection lookups). */
export function selectedIdSet(refs: PointRef[]): Set<string> {
  return new Set(refs.map((r) => r.pointId));
}

/** Translate an anchor and whichever handles it has by a delta. */
export function translatePoint(p: AnchorPoint, d: Vec2): AnchorPoint {
  const moved: AnchorPoint = { id: p.id, type: p.type, x: p.x + d.x, y: p.y + d.y };
  if (p.handleIn) moved.handleIn = { x: p.handleIn.x + d.x, y: p.handleIn.y + d.y };
  if (p.handleOut) moved.handleOut = { x: p.handleOut.x + d.x, y: p.handleOut.y + d.y };
  return moved;
}

/** Absolute position of a ref's anchor within a contour snapshot, or null. */
export function leadPoint(origin: Contour[], ref: PointRef): Vec2 | null {
  const c = origin.find((x) => x.id === ref.contourId);
  const p = c?.points.find((pt) => pt.id === ref.pointId);
  return p ? { x: p.x, y: p.y } : null;
}

/**
 * Delta to apply so the grabbed (lead) node lands on the grid. Snaps the lead's
 * ABSOLUTE position (its origin + the raw cursor delta), NOT the cursor delta — so
 * a dragged node locks to the CURRENT grid regardless of where it (or the cursor)
 * started, even after the grid size changes. Snap off ⇒ the raw cursor delta.
 *
 * Optional `snap` (geometry snap-to-point): given the desired absolute position it
 * returns a snapped point or null; a non-null result WINS over the grid, else we fall
 * back to the grid snap. Absent ⇒ exactly the prior grid-only behaviour.
 */
export function dragDelta(
  lead: Vec2,
  startRaw: Vec2,
  rawNow: Vec2,
  grid: GridSettings,
  snap?: (worldPt: Vec2) => Vec2 | null,
): Vec2 {
  const desired = {
    x: lead.x + (rawNow.x - startRaw.x),
    y: lead.y + (rawNow.y - startRaw.y),
  };
  const target = (snap && snap(desired)) || snapPoint(desired, grid.size, grid.snap);
  return { x: target.x - lead.x, y: target.y - lead.y };
}

/** Rebuild the affected contours (across layers) from their snapshot + delta. */
export function applyAnchorDelta(origin: Contour[], refs: PointRef[], d: Vec2): Contour[] {
  const byContour = new Map<string, Set<string>>();
  for (const ref of refs) {
    const ids = byContour.get(ref.contourId) ?? new Set<string>();
    ids.add(ref.pointId);
    byContour.set(ref.contourId, ids);
  }
  return origin.map((c) => {
    const ids = byContour.get(c.id);
    if (!ids) return c;
    return { ...c, points: c.points.map((p) => (ids.has(p.id) ? translatePoint(p, d) : p)) };
  });
}

/** The bulk-selection scope: EVERY visible + unlocked layer (Illustrator-style — node
 *  selection is not tied to which layer rows are "selected"; the layer selection only
 *  drives the Pathfinder). The one rule shared by lasso, marquee, and select-all.
 *  Bottom-to-top order. */
export function editableLayers(ctx: ToolPointerContext): Layer[] {
  return (ctx.glyph?.layers ?? []).filter((l) => l.visible && !l.locked);
}

/** Every anchor inside the polygon (world ring), as PointRefs. Pure. */
export function refsInPolygon(layers: Layer[], ring: Vec2[]): PointRef[] {
  if (ring.length < 3) return [];
  const refs: PointRef[] = [];
  for (const layer of layers) {
    for (const contour of layer.contours) {
      for (const p of contour.points) {
        if (pointInRing(p, ring)) {
          refs.push({ layerId: layer.id, contourId: contour.id, pointId: p.id });
        }
      }
    }
  }
  return refs;
}
