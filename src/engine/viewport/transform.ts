import type { Size, Vec2, Viewport } from "../../types/viewport";
import type { Box } from "../../constants/metrics";

/**
 * Coordinate transforms between WORLD space (font units, Y-up, baseline at 0)
 * and SCREEN space (CSS pixels, Y-down, origin at canvas top-left).
 *
 * Mapping (zoom = px per unit, pan = screen px of world origin):
 *   screenX = pan.x + worldX * zoom
 *   screenY = pan.y - worldY * zoom      <- minus flips Y-up to Y-down
 *
 * Every module that needs to position something on the canvas goes through
 * these functions; there is no other place where the Y-flip is encoded. Keeping
 * it in one pure module is what lets the SVG group, the overlay labels, and the
 * snap indicator all agree.
 */

export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 30;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function worldToScreen(p: Vec2, vp: Viewport): Vec2 {
  return { x: vp.pan.x + p.x * vp.zoom, y: vp.pan.y - p.y * vp.zoom };
}

export function screenToWorld(p: Vec2, vp: Viewport): Vec2 {
  return { x: (p.x - vp.pan.x) / vp.zoom, y: (vp.pan.y - p.y) / vp.zoom };
}

/**
 * SVG transform string for a <g> that holds world-space content. An element
 * drawn at world (x,y) inside this group lands at the correct screen pixel.
 * matrix(a,b,c,d,e,f) maps (x,y) -> (a*x + c*y + e, b*x + d*y + f).
 */
export function worldMatrix(vp: Viewport): string {
  return `matrix(${vp.zoom},0,0,${-vp.zoom},${vp.pan.x},${vp.pan.y})`;
}

/** Pan by a screen-pixel delta. */
export function panBy(vp: Viewport, dx: number, dy: number): Viewport {
  return { zoom: vp.zoom, pan: { x: vp.pan.x + dx, y: vp.pan.y + dy } };
}

/**
 * Zoom by `factor`, keeping the world point currently under `cursor` (screen
 * px) pinned beneath the cursor. This is the zoom-to-cursor behavior expected
 * from Illustrator-style tools.
 */
export function zoomAt(vp: Viewport, factor: number, cursor: Vec2): Viewport {
  const zoom = clampZoom(vp.zoom * factor);
  const world = screenToWorld(cursor, vp);
  // Solve worldToScreen(world, next) === cursor for the new pan.
  const pan: Vec2 = {
    x: cursor.x - world.x * zoom,
    y: cursor.y + world.y * zoom,
  };
  return { zoom, pan };
}

/**
 * Fit a world-space box into the canvas with padding (0..1 fraction of the
 * canvas used). Returns a viewport centering the box.
 */
export function fitToBox(canvas: Size, box: Box, padding = 0.8): Viewport {
  if (canvas.width <= 0 || canvas.height <= 0 || box.width <= 0 || box.height <= 0) {
    return { zoom: 1, pan: { x: 0, y: 0 } };
  }
  const zoom = clampZoom(
    Math.min((canvas.width * padding) / box.width, (canvas.height * padding) / box.height),
  );
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const pan: Vec2 = {
    x: canvas.width / 2 - cx * zoom,
    y: canvas.height / 2 + cy * zoom,
  };
  return { zoom, pan };
}

/** Visible world rectangle for the current viewport and canvas size. */
export function visibleWorldBounds(vp: Viewport, canvas: Size): Box {
  const tl = screenToWorld({ x: 0, y: 0 }, vp);
  const br = screenToWorld({ x: canvas.width, y: canvas.height }, vp);
  const minX = Math.min(tl.x, br.x);
  const minY = Math.min(tl.y, br.y);
  return {
    x: minX,
    y: minY,
    width: Math.abs(br.x - tl.x),
    height: Math.abs(br.y - tl.y),
  };
}
