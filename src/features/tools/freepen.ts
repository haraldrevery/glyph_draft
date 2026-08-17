import { fitFreehand } from "../../engine/geometry/freehand";
import { useViewportStore } from "../../state/viewportStore";
import { createId } from "../../utils/id";
import { screenDistance } from "./hitTest";
import type { AnchorPoint, Contour } from "../../types/geometry";
import type { ToolDefinition } from "./types";

/**
 * Free-pen (pencil): drag to sketch, and on release the raw cursor trail is
 * simplified + fit to a smooth, editable bezier (`engine/geometry/freehand.ts`).
 * It reuses the shapes-tool gesture — `editor.draft` holds the growing RAW polyline
 * for the live preview AND is the input to the fit on release, so no extra editor
 * state is needed. Points are UNSNAPPED (`rawWorld`); the path lands as one contour
 * on the active layer in a single undo step.
 */

/** Minimum drag (px) before a release commits — filters stray clicks. */
const MIN_DRAG_PX = 2;
/** Minimum spacing (px) between recorded points — bounds the sample count. */
const SAMPLE_PX = 2;
/** End-near-start closing threshold (px). */
const CLOSE_PX = 8;

const corner = (x: number, y: number): AnchorPoint => ({ id: createId("pt"), type: "corner", x, y });

export const freepenTool: ToolDefinition = {
  id: "freepen",
  label: "Pencil",
  shortcut: "b",
  cursor: "crosshair",

  onPointerDown: (ctx) => {
    ctx.doc.ensureActiveTarget();
    ctx.editor.setDraft({
      id: createId("ct"),
      closed: false,
      points: [corner(ctx.rawWorld.x, ctx.rawWorld.y)],
    });
  },

  onPointerMove: (ctx) => {
    if (!ctx.isDown) return;
    const draft = ctx.editor.draft;
    if (!draft) return;
    const last = draft.points[draft.points.length - 1];
    // Sample only when the cursor has moved far enough (in screen px).
    if (last && screenDistance(last, ctx.screen, ctx.viewport) < SAMPLE_PX) return;
    ctx.editor.setDraft({ ...draft, points: [...draft.points, corner(ctx.rawWorld.x, ctx.rawWorld.y)] });
  },

  onPointerUp: (ctx) => {
    const draft = ctx.editor.draft;
    ctx.editor.setDraft(null);
    if (!draft || draft.points.length < 2) return;
    const moved =
      ctx.downWorld && screenDistance(ctx.downWorld, ctx.screen, ctx.viewport) >= MIN_DRAG_PX;
    if (!moved) return;

    // Smoothing slider is in SCREEN px → world units (zoom-independent feel).
    const zoom = ctx.viewport.zoom || 1;
    const tolerance = useViewportStore.getState().freehandSmoothing / zoom;
    const raw = draft.points.map((p) => ({ x: p.x, y: p.y }));
    const fit = fitFreehand(raw, { tolerance, closeTolerance: CLOSE_PX / zoom });
    if (fit.points.length < 2) return;
    const contour: Contour = { id: draft.id, closed: fit.closed, points: fit.points };
    ctx.doc.addContour(contour);
  },
};
