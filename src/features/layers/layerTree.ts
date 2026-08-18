import type { Glyph, Layer, LayerGroup } from "../../types/document";

/**
 * The GROUP TREE as a pure view over the flat `Glyph.layers` array.
 *
 * `glyph.layers` stays flat and in bottom-to-top paint order (Invariant 5). Groups
 * live beside it in `glyph.layerGroups`, and nesting is expressed by a group's
 * `parentId` — never by nesting `Layer` objects. Everything that needs to *see* the
 * tree (the Layers panel, range-selection, layer colours, inherited visibility/lock,
 * the render pre-pass) goes through this module, so there is exactly one definition
 * of what the tree means.
 *
 * CONTIGUITY: a group's member layers occupy a contiguous run of `glyph.layers`.
 * The store maintains it; `groupRange` reads it back. Nothing here repairs a broken
 * run — the functions stay pure and total, and simply describe what is there.
 *
 * DOM-free and dependency-free, so it is unit-tested like the geometry engine.
 */

/** One row of the panel's flattened, collapse-aware list. */
export interface TreeRow {
  /** Nesting depth: 0 = top level. Drives indentation. */
  depth: number;
  /** Exactly one of these is set. */
  layer?: Layer;
  group?: LayerGroup;
}

const groupsOf = (glyph: Glyph): LayerGroup[] => glyph.layerGroups ?? [];

/** The group with this id, or undefined. */
export function findGroup(glyph: Glyph, groupId: string): LayerGroup | undefined {
  return groupsOf(glyph).find((g) => g.id === groupId);
}

/**
 * The ancestor chain of a group, nearest first (the group itself is NOT included).
 * Cycle-safe: a corrupt `parentId` loop terminates instead of hanging.
 */
export function ancestors(glyph: Glyph, groupId: string): LayerGroup[] {
  const out: LayerGroup[] = [];
  const seen = new Set<string>([groupId]);
  let cur = findGroup(glyph, groupId)?.parentId;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const g = findGroup(glyph, cur);
    if (!g) break;
    out.push(g);
    cur = g.parentId;
  }
  return out;
}

/** Direct child groups of `parentId` (top-level groups when `parentId` is undefined). */
export function childGroups(glyph: Glyph, parentId?: string): LayerGroup[] {
  return groupsOf(glyph).filter((g) => (g.parentId ?? undefined) === parentId);
}

/** Layers directly in `groupId` (top-level layers when `groupId` is undefined), in
 *  paint order (bottom-to-top, i.e. stored array order). */
export function directLayers(glyph: Glyph, groupId?: string): Layer[] {
  return glyph.layers.filter((l) => (l.groupId ?? undefined) === groupId);
}

/** Every descendant group of `groupId`, at any depth. */
export function descendantGroups(glyph: Glyph, groupId: string): LayerGroup[] {
  const out: LayerGroup[] = [];
  const walk = (id: string): void => {
    for (const g of childGroups(glyph, id)) {
      out.push(g);
      walk(g.id);
    }
  };
  walk(groupId);
  return out;
}

/**
 * Every layer inside `groupId`, at any depth, in paint order. This is the set a group
 * op (hide/lock/merge/render-as-one) applies to.
 */
export function groupMembers(glyph: Glyph, groupId: string): Layer[] {
  const ids = new Set<string>([groupId, ...descendantGroups(glyph, groupId).map((g) => g.id)]);
  return glyph.layers.filter((l) => l.groupId !== undefined && ids.has(l.groupId));
}

/**
 * The contiguous `[lo, hi]` slot a group occupies in `glyph.layers` (inclusive), or
 * null when the group holds no layers. Under the contiguity invariant every index in
 * between belongs to the group; a caller that needs certainty can check
 * `isContiguous`.
 */
export function groupRange(glyph: Glyph, groupId: string): [number, number] | null {
  const ids = new Set(groupMembers(glyph, groupId).map((l) => l.id));
  if (ids.size === 0) return null;
  let lo = -1;
  let hi = -1;
  glyph.layers.forEach((l, i) => {
    if (!ids.has(l.id)) return;
    if (lo < 0) lo = i;
    hi = i;
  });
  return [lo, hi];
}

