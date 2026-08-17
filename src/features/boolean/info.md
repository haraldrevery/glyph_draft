# Boolean (Pathfinder) — non-destructive, between two layers

The Pathfinder is **between two layers only** — never between elements of the
same layer (a single layer always fills as one solid union).

Workflow: Ctrl/Cmd+click exactly two layer rows → the **Pathfinder bar** appears
in the Layers panel → pick **Union / Subtract / Intersect / Exclude**. The
**upper** layer in the stack is operand **A**, the **lower** is **B**
(Subtract = A − B). The result renders live; **both source layers stay separate
and fully editable** — move or reshape either and the result updates instantly.
A layer may belong to **at most one** pair; re-pairing a layer drops its previous
pair. A pair badge on each row shows the op + role; click it to remove the pair.

Implementation:
- Pairing data: `Glyph.booleanPairs` (`documentStore.setBooleanPair` /
  `clearBooleanPair`, one undo step; pruned when a member layer is deleted).
- Render/export combine: `features/canvas/layerFills.ts` `buildFillGroups`, which
  calls the geometry service for paired layers and forces each unpaired layer to
  a solid union.
- Geometry: `engine/geometry/PaperGeometryService.ts` (Paper.js) computes
  **curve-exact** booleans behind the `GeometryService` seam — each operand layer
  is unioned ("fully rendered") before the op so complex layers don't glitch.
