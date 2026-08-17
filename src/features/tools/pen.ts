import type { AnchorPoint, Contour } from "../../types/geometry";
import type { Vec2 } from "../../types/viewport";
import { createId } from "../../utils/id";
import { constrainAngle } from "../../engine/snapping/snap";
import { screenDistance, HIT_RADIUS, HANDLE_COLLAPSE_PX } from "./hitTest";
import type { ToolDefinition, ToolPointerContext } from "./types";

/**
 * The Pen tool, following Illustrator's grammar:
 *   - click            -> corner anchor
 *   - click-drag       -> smooth anchor; the drag pulls out mirrored handles
 *   - click near start  -> close the contour
 *   - Esc / Enter       -> finish the open path
 *
 * Mechanics that keep history clean: a point is built in the editor store's
 * `pen.pending` slot on press and during the handle drag (all ephemeral, no
 * history), and only COMMITTED to the document on release — so each anchor is
 * exactly one undo step, drag or no drag. The anchor itself is pinned at the
 * press location (downWorld) while the drag defines the handles.
 */

/** Find the contour the pen is currently extending, from a fresh glyph snapshot. */
function activeContour(ctx: ToolPointerContext): Contour | null {
  const id = ctx.editor.pen.contourId;
  if (!id || !ctx.layer) return null;
  return ctx.layer.contours.find((c) => c.id === id) ?? null;
}

function cornerPoint(id: string, at: Vec2): AnchorPoint {
  return { id, type: "corner", x: at.x, y: at.y };
}

function smoothPoint(id: string, anchor: Vec2, handleOut: Vec2): AnchorPoint {
  return {
    id,
    type: "smooth",
    x: anchor.x,
    y: anchor.y,
    handleOut,
    handleIn: { x: 2 * anchor.x - handleOut.x, y: 2 * anchor.y - handleOut.y },
  };
}

export const penTool: ToolDefinition = {
  id: "pen",
  label: "Pen",
  shortcut: "p",
  cursor: "crosshair",

  onPointerDown: (ctx) => {
    ctx.doc.ensureActiveTarget();
    const contour = activeContour(ctx);

    // A pen session tracks a contour on a specific layer. If that contour is no
    // longer on the active layer (e.g. the user made a new layer mid-draw), the
    // session is stale — abandon it so this click begins a fresh path here.
    if (ctx.editor.pen.contourId && !contour) ctx.editor.penEnd();

    // Close the path if pressing on the first anchor of a 2+ point contour.
    if (contour && contour.points.length >= 2) {
      const first = contour.points[0]!;
      if (screenDistance(first, ctx.screen, ctx.viewport) <= HIT_RADIUS) {
        ctx.doc.closeContour(contour.id);
        ctx.editor.penEnd();
        return;
      }
    }

    // Otherwise begin placing a corner anchor at the press point.
    ctx.editor.penSetPending(cornerPoint(createId("pt"), ctx.world));
  },

  onPointerMove: (ctx) => {
    if (!ctx.isDown) return; // hover preview is drawn from the live cursor
    const pending = ctx.editor.pen.pending;
    const anchor = ctx.downWorld;
    if (!pending || !anchor) return;

    // A drag past the threshold turns the pending corner into a smooth point
    // whose handles track the cursor (mirrored). Below threshold (including a
    // drag pulled back toward the anchor) it reverts to a corner, so a clean
    // click — or an undone drag — yields a corner anchor with no micro-curve.
    //
    // Handle position: Shift locks the angle to the nearest 45° (overriding the
    // grid, since on-grid AND on-ray rarely coincide); otherwise the handle uses
    // `handleWorld`, which is grid-snapped only when "handle grid lock" is on.
    if (screenDistance(anchor, ctx.screen, ctx.viewport) >= HANDLE_COLLAPSE_PX) {
      const handle = ctx.modifiers.shift
        ? constrainAngle(anchor, ctx.rawWorld, 45)
        : ctx.handleWorld;
      ctx.editor.penSetPending(smoothPoint(pending.id, anchor, handle));
    } else {
      ctx.editor.penSetPending(cornerPoint(pending.id, anchor));
    }
  },

  onPointerUp: (ctx) => {
    const pending = ctx.editor.pen.pending;
    if (!pending) return;

    const contourId = ctx.editor.pen.contourId;
    if (contourId) {
      ctx.doc.appendPoint(contourId, pending);
      ctx.editor.penSetPending(null);
    } else {
      // First point: create the contour, then track it for subsequent clicks.
      const contour: Contour = {
        id: createId("ct"),
        closed: false,
        points: [pending],
      };
      ctx.doc.addContour(contour);
      ctx.editor.penStart(contour.id); // also clears pending
    }
  },

  onKeyDown: (event, ctx) => {
    if (event.key === "Escape" || event.key === "Enter") {
      event.preventDefault();
      const id = ctx.editor.pen.contourId;
      if (id && ctx.layer) {
        const contour = ctx.layer.contours.find((c) => c.id === id);
        // A path with a single point is not useful — discard it.
        if (contour && contour.points.length < 2) ctx.doc.deleteContour(id);
      }
      ctx.editor.penEnd();
    }
  },
};
