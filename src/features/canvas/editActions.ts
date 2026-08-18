import { useDocumentStore } from "../../state/documentStore";
import { useEditorStore } from "../../state/editorStore";
import { useViewportStore } from "../../state/viewportStore";
import {
  type Matrix,
  translate,
  scaleAbout,
  transformSelected,
  transformAnchor,
} from "../../engine/geometry/affine";
import { reverseContour } from "../../engine/geometry/path";
import { contourBounds, alignDeltas, type AlignType, type BBox } from "../../engine/geometry/align";
import { getGeometryService } from "../../engine/geometry/geometryEngine";
import { withCorners } from "../../engine/geometry/corners";
import type { Contour } from "../../types/geometry";
import type { Glyph } from "../../types/document";
import { resolvedLayers } from "../layers/layerTree";

/**
 * Selection-level edit actions (nudge / flip / reverse) as plain, React-free
 * functions — the same getState() pattern as clipboardActions, so the command
 * registry and context menus can call them without React. They operate on the
 * NODE selection across all unlocked layers and commit through
 * `replaceContoursEverywhere`, so each is exactly one undo step (Invariant 2) and
 * locked layers are skipped.
 */

function activeGlyph(): Glyph | null {
  const d = useDocumentStore.getState();
  return d.activeGlyphId ? d.glyphs[d.activeGlyphId] ?? null : null;
}

/** The set of selected anchor point ids (ignoring layer — ids are globally unique). */
function selectedIds(): Set<string> {
  return new Set(useEditorStore.getState().selection.map((r) => r.pointId));
}

/** Apply an affine matrix to the selected anchors (and their handles) across every
 *  unlocked layer; one undo step. No-op when nothing is selected. */
export function applyMatrixToSelection(m: Matrix): void {
  const glyph = activeGlyph();
  if (!glyph) return;
  const ids = selectedIds();
  if (ids.size === 0) return;

  const changed: Contour[] = [];
  for (const layer of resolvedLayers(glyph)) {
    if (layer.locked) continue;
    const next = transformSelected(layer.contours, ids, m);
    for (let i = 0; i < layer.contours.length; i += 1) {
      if (next[i] !== layer.contours[i]) changed.push(next[i]!);
    }
  }
  if (changed.length > 0) useDocumentStore.getState().replaceContoursEverywhere(changed);
}

/** World-space bounding box (and center) of the selected anchors + their handles. */
export function selectionBounds(): { minX: number; minY: number; maxX: number; maxY: number; center: { x: number; y: number } } | null {
  const glyph = activeGlyph();
  if (!glyph) return null;
  const ids = selectedIds();
  if (ids.size === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const see = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const layer of resolvedLayers(glyph)) {
    for (const c of layer.contours) {
      for (const p of c.points) {
        if (!ids.has(p.id)) continue;
        see(p.x, p.y);
        if (p.handleIn) see(p.handleIn.x, p.handleIn.y);
        if (p.handleOut) see(p.handleOut.x, p.handleOut.y);
      }
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } };
}

/** Move the selected anchors by (dx, dy) world units. */
export function nudgeSelection(dx: number, dy: number): void {
  applyMatrixToSelection(translate(dx, dy));
}

/** Mirror the selected anchors about the selection's bbox center. */
export function flipSelection(axis: "h" | "v"): void {
  const b = selectionBounds();
  if (!b) return;
  applyMatrixToSelection(scaleAbout(axis === "h" ? -1 : 1, axis === "v" ? -1 : 1, b.center));
}

/** Reverse the direction of every contour owning a selected anchor (unlocked layers). */
export function reverseSelection(): void {
  const glyph = activeGlyph();
  if (!glyph) return;
  const ids = selectedIds();
  if (ids.size === 0) return;

  const reversed: Contour[] = [];
  for (const layer of resolvedLayers(glyph)) {
    if (layer.locked) continue;
    for (const c of layer.contours) {
      if (c.points.some((p) => ids.has(p.id))) reversed.push(reverseContour(c));
    }
  }
  if (reversed.length > 0) useDocumentStore.getState().replaceContoursEverywhere(reversed);
}

