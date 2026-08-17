import { useMemo } from "react";
import { useActiveGlyph, useActiveLayer } from "../../state/documentStore";
import { useEditorStore } from "../../state/editorStore";
import type { Contour } from "../../types/geometry";

/**
 * The contours a per-path panel (Stroke, Fill) edits: every contour owning a
 * selected anchor, ACROSS all unlocked layers (a node selection can span layers —
 * each path is often its own layer), else the whole active layer. Contour ids are
 * globally unique, so matching by id is safe.
 *
 * Shared so the Stroke and Fill panels stay in lock-step on "what is selected".
 */
export function useEditTargets(): { targets: Contour[]; targetIds: string[] } {
  const layer = useActiveLayer();
  const glyph = useActiveGlyph();
  const selection = useEditorStore((s) => s.selection);

  const targets = useMemo<Contour[]>(() => {
    const editable = (glyph?.layers ?? []).filter((l) => !l.locked);
    const selectedIds = new Set(selection.map((r) => r.contourId));
    if (selectedIds.size > 0) {
      return editable.flatMap((l) => l.contours.filter((c) => selectedIds.has(c.id)));
    }
    return layer && !layer.locked ? layer.contours : [];
  }, [glyph, layer, selection]);

  const targetIds = useMemo(() => targets.map((c) => c.id), [targets]);
  return { targets, targetIds };
}
