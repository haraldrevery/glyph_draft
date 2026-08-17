import { lineCrossings, screenDistance } from "./hitTest";
import { editableLayers } from "./shared";
import { createId } from "../../utils/id";
import type { AnchorPoint } from "../../types/geometry";
import type { ToolDefinition } from "./types";

/**
 * Knife: drag a straight line across the canvas; on release every visible+unlocked
 * path the line crosses is cut at the crossing points (an open path opens / splits,
 * a closed one opens — like scissors at each crossing). One undo step. The live line
 * preview reuses the `editor.draft` slot (the shapes/free-pen pattern, auto-cleared).
 */

/** Minimum drag (px) before a release cuts — filters stray clicks. */
const MIN_DRAG_PX = 4;

const corner = (x: number, y: number): AnchorPoint => ({ id: createId("pt"), type: "corner", x, y });

export const knifeTool: ToolDefinition = {
  id: "knife",
  label: "Knife",
  shortcut: "k",
  cursor: "crosshair",

  onPointerDown: (ctx) => {
    ctx.editor.setDraft({
      id: createId("ct"),
      closed: false,
      points: [corner(ctx.rawWorld.x, ctx.rawWorld.y), corner(ctx.rawWorld.x, ctx.rawWorld.y)],
    });
  },

  onPointerMove: (ctx) => {
    if (!ctx.isDown || !ctx.downWorld) return;
    const id = ctx.editor.draft?.id ?? createId("ct");
    ctx.editor.setDraft({
      id,
      closed: false,
      points: [corner(ctx.downWorld.x, ctx.downWorld.y), corner(ctx.rawWorld.x, ctx.rawWorld.y)],
    });
  },

  onPointerUp: (ctx) => {
    ctx.editor.setDraft(null);
    const a = ctx.downWorld;
    if (!a || screenDistance(a, ctx.screen, ctx.viewport) < MIN_DRAG_PX) return; // not a drag
    const b = ctx.rawWorld;
    const cuts: { layerId: string; contourId: string; segIndex: number; t: number }[] = [];
    for (const layer of editableLayers(ctx)) {
      for (const c of layer.contours) {
        for (const x of lineCrossings(c, a, b)) {
          cuts.push({ layerId: layer.id, contourId: c.id, segIndex: x.segIndex, t: x.t });
        }
      }
    }
    if (cuts.length > 0) ctx.doc.splitContoursAtPoints(cuts);
  },
};
