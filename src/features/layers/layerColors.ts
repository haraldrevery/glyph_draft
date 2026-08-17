/**
 * Per-layer editing colors. An auto-assigned palette (by the layer's position in
 * the stack) so each layer's paths + nodes on the canvas and its swatch in the
 * panel share one distinct color — making "which path is on which layer" obvious
 * and the existing click-a-node-to-activate-its-layer behavior discoverable.
 *
 * Purely an editing aid: it never touches the exported/filled glyph (always black).
 * Derived, not stored — so no document model change. One source of truth, used by
 * both the canvas selectors and the Layers panel so they always agree.
 */

/** Curated, mid-tone hues legible on both the dark and light canvas. */
const PALETTE = [
  "#5b9cff", // blue
  "#46c08a", // green
  "#e0a33a", // amber
  "#c563d6", // magenta
  "#e0686d", // red
  "#3ac0c0", // teal
  "#b6b24a", // olive
  "#8b86f0", // indigo
];

/** Color for the layer at `index` in the stack (cycles for large stacks). */
export function layerColor(index: number): string {
  return PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length]!;
}

/** Map each layer id to its color, assigned by position. Pass ids in stack order. */
export function layerColorMap(layerIds: string[]): Map<string, string> {
  return new Map(layerIds.map((id, i) => [id, layerColor(i)]));
}