/** True when the group's members really are one unbroken run (the invariant holds). */
export function isContiguous(glyph: Glyph, groupId: string): boolean {
  const range = groupRange(glyph, groupId);
  if (!range) return true; // an empty group is trivially contiguous
  const ids = new Set(groupMembers(glyph, groupId).map((l) => l.id));
  const [lo, hi] = range;
  for (let i = lo; i <= hi; i += 1) {
    if (!ids.has(glyph.layers[i]!.id)) return false;
  }
  return true;
}

/** True when `layer` and EVERY ancestor group of it are visible. */
export function effectiveVisible(glyph: Glyph, layer: Layer): boolean {
  if (!layer.visible) return false;
  return groupChainVisible(glyph, layer.groupId);
}

/** True when `layer` is unlocked AND no ancestor group is locked. */
export function effectiveLocked(glyph: Glyph, layer: Layer): boolean {
  if (layer.locked) return true;
  return groupChainLocked(glyph, layer.groupId);
}

/** Whether the whole group chain starting at `groupId` is visible. */
function groupChainVisible(glyph: Glyph, groupId?: string): boolean {
  if (!groupId) return true;
  const g = findGroup(glyph, groupId);
  if (!g) return true; // dangling groupId: treat the layer as top level
  if (!g.visible) return false;
  return ancestors(glyph, groupId).every((a) => a.visible);
}

/** Whether any group in the chain starting at `groupId` is locked. */
function groupChainLocked(glyph: Glyph, groupId?: string): boolean {
  if (!groupId) return false;
  const g = findGroup(glyph, groupId);
  if (!g) return false;
  if (g.locked) return true;
  return ancestors(glyph, groupId).some((a) => a.locked);
}

/** True when the row for this layer is hidden because an ancestor group is collapsed. */
function underCollapsed(glyph: Glyph, groupId?: string): boolean {
  if (!groupId) return false;
  const g = findGroup(glyph, groupId);
  if (!g) return false;
  if (g.collapsed) return true;
  return ancestors(glyph, groupId).some((a) => a.collapsed);
}

/**
 * The panel's row list, TOP-DOWN (Illustrator convention — the reverse of the stored
 * bottom-to-top paint order), honouring collapsed groups.
 *
 * This is the one flattening used by the panel, by Shift-range selection, and by the
 * layer-colour index, so those three can never disagree about what "the list" is.
 */
export function visibleRows(glyph: Glyph): TreeRow[] {
  const rows: TreeRow[] = [];

  // Walk one container (a group's children, or the top level) in TOP-DOWN order.
  const walk = (groupId: string | undefined, depth: number): void => {
    // Interleave this container's direct layers and child groups by stack position.
    // A group's position is its lowest member's index; a childless group sinks to the
    // bottom of its container (it has no geometry to order it by).
    const layers = directLayers(glyph, groupId);
    const groups = childGroups(glyph, groupId);
    const indexOfLayer = new Map(glyph.layers.map((l, i) => [l.id, i] as const));

    type Item = { at: number; layer?: Layer; group?: LayerGroup };
    const items: Item[] = [
      ...layers.map((l) => ({ at: indexOfLayer.get(l.id) ?? -1, layer: l })),
      ...groups.map((g) => {
        const r = groupRange(glyph, g.id);
        return { at: r ? r[0] : -1, group: g };
      }),
    ];
    // Bottom-to-top by stack position, then reversed below for top-down display.
    items.sort((a, b) => a.at - b.at);

    for (const it of items.reverse()) {
      if (it.group) {
        rows.push({ depth, group: it.group });
        if (!it.group.collapsed) walk(it.group.id, depth + 1);
      } else if (it.layer) {
        rows.push({ depth, layer: it.layer });
      }
    }
  };

  walk(undefined, 0);
  return rows;
}

/** Layer ids whose rows are currently visible (not inside a collapsed group). */
export function visibleLayerIds(glyph: Glyph): string[] {
  return glyph.layers.filter((l) => !underCollapsed(glyph, l.groupId)).map((l) => l.id);
}
