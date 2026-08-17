import { nearestPointOnContours, type PathHit } from "./hitTest";
import { editableLayers } from "./shared";
import { useViewportStore } from "../../state/viewportStore";
import type { ToolDefinition } from "./types";

/**
 * Eraser: press on a path, drag along it, release — the spanned portion is removed
 * (the path is cut at the press and release points and the run between is dropped;
 * new ends get butt caps). One undo step. The pick radius is the on-canvas eraser
 * size (`viewportStore.eraserSize`). The entry hit is held per-gesture in a module-
 * local (reset on each press; not rendered, so it needs no editor state).
 */

const radius = () => useViewportStore.getState().eraserSize;

let entry: PathHit | null = null;

export const eraserTool: ToolDefinition = {
  id: "eraser",
  label: "Eraser",
  shortcut: "x",
  cursor: "crosshair",

  onPointerDown: (ctx) => {
    entry = nearestPointOnContours(editableLayers(ctx), ctx.viewport, ctx.screen, radius());
  },

  onPointerUp: (ctx) => {
    const e = entry;
    entry = null;
    if (!e) return;
    const exit = nearestPointOnContours(editableLayers(ctx), ctx.viewport, ctx.screen, radius());
    // Both ends must land on the SAME path for a well-defined span.
    if (!exit || exit.layerId !== e.layerId || exit.contourId !== e.contourId) return;
    ctx.doc.eraseContourSpan(
      e.layerId,
      e.contourId,
      { segIndex: e.segIndex, t: e.t },
      { segIndex: exit.segIndex, t: exit.t },
    );
  },
};
