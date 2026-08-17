import { nearestPointOnContours } from "./hitTest";
import { editableLayers } from "./shared";
import type { ToolDefinition } from "./types";

/**
 * Scissors: click a point on any visible+unlocked path to cut it there. An open
 * path splits into two; a closed one opens into a single path (the cut lands
 * exactly on the curve via bezier subdivision). All the geometry lives in
 * `splitContourAt`; this tool just projects the click and calls the store. Single
 * click cuts — no drag, no options.
 */

/** Pixel radius within which a click counts as hitting a path. */
const MAX_PX = 8;

export const scissorsTool: ToolDefinition = {
  id: "scissors",
  label: "Scissors",
  shortcut: "c",
  cursor: "crosshair",

  onPointerDown: (ctx) => {
    const hit = nearestPointOnContours(editableLayers(ctx), ctx.viewport, ctx.screen, MAX_PX);
    if (!hit) return;
    ctx.doc.splitContourAtPoint(hit.layerId, hit.contourId, hit.segIndex, hit.t);
  },
};
