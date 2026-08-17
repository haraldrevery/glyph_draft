import type { Contour, PointRef } from "../../types/geometry";
import type { Vec2 } from "../../types/viewport";
import { hitTestLayers } from "./hitTest";
import { sameRef } from "../../state/editorStore";
import { useViewportStore } from "../../state/viewportStore";
import {
  selectedIdSet,
  applyAnchorDelta,
  editableLayers,
  refsInPolygon,
  leadPoint,
  dragDelta,
} from "./shared";
import { dragSnapFn } from "./snapGeometry";
import type { ToolDefinition, ToolPointerContext } from "./types";

/**
 * The Lasso tool: drag a freehand loop to select every node inside it, then drag
 * the selection. Its scope is the SELECTED layers (documentStore.selectedLayerIds
 * — just the active layer unless the user multi-selected more), so it can gather
 * nodes from several layers at once and move them together.
 *
 * Selection is layer-aware (PointRef[]); the move previews via the editor store's
 * liveContours (now applied across all layers) and commits once on release via
 * replaceContoursEverywhere — so a whole multi-layer drag is one undo step.
 */

type DragState =
  | { mode: "move"; origin: Contour[]; refs: PointRef[]; lead: PointRef; startRaw: Vec2 }
  | { mode: "lasso"; additive: boolean }
  | null;

// Module-scoped: the tool is a singleton, so this holds the gesture in flight.
let drag: DragState = null;

/** Flat contours of the (editable) layers that contain any of the given refs. */
function originForRefs(ctx: ToolPointerContext, refs: PointRef[]): Contour[] {
  const layerIds = new Set(refs.map((r) => r.layerId));
  const out: Contour[] = [];
  for (const l of ctx.glyph?.layers ?? []) {
    if (l.visible && !l.locked && layerIds.has(l.id)) out.push(...l.contours);
  }
  return out;
}

export const lassoTool: ToolDefinition = {
  id: "lasso",
  label: "Lasso",
  shortcut: "q",
  cursor: "crosshair",

  onPointerDown: (ctx) => {
    const topFirst = editableLayers(ctx).reverse();
    const hit = hitTestLayers(
      topFirst,
      ctx.viewport,
      ctx.screen,
      selectedIdSet(ctx.editor.selection),
    );

    // Pressing a node starts a move of the (whole) selection; pressing it while it
    // wasn't selected first selects it (Shift adds). Anything else starts a lasso.
    if (hit?.kind === "anchor") {
      if (hit.ref.layerId !== ctx.layer?.id) ctx.doc.setActiveLayer(hit.ref.layerId);
      const already = ctx.editor.selection.some((r) => sameRef(r, hit.ref));
      let refs: PointRef[];
      if (already) {
        refs = ctx.editor.selection;
      } else {
        refs = ctx.modifiers.shift ? [...ctx.editor.selection, hit.ref] : [hit.ref];
        ctx.editor.setSelection(refs);
      }
      drag = {
        mode: "move",
        origin: originForRefs(ctx, refs),
        refs,
        lead: hit.ref,
        startRaw: ctx.rawWorld,
      };
      return;
    }

    drag = { mode: "lasso", additive: ctx.modifiers.shift };
    ctx.editor.setLasso([{ x: ctx.rawWorld.x, y: ctx.rawWorld.y }]);
  },

  onPointerMove: (ctx) => {
    if (!ctx.isDown || !drag) return;
    if (drag.mode === "move") {
      // Snap the grabbed node's absolute position to the grid (see select.ts) — or to
      // a nearby anchor/path when snap-to-point is on (excluding the moving selection).
      const vp = useViewportStore.getState();
      const grid = vp.grid;
      const snapFn =
        vp.snapToGeometry && ctx.glyph
          ? dragSnapFn(ctx.glyph.layers.filter((l) => l.visible), ctx.viewport, drag.refs)
          : undefined;
      const lead = leadPoint(drag.origin, drag.lead);
      const d: Vec2 = lead
        ? dragDelta(lead, drag.startRaw, ctx.rawWorld, grid, snapFn)
        : { x: ctx.rawWorld.x - drag.startRaw.x, y: ctx.rawWorld.y - drag.startRaw.y };
      ctx.editor.setLiveContours(applyAnchorDelta(drag.origin, drag.refs, d));
      if ((grid.snap || vp.snapToGeometry) && lead) {
        ctx.editor.setCursor({
          raw: ctx.rawWorld,
          snapped: { x: lead.x + d.x, y: lead.y + d.y },
        });
      }
    } else {
      const path = ctx.editor.lasso ?? [];
      const last = path[path.length - 1];
      if (!last || last.x !== ctx.rawWorld.x || last.y !== ctx.rawWorld.y) {
        ctx.editor.setLasso([...path, { x: ctx.rawWorld.x, y: ctx.rawWorld.y }]);
      }
    }
  },

  onPointerUp: (ctx) => {
    if (!drag) return;
    if (drag.mode === "move") {
      const live = ctx.editor.liveContours;
      if (live) ctx.doc.replaceContoursEverywhere(live);
      ctx.editor.setLiveContours(null);
    } else {
      const ring = ctx.editor.lasso ?? [];
      const inside = refsInPolygon(editableLayers(ctx), ring);
      if (drag.additive) {
        const merged = [...ctx.editor.selection];
        for (const r of inside) if (!merged.some((m) => sameRef(m, r))) merged.push(r);
        ctx.editor.setSelection(merged);
      } else {
        ctx.editor.setSelection(inside);
      }
      ctx.editor.setLasso(null);
    }
    drag = null;
  },
};
