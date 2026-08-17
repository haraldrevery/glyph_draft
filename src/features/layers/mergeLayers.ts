import { useDocumentStore } from "../../state/documentStore";
import { useViewportStore } from "../../state/viewportStore";
import { buildFillGroups, type FillLayer } from "../canvas/layerFills";
import { getGeometryService } from "../../engine/geometry/geometryEngine";
import { createId } from "../../utils/id";
import type { Layer } from "../../types/document";

/**
 * Destructive "Merge layers": bake the given layers' RENDERED geometry into one
 * new layer. This reuses `buildFillGroups` (the same pipeline the canvas/export
 * use), so strokes are expanded and any boolean pair fully within the set is
 * applied — then the result is frozen into a single `baked: true` layer (rendered
 * verbatim, winding preserved). The source layers and their pairs are removed.
 *
 * Geometry (Paper.js) is computed HERE, not in the store, so the document store
 * stays free of the geometry engine; the store only does the array surgery
 * (`commitMerge`) as one undo step.
 *
 * Locked layers are excluded (merging would destroy them); fewer than two
 * mergeable layers is a no-op.
 */
export function mergeLayers(layerIds: string[]): void {
  const doc = useDocumentStore.getState();
  const glyph = doc.activeGlyphId ? doc.glyphs[doc.activeGlyphId] : null;
  if (!glyph) return;

  const wanted = new Set(layerIds);
  const targets = glyph.layers.filter((l) => wanted.has(l.id) && !l.locked);
  if (targets.length < 2) return;

  const targetIds = new Set(targets.map((l) => l.id));
  const fillLayers: FillLayer[] = targets.map((l) => ({
    id: l.id,
    contours: l.contours,
    ...(l.baked ? { baked: true } : {}),
  }));
  // Only the pairs fully contained in the merge set apply to the bake.
  const pairs = (glyph.booleanPairs ?? []).filter(
    (p) => targetIds.has(p.layerIds[0]) && targetIds.has(p.layerIds[1]),
  );

  const groups = buildFillGroups(
    fillLayers,
    pairs,
    getGeometryService(),
    useViewportStore.getState().mergeHalftones,
  );
  const contours = groups.flatMap((g) => g.contours);

  const merged: Layer = {
    id: createId("ly"),
    name: `${targets[0]!.name} merged`,
    visible: true,
    locked: false,
    contours,
    baked: true,
  };

  doc.commitMerge([...targetIds], merged);
}
