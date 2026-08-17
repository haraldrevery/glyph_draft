import { useDocumentStore } from "../../state/documentStore";
import { useEditorStore } from "../../state/editorStore";
import { useClipboardStore } from "../../state/clipboardStore";
import { cloneContourWithNewIds } from "../../state/glyphHelpers";
import { extractContours } from "../../engine/geometry/topology";
import type { Contour, PointRef } from "../../types/geometry";
import type { Glyph, Layer } from "../../types/document";

/**
 * Copy / cut / paste / select-all as plain, React-free functions (they read the
 * stores via getState(), the same pattern tools use). This is the single home
 * for the logic so BOTH the React hook (`useClipboard`) and the command registry
 * / context menus can invoke it without duplication.
 *
 * The copy unit is the whole CONTOUR: copying gathers every contour that owns a
 * selected anchor. Selection is layer-aware (Phase 5), so copy/cut span layers —
 * removed from each of its layers as one undo step. Paste clones to new ids at
 * the SAME coordinates (paste-in-place) into the ACTIVE layer, selects the
 * result, and switches to the select tool so it is immediately editable.
 */

function activeGlyph(): Glyph | null {
  const d = useDocumentStore.getState();
  return d.activeGlyphId ? d.glyphs[d.activeGlyphId] ?? null : null;
}

function activeLayer(): Layer | null {
  const d = useDocumentStore.getState();
  const glyph = activeGlyph();
  if (!glyph || !d.activeLayerId) return null;
  return glyph.layers.find((l) => l.id === d.activeLayerId) ?? null;
}

/** Contours owning a selected anchor, gathered across ALL layers (paint order). */
function selectedContoursAcrossLayers(): Contour[] {
  const glyph = activeGlyph();
  if (!glyph) return [];
  const selectedPointIds = new Set(
    useEditorStore.getState().selection.map((r) => r.pointId),
  );
  const out: Contour[] = [];
  for (const layer of glyph.layers) {
    for (const c of layer.contours) {
      if (c.points.some((p) => selectedPointIds.has(p.id))) out.push(c);
    }
  }
  return out;
}

/** Anchor refs for contours that all live on one layer. */
function allAnchorRefs(contours: Contour[], layerId: string): PointRef[] {
  return contours.flatMap((c) =>
    c.points.map((p) => ({ layerId, contourId: c.id, pointId: p.id })),
  );
}

export function copy(): void {
  const contours = selectedContoursAcrossLayers();
  if (contours.length > 0) useClipboardStore.getState().setContours(contours);
}

/**
 * Cut is node-aware: the clipboard gets the SELECTED runs (fragments) of each
 * affected contour, and the document is SPLIT at those nodes so the remainder
 * stays as separate paths (with butt-capped new ends). Selecting every point of
 * a contour reduces to the old whole-contour cut (fragment = the whole contour,
 * remainder empty). Stroke rides along on each fragment (extractContours clones
 * it), so a pasted fragment keeps its stroke.
 */
export function cut(): void {
  const glyph = activeGlyph();
  if (!glyph) return;
  const selection = useEditorStore.getState().selection;
  if (selection.length === 0) return;

  const selByContour = new Map<string, Set<string>>();
  for (const r of selection) {
    const ids = selByContour.get(r.contourId) ?? new Set<string>();
    ids.add(r.pointId);
    selByContour.set(r.contourId, ids);
  }

  const fragments: Contour[] = [];
  for (const layer of glyph.layers) {
    for (const c of layer.contours) {
      const sel = selByContour.get(c.id);
      if (sel) fragments.push(...extractContours(c, sel));
    }
  }
  if (fragments.length > 0) useClipboardStore.getState().setContours(fragments);

  useDocumentStore.getState().splitAtPoints(selection);
  useEditorStore.getState().clearSelection();
}

export function paste(): void {
  const clones = useClipboardStore.getState().contours.map(cloneContourWithNewIds);
  if (clones.length === 0) return;
  const layer = activeLayer();
  if (!layer || layer.locked) return;
  const editor = useEditorStore.getState();
  useDocumentStore.getState().addContours(clones);
  editor.setTool("select");
  editor.setSelection(allAnchorRefs(clones, layer.id));
}

/**
 * Duplicate the selected paths in place (Illustrator Ctrl+D): clone every contour
 * owning a selected anchor to new ids at the SAME coordinates, add them to the
 * active layer, and select the copies — without touching the system clipboard. One
 * undo step (reuses the paste helpers).
 */
export function duplicate(): void {
  const clones = selectedContoursAcrossLayers().map(cloneContourWithNewIds);
  if (clones.length === 0) return;
  const layer = activeLayer();
  if (!layer || layer.locked) return;
  const editor = useEditorStore.getState();
  useDocumentStore.getState().addContours(clones);
  editor.setTool("select");
  editor.setSelection(allAnchorRefs(clones, layer.id));
}

/**
 * Select every anchor across ALL visible + unlocked layers (Illustrator-style — node
 * selection is independent of which layer rows are "selected"). The same scope rule
 * the lasso and marquee use.
 */
export function selectAll(): void {
  const glyph = activeGlyph();
  if (!glyph) return;
  const refs: PointRef[] = [];
  for (const layer of glyph.layers) {
    if (layer.locked || !layer.visible) continue;
    refs.push(...allAnchorRefs(layer.contours, layer.id));
  }
  useEditorStore.getState().setSelection(refs);
}

/** True when there is a selection to copy/cut. */
export function canCopy(): boolean {
  return useEditorStore.getState().selection.length > 0;
}

/** True when the clipboard holds contours to paste. */
export function canPaste(): boolean {
  return useClipboardStore.getState().contours.length > 0;
}
