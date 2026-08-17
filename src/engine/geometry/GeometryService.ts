import type { Contour, StrokeStyle } from "../../types/geometry";

/**
 * Isolation boundary for all heavy vector math: bezier evaluation, boolean
 * operations, and winding correction. This is a core architectural pillar — a
 * hallucinated or buggy implementation behind this interface can corrupt
 * geometry, but it can never reach the state store or layer/glyph management,
 * because those layers only ever see plain Contour data in and out.
 *
 * The concrete implementation (Paper.js) is added in Phase 2/5. Phase 1 ships
 * the contract only; nothing imports a real engine yet, so the app has zero
 * vector-math dependencies at this stage.
 */
export interface GeometryService {
  /** A ∪ B */
  union(a: Contour[], b: Contour[]): Contour[];
  /** A − B */
  subtract(a: Contour[], b: Contour[]): Contour[];
  /** A ∩ B */
  intersect(a: Contour[], b: Contour[]): Contour[];
  /** A ⊕ B (symmetric difference) */
  exclude(a: Contour[], b: Contour[]): Contour[];

  /**
   * Normalize winding so outer contours run clockwise and holes run
   * counter-clockwise — the convention FontForge expects on SVG import.
   */
  correctWinding(contours: Contour[]): Contour[];

  /**
   * Expand a path's centerline into the FILLED OUTLINE of a uniform-width stroke
   * (the non-destructive stroke). An open path yields one closed outline; a
   * closed path yields a frame (outer ring + counter-clockwise hole). Winding is
   * normalized like the boolean results. The input contour is never mutated.
   */
  expandStroke(contour: Contour, stroke: StrokeStyle): Contour[];

  /**
   * Render SEVERAL same-style halftone-stroked contours as ONE continuous halftone:
   * union their stroke bodies into one region and fill it with a single shared dot
   * grid (sized by distance to the MERGED shape), so abutting paths read as one tone
   * with no seam. `stroke` is the shared halftone style for the whole group. Returns
   * many small CW dot solids (the caller applies the shared paint). Halftone-only;
   * non-Paper impls may return []. The inputs are never mutated.
   */
  expandHalftoneGroup(contours: Contour[], stroke: StrokeStyle): Contour[];
}
