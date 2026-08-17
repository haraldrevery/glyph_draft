/**
 * Document model: one Glyph == one document == one exported SVG.
 * Fleshed out across Phases 3-4 (layers, glyph organization); defined here so
 * the temporal (undo/redo) store has a stable shape to grow into.
 */

import type { Contour } from "./geometry";

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  contours: Contour[];
  /** A flattened (merged) layer: its contours are FINAL baked geometry — rendered
   *  as-is (winding preserved for holes, no stroke expansion, no force-CW union).
   *  Set by the destructive "Merge layers" op; optional so old saves load unchanged. */
  baked?: boolean;
}

/** The four non-destructive Pathfinder boolean operations between two layers. */
export type BooleanOp = "union" | "subtract" | "intersect" | "exclude";

/** The op a layer-pair can carry: the 4 booleans, or `"blend"` — an A→B shape-morph
 *  "echo" (the 5th Pathfinder op). `BooleanOp` stays the 4 so `geom[op]` type-checks. */
export type PairOp = BooleanOp | "blend";

/**
 * A live, non-destructive operation between exactly two layers (the name is
 * historical — it now also covers `"blend"`). The result is computed at render and
 * export time (never by mutating data) — both source layers stay separate and fully
 * editable. `layerIds` is unordered; the renderer orders them by stack position so
 * the UPPER layer is operand A and the LOWER is B (Subtract = A − B). A layer may
 * belong to at most one pair.
 */
export interface BooleanPair {
  id: string;
  layerIds: [string, string];
  op: PairOp;
  /** For `op === "blend"` only: the number of in-between echo steps (default applied
   *  by the UI). Optional/additive so old saves load unchanged. */
  steps?: number;
}

export interface Glyph {
  /** Stable internal id, independent of codepoint (so unassigned glyphs work). */
  id: string;
  /** Unicode code point; drives the u_xxxx.svg export name. */
  codepoint: number;
  name: string;
  /** Horizontal advance in font units. */
  advanceWidth: number;
  layers: Layer[];
  /** Active between-layer boolean operations (non-destructive). */
  booleanPairs?: BooleanPair[];
}
