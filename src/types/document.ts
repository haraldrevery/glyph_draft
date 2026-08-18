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
  /** The `LayerGroup` this layer belongs to, if any (see `Glyph.layerGroups`).
   *  Optional/additive so old saves load unchanged; `undefined` = top level. */
  groupId?: string;
}

/**
 * A layer GROUP — an Illustrator-style folder over the flat `Glyph.layers` array.
 *
 * **The layers array stays FLAT.** Nesting comes from a group carrying a `parentId`,
 * NOT from nesting `Layer` objects — so arbitrary depth works while every existing
 * flat walk over `glyph.layers` (the tools, clipboard, geometry ops, the whole fill
 * pipeline) keeps working untouched. The tree is a VIEW computed over the flat array
 * by `features/layers/layerTree.ts`.
 *
 * **INVARIANT — contiguity:** a group's member layers occupy a contiguous run of
 * `glyph.layers`. That is what keeps paint order well-defined (a group cannot be
 * interleaved with outsiders) and makes the tree renderable. Every action that
 * inserts a layer must therefore place it inside the right run — see the store's
 * `groupLayers` / insert actions.
 */
export interface LayerGroup {
  id: string;
  name: string;
  /** Parent group, for nesting. `undefined` = a top-level group. */
  parentId?: string;
  /** Collapsed in the Layers panel (a view flag, but persisted with the document
   *  so the panel looks the same when a project is reopened). */
  collapsed?: boolean;
  /** Group-level visibility/lock. A layer is only editable when it AND every
   *  ancestor group are visible + unlocked (see `layerTree.effectiveVisible`). */
  visible: boolean;
  locked: boolean;
  /** Render the group's contents as ONE layer: their contours are baked into a
   *  single fill region (overlaps fuse), and the group can act as a single
   *  Pathfinder operand. Off ⇒ members render individually, exactly as if the
   *  group were only an organisational folder. */
  renderAsOne?: boolean;
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
  /** Layer groups (folders). Flat list; nesting is via `LayerGroup.parentId`.
   *  Optional/additive so old saves load unchanged. */
  layerGroups?: LayerGroup[];
}
