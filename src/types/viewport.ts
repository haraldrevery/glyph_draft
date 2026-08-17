/**
 * Primitive geometry and viewport types shared across the canvas engine.
 * Kept dependency-free so any layer can import them without pulling in React
 * or the math engine.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * The viewport transform. `zoom` is screen pixels per font unit; `pan` is the
 * screen-pixel position (relative to the canvas top-left) of the world origin
 * (0,0). See engine/viewport/transform.ts for the world <-> screen mapping.
 *
 * The viewport is intentionally a small, flat value object so it can be passed
 * by value into pure transform functions and memoized cheaply.
 */
export interface Viewport {
  zoom: number;
  pan: Vec2;
}

export type Theme = "dark" | "light" | "paper";

export interface GridSettings {
  /** Spacing between grid lines, in font units. */
  size: number;
  visible: boolean;
  /** When true, drawing/editing operations quantize to the grid. */
  snap: boolean;
  /** When true, pen handles also quantize to the grid (independent of `snap`). */
  snapHandles: boolean;
}
