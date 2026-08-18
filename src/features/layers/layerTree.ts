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

/**
 * Layer ids inside `groupId` (recursively), computed from a FLAT group list plus any
 * objects carrying a `groupId` — for callers that hold the pieces rather than a whole
 * `Glyph` (the canvas renderer works on projected layers, not the document).
 * Cycle-safe. `groupMembers` is the Glyph-shaped equivalent.
 */
export function memberLayerIds(
  groups: LayerGroup[],
  layers: readonly { id: string; groupId?: string }[],
  groupId: string,
): string[] {
  const ids = new Set<string>([groupId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of groups) {
      if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
        ids.add(g.id);
        grew = true;
      }
    }
  }
  return layers.filter((l) => l.groupId && ids.has(l.groupId)).map((l) => l.id);
}

/** A Pathfinder operand: either a plain layer or a whole group. */
export interface SelectionUnit {
  id: string;
  name: string;
  isGroup: boolean;
  /** Position in the flat layers array — the lowest member for a group. Drives the
   *  upper(A)/lower(B) ordering, matching how the flattened render array is built. */
  at: number;
}

/**
 * Collapse a layer selection into UNITS: any group entirely inside the selection
 * becomes one unit, and everything else stays a layer.
 *
 * This is what lets a group act as a single Pathfinder operand — selecting a folder
 * selects all its members, which would otherwise read as N operands instead of one.
 * Uses the same "topmost fully-contained ancestor" rule as `documentStore.groupLayers`,
 * so grouping and pairing agree about what the user picked.
 */
export function selectionUnits(glyph: Glyph, layerIds: string[]): SelectionUnit[] {
  const selected = new Set(layerIds);
  const contained = (gid: string): boolean => {
    const ms = groupMembers(glyph, gid);
    return ms.length > 0 && ms.every((l) => selected.has(l.id));
  };
  const unitFor = (gid: string | undefined): string | null => {
    let best: string | null = null;
    for (const id of gid ? [gid, ...ancestors(glyph, gid).map((a) => a.id)] : []) {
      if (!contained(id)) break;
      best = id;
    }
    return best;
  };

  const seen = new Set<string>();
  const out: SelectionUnit[] = [];
  glyph.layers.forEach((l, at) => {
    if (!selected.has(l.id)) return;
    const unit = unitFor(l.groupId);
    if (unit) {
      if (seen.has(unit)) return;
      seen.add(unit);
      out.push({ id: unit, name: findGroup(glyph, unit)?.name ?? unit, isGroup: true, at });
    } else {
      if (seen.has(l.id)) return;
      seen.add(l.id);
      out.push({ id: l.id, name: l.name, isGroup: false, at });
    }
  });
  return out;
}

/**
 * The glyph's layers with GROUP INHERITANCE folded into `visible` / `locked`.
 *
 * This is how group visibility/lock reaches the ~20 call sites that already filter on
 * those two flags: they swap `glyph.layers` for `resolvedLayers(glyph)` and keep their
 * existing predicate. Without it, every one of those filters would need its own copy of
 * the ancestor walk.
 *
 * IDENTITY (Invariant 3): a glyph with no groups returns the SAME array reference, and
 * a layer no group affects keeps its own object. So an ungrouped document is completely
 * untouched — including the identity-keyed geometry caches — and a grouped one only
 * churns the layers a group actually changes. Call sites that feed a geometry memo
 * should still wrap this in `useMemo` on the glyph.
 */
export function resolvedLayers(glyph: Glyph): Layer[] {
  if (!glyph.layerGroups?.length) return glyph.layers;
  return glyph.layers.map((l) => {
    const visible = effectiveVisible(glyph, l);
    const locked = effectiveLocked(glyph, l);
    return visible === l.visible && locked === l.locked ? l : { ...l, visible, locked };
  });
}

/** Layer ids whose rows are currently visible (not inside a collapsed group). */
export function visibleLayerIds(glyph: Glyph): string[] {
  return glyph.layers.filter((l) => !underCollapsed(glyph, l.groupId)).map((l) => l.id);
}
