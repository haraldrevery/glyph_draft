import {
  makeEllipse,
  makeLine,
  makePolygon,
  makeRectangle,
} from "../../engine/geometry/primitives";
import { constrainAngle } from "../../engine/snapping/snap";
import { useViewportStore } from "../../state/viewportStore";
import { screenDistance } from "./hitTest";
import type { Contour } from "../../types/geometry";
import type { ToolDefinition, ToolPointerContext } from "./types";

/**
 * The primitive shape tools: rectangle, ellipse, and line. They share one
 * gesture — press to anchor a corner, drag to size — and differ only in the
 * factory they call. The in-progress shape is kept in the editor store's
 * `draft` slot for a live preview and committed to the document once on
 * release, so each shape is a single undo step. Endpoints use the snapped
 * cursor, so shapes land on the grid like everything else.
 */

/** Minimum drag (in pixels) before a release commits — filters out stray clicks. */
const MIN_DRAG_PX = 2;

type ShapeFactory = (ctx: ToolPointerContext) => Contour;

/** Equal-sided box (preserving each side's direction) — a square footprint for
 *  the Shift modifier, so rectangle→square, ellipse→circle, polygon→regular. */
export function squareBox(box: { x: number; y: number; width: number; height: number }) {
  const s = Math.max(Math.abs(box.width), Math.abs(box.height));
  return {
    x: box.x,
    y: box.y,
    width: Math.sign(box.width || 1) * s,
    height: Math.sign(box.height || 1) * s,
  };
}

/** Re-anchor a corner-anchored box so its anchor `(x,y)` becomes its CENTER: the box
 *  keeps its shape but grows symmetrically (used for "draw from center"). */
export function centerBox(box: { x: number; y: number; width: number; height: number }) {
  return {
    x: box.x - box.width,
    y: box.y - box.height,
    width: box.width * 2,
    height: box.height * 2,
  };
}

function box(ctx: ToolPointerContext) {
  const a = ctx.downWorld!;
  const b = ctx.world;
  // Square first (so the Shift constraint sizes the extent), then optionally re-center on
  // the start point — order matters so a square drawn from center stays square AND centered.
  let raw = { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
  if (ctx.modifiers.shift) raw = squareBox(raw);
  if (useViewportStore.getState().shapeFromCenter) raw = centerBox(raw);
  return raw;
}

const rectangleFactory: ShapeFactory = (ctx) => makeRectangle(box(ctx));
const ellipseFactory: ShapeFactory = (ctx) => makeEllipse(box(ctx));
const lineFactory: ShapeFactory = (ctx) =>
  makeLine(ctx.downWorld!, ctx.modifiers.shift ? constrainAngle(ctx.downWorld!, ctx.world, 45) : ctx.world);
// Polygon reads its side count from the viewport store (set in the View panel);
// triangle is a fixed 3-gon. Both inscribe in the drag box like the ellipse.
const polygonFactory: ShapeFactory = (ctx) =>
  makePolygon(box(ctx), useViewportStore.getState().polygonSides);
const triangleFactory: ShapeFactory = (ctx) => makePolygon(box(ctx), 3);

/** Build a shape tool from its factory; the rest of the behaviour is shared. */
function shapeTool(
  id: "rectangle" | "ellipse" | "line" | "polygon" | "triangle",
  label: string,
  shortcut: string,
  factory: ShapeFactory,
): ToolDefinition {
  return {
    id,
    label,
    shortcut,
    cursor: "crosshair",

    onPointerDown: (ctx) => {
      ctx.doc.ensureActiveTarget();
    },

    onPointerMove: (ctx) => {
      if (!ctx.isDown || !ctx.downWorld) return;
      ctx.editor.setDraft(factory(ctx));
    },

    onPointerUp: (ctx) => {
      const draft = ctx.editor.draft;
      const moved =
        ctx.downWorld &&
        screenDistance(ctx.downWorld, ctx.screen, ctx.viewport) >= MIN_DRAG_PX;
      if (draft && moved) ctx.doc.addContour(draft);
      ctx.editor.setDraft(null);
    },
  };
}

export const rectangleTool = shapeTool("rectangle", "Rectangle", "m", rectangleFactory);
export const ellipseTool = shapeTool("ellipse", "Ellipse", "e", ellipseFactory);
export const lineTool = shapeTool("line", "Line", "l", lineFactory);
export const polygonTool = shapeTool("polygon", "Polygon", "g", polygonFactory);
export const triangleTool = shapeTool("triangle", "Triangle", "t", triangleFactory);