/** True when there is a node selection to act on. */
export function hasSelection(): boolean {
  return useEditorStore.getState().selection.length > 0;
}

/** The distinct paths (one per contour) that have ≥1 selected node, with their layer. */
export function selectedContourRefs(): { layerId: string; contourId: string }[] {
  const seen = new Set<string>();
  const out: { layerId: string; contourId: string }[] = [];
  for (const r of useEditorStore.getState().selection) {
    const key = `${r.layerId}:${r.contourId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ layerId: r.layerId, contourId: r.contourId });
  }
  return out;
}

/** True when at least one whole path is implied by the node selection (move target). */
export function canMovePaths(): boolean {
  return selectedContourRefs().length > 0;
}

/** Re-point the moved contours' selection refs to their new layer so the selection
 *  (ephemeral) keeps highlighting them after a move. */
function reselectMovedContours(contourIds: Set<string>, targetLayerId: string): void {
  const editor = useEditorStore.getState();
  editor.setSelection(
    editor.selection.map((r) =>
      contourIds.has(r.contourId) ? { ...r, layerId: targetLayerId } : r,
    ),
  );
}

/** Move every selected path to an existing layer (one undo step), keeping it selected. */
export function moveSelectedPathsToLayer(targetLayerId: string): void {
  const ids = selectedContourRefs().map((r) => r.contourId);
  if (ids.length === 0) return;
  useDocumentStore.getState().moveContoursToLayer(ids, targetLayerId);
  reselectMovedContours(new Set(ids), targetLayerId);
}

/** Move every selected path to a freshly created layer (one undo step), keeping it
 *  selected. */
export function moveSelectedPathsToNewLayer(): void {
  const ids = selectedContourRefs().map((r) => r.contourId);
  if (ids.length === 0) return;
  const newLayerId = useDocumentStore.getState().moveContoursToNewLayer(ids);
  if (newLayerId) reselectMovedContours(new Set(ids), newLayerId);
}

function findContour(glyph: Glyph, layerId: string, contourId: string): Contour | null {
  const layer = glyph.layers.find((l) => l.id === layerId);
  return layer?.contours.find((c) => c.id === contourId) ?? null;
}

/** Whether `pointId` is the first ("start") or last ("end") anchor of `c`, else null. */
function endpointRole(c: Contour, pointId: string): "start" | "end" | null {
  if (c.points[0]?.id === pointId) return "start";
  if (c.points[c.points.length - 1]?.id === pointId) return "end";
  return null;
}

/** Enabled only when EXACTLY two endpoints (of open paths) are selected — the two
 *  ends of one open path (→ close it) or one end of each of two open paths (→ join). */
export function canMergeEndpoints(): boolean {
  const sel = useEditorStore.getState().selection;
  if (sel.length !== 2) return false;
  const glyph = activeGlyph();
  if (!glyph) return false;
  const ca = findContour(glyph, sel[0]!.layerId, sel[0]!.contourId);
  const cb = findContour(glyph, sel[1]!.layerId, sel[1]!.contourId);
  if (!ca || !cb || ca.closed || cb.closed) return false;
  if (!endpointRole(ca, sel[0]!.pointId) || !endpointRole(cb, sel[1]!.pointId)) return false;
  // Same contour: the two refs must be its two DIFFERENT ends (to close it).
  if (ca === cb && sel[0]!.pointId === sel[1]!.pointId) return false;
  return true;
}

/** Merge the two selected endpoints into one path (joined onto the SECOND node's
 *  layer) or close the path when they're its two ends. One undo step. */
export function mergeSelectedEndpoints(): void {
  if (!canMergeEndpoints()) return;
  const sel = useEditorStore.getState().selection;
  useDocumentStore.getState().joinEndpoints(sel[0]!, sel[1]!);
  // The merged contour has a new id, so the old refs are stale — start fresh.
  useEditorStore.getState().clearSelection();
}

/** The actual Contour objects (on unlocked layers) implied by the node selection —
 *  one per distinct path. The basis for the Align panel. */
export function selectedContours(): Contour[] {
  const glyph = activeGlyph();
  if (!glyph) return [];
  const out: Contour[] = [];
  for (const r of selectedContourRefs()) {
    const layer = resolvedLayers(glyph).find((l) => l.id === r.layerId);
    if (!layer || layer.locked) continue;
    const c = layer.contours.find((ct) => ct.id === r.contourId);
    if (c) out.push(c);
  }
  return out;
}

/** Enabled when at least one selected path carries a non-destructive stroke. */
export function canExpandStrokes(): boolean {
  return selectedContours().some((c) => c.stroke != null);
}

/** Expand every selected stroked path into its filled outline — the SAME geometry
 *  `buildFillGroups` renders — and drop the result on one new `baked` layer, consuming
 *  the originals (their centerline + `stroke`). Paths without a stroke are left alone.
 *  One undo step. */
export function expandSelectedStrokes(): void {
  const glyph = activeGlyph();
  if (!glyph) return;
  const geom = getGeometryService();
  const expanded: Contour[] = [];
  const removeRefs: { layerId: string; contourId: string }[] = [];
  for (const r of selectedContourRefs()) {
    const layer = resolvedLayers(glyph).find((l) => l.id === r.layerId);
    if (!layer || layer.locked) continue;
    const raw = layer.contours.find((ct) => ct.id === r.contourId);
    if (!raw || !raw.stroke) continue;
    // Round the path's corners FIRST, exactly like renderContours — otherwise a
    // corner-styled path bakes sharp while the canvas shows it filleted.
    const c = withCorners(raw);
    // Carry the path's paint onto each outline piece, exactly like renderContours.
    for (const o of geom.expandStroke(c, raw.stroke)) {
      expanded.push(c.paint ? { ...o, paint: c.paint } : o);
    }
    removeRefs.push({ layerId: r.layerId, contourId: r.contourId });
  }
  if (expanded.length === 0) return;
  useDocumentStore.getState().expandStrokesToLayer(expanded, removeRefs);
  // The expanded contours have new ids, so the old node selection is stale.
  useEditorStore.getState().clearSelection();
}

/** Alignment needs ≥2 distinct selected paths to act on. */
export function canAlign(): boolean {
  return selectedContours().length >= 2;
}

function unionBBox(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** A path's bbox for alignment: by its NODES (skeleton), or — in "outline" mode — by
 *  its own expanded-stroke outline (the visible filled shape). An unstroked path, or a
 *  stroke that fails to expand, falls back to the node bounds. */
function pathBounds(raw: Contour): BBox | null {
  // Same corner pre-pass as renderContours, so "align by outline" measures the
  // shape the user actually sees.
  const c = withCorners(raw);
  if (useViewportStore.getState().alignMode === "outline" && c.stroke) {
    let acc: BBox | null = null;
    for (const o of getGeometryService().expandStroke(c, c.stroke)) {
      const b = contourBounds(o);
      if (b) acc = acc ? unionBBox(acc, b) : b;
    }
    if (acc) return acc;
  }
  return contourBounds(c);
}

/** Align/distribute the selected paths' bounding boxes (Illustrator-style), relative to
 *  the selection's overall bbox; each whole path is translated. One undo step. The
 *  bbox is the nodes or the expanded outline per the persisted `alignMode`. */
export function alignSelectedPaths(type: AlignType): void {
  const contours = selectedContours();
  if (contours.length < 2) return;
  const boxes: BBox[] = [];
  for (const c of contours) {
    const b = pathBounds(c);
    if (!b) return; // a degenerate path aborts the whole op
    boxes.push(b);
  }
  const deltas = alignDeltas(boxes, type);
  const changed: Contour[] = [];
  contours.forEach((c, i) => {
    const { dx, dy } = deltas[i]!;
    if (dx === 0 && dy === 0) return;
    const m = translate(dx, dy);
    changed.push({ ...c, points: c.points.map((p) => transformAnchor(p, m)) });
  });
  if (changed.length > 0) useDocumentStore.getState().replaceContoursEverywhere(changed);
}
