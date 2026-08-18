import { useMemo } from "react";
import { useActiveGlyph, useActiveLayerId } from "../../state/documentStore";
import { useEditorStore } from "../../state/editorStore";
import { layerColorMap } from "../layers/layerColors";
import type { Contour } from "../../types/geometry";
import { resolvedLayers } from "../layers/layerTree";

/**
 * Shared render selectors. Both the display (fills + outlines) and the editing
 * chrome (anchors + handles) read through here so a node-drag in progress moves
 * geometry and handles in lockstep — the live override is substituted for the
 * active layer in one place.
 *
 * Phase 3 edits one layer at a time, so the overlay shows only the active
 * layer's anchors, while the display renders every visible layer in array order
 * (bottom-to-top).
 */

export interface RenderLayer {
  id: string;
  contours: Contour[];
  /** Final baked geometry (merged layer); see Layer.baked. Carried so buildFillGroups
   *  renders it verbatim. */
  baked?: boolean;
  /** Per-layer editing color (auto palette by stack position); see layerColors. */
  color: string;
}

function overridesFrom(live: Contour[] | null): Map<string, Contour> | null {
  return live && live.length > 0 ? new Map(live.map((c) => [c.id, c])) : null;
}

/** The active layer's contours, with any in-flight drag override applied. Memoized on
 *  its inputs so it returns a STABLE reference when nothing changed — an edit replaces
 *  the `glyph` object (Invariant 2), a drag changes `live` — so downstream `useMemo`s
 *  hold across cursor-driven re-renders (no needless geometry rebuilds). */
export function useActiveLayerContours(): Contour[] {
  const glyph = useActiveGlyph();
  const activeLayerId = useActiveLayerId();
  const live = useEditorStore((s) => s.liveContours);

  return useMemo(() => {
    const layer =
      glyph && activeLayerId
        ? glyph.layers.find((l) => l.id === activeLayerId) ?? null
        : null;
    const committed = layer?.contours ?? [];
    const overrides = overridesFrom(live);
    if (!overrides) return committed;
    return committed.map((c) => overrides.get(c.id) ?? c);
  }, [glyph, activeLayerId, live]);
}

/** Every visible layer (bottom-to-top), with any in-flight drag applied. The
 *  override is keyed by contour id (ids are globally unique), so a single-layer
 *  drag only touches that layer while a cross-layer lasso move touches several. */
export function useVisibleRenderLayers(): RenderLayer[] {
  const glyph = useActiveGlyph();
  const live = useEditorStore((s) => s.liveContours);

  // Memoized so the array is a stable reference when idle (no drag, same glyph) —
  // otherwise this fresh array on every render rebuilds all fills (e.g. the blend) on
  // every mouse move. Recomputes exactly when geometry changes (glyph) or a drag does (live).
  return useMemo(() => {
    const overrides = overridesFrom(live);
    const colors = layerColorMap((glyph?.layers ?? []).map((l) => l.id));
    return (glyph ? resolvedLayers(glyph) : [])
      .filter((l) => l.visible)
      .map((l) => ({
        ...l,
        contours: overrides ? l.contours.map((c) => overrides.get(c.id) ?? c) : l.contours,
        color: colors.get(l.id)!,
      }));
  }, [glyph, live]);
}

/**
 * Editable layers (visible AND unlocked), bottom-to-top, with the active
 * layer's in-flight drag applied. The edit overlay shows anchors for every
 * editable layer (not just the active one) so any layer's nodes stay editable.
 */
export function useEditableLayers(): RenderLayer[] {
  const glyph = useActiveGlyph();
  const live = useEditorStore((s) => s.liveContours);

  // Stable reference when idle (see useVisibleRenderLayers) so the edit overlay's memos hold.
  return useMemo(() => {
    const overrides = overridesFrom(live);
    const colors = layerColorMap((glyph?.layers ?? []).map((l) => l.id));
    return (glyph ? resolvedLayers(glyph) : [])
      .filter((l) => l.visible && !l.locked)
      .map((l) => ({
        id: l.id,
        contours: overrides ? l.contours.map((c) => overrides.get(c.id) ?? c) : l.contours,
        color: colors.get(l.id)!,
      }));
  }, [glyph, live]);
}
