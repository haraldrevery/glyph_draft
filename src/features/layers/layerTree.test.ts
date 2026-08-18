import { describe, it, expect } from "vitest";
import {
  ancestors,
  descendantGroups,
  directLayers,
  effectiveLocked,
  effectiveVisible,
  findGroup,
  groupMembers,
  groupRange,
  isContiguous,
  resolvedLayers,
  visibleRows,
} from "./layerTree";
import type { Glyph, Layer, LayerGroup } from "../../types/document";

const L = (id: string, groupId?: string, over: Partial<Layer> = {}): Layer => ({
  id,
  name: id,
  visible: true,
  locked: false,
  contours: [],
  ...(groupId ? { groupId } : {}),
  ...over,
});

const G = (id: string, parentId?: string, over: Partial<LayerGroup> = {}): LayerGroup => ({
  id,
  name: id,
  visible: true,
  locked: false,
  ...(parentId ? { parentId } : {}),
  ...over,
});

const glyph = (layers: Layer[], layerGroups: LayerGroup[] = []): Glyph => ({
  id: "G",
  codepoint: 0x41,
  name: "A",
  advanceWidth: 600,
  layers,
  ...(layerGroups.length ? { layerGroups } : {}),
});

/** Bottom-to-top: base, then group X holding x1/x2, then top. */
const nested = (): Glyph =>
  glyph(
    [L("base"), L("x1", "X"), L("x2", "X"), L("top")],
    [G("X")],
  );

/** X contains a nested group Y. Stack: base, x1, y1, y2, top. */
const deep = (): Glyph =>
  glyph(
    [L("base"), L("x1", "X"), L("y1", "Y"), L("y2", "Y"), L("top")],
    [G("X"), G("Y", "X")],
  );

describe("membership and lookup", () => {
  it("finds a group and its direct layers", () => {
    const g = nested();
    expect(findGroup(g, "X")?.name).toBe("X");
    expect(directLayers(g, "X").map((l) => l.id)).toEqual(["x1", "x2"]);
    expect(directLayers(g, undefined).map((l) => l.id)).toEqual(["base", "top"]);
  });

  it("groupMembers is recursive", () => {
    const g = deep();
    expect(groupMembers(g, "Y").map((l) => l.id)).toEqual(["y1", "y2"]);
    // X owns x1 directly and y1/y2 through the nested group Y.
    expect(groupMembers(g, "X").map((l) => l.id)).toEqual(["x1", "y1", "y2"]);
  });

  it("descendantGroups and ancestors mirror each other", () => {
    const g = deep();
    expect(descendantGroups(g, "X").map((x) => x.id)).toEqual(["Y"]);
    expect(descendantGroups(g, "Y")).toEqual([]);
    expect(ancestors(g, "Y").map((x) => x.id)).toEqual(["X"]);
    expect(ancestors(g, "X")).toEqual([]);
  });

  it("ancestors terminates on a corrupt parent cycle", () => {
    // A save could in principle carry X->Y->X; the walk must not hang.
    const g = glyph([L("a", "X")], [G("X", "Y"), G("Y", "X")]);
    expect(ancestors(g, "X").length).toBeLessThanOrEqual(2);
  });
});

describe("contiguity", () => {
  it("reports the group's slot in the flat array", () => {
    expect(groupRange(nested(), "X")).toEqual([1, 2]);
    expect(groupRange(deep(), "X")).toEqual([1, 3]); // spans its nested group too
    expect(groupRange(deep(), "Y")).toEqual([2, 3]);
  });

  it("an empty group has no range and is trivially contiguous", () => {
    const g = glyph([L("a")], [G("EMPTY")]);
    expect(groupRange(g, "EMPTY")).toBeNull();
    expect(isContiguous(g, "EMPTY")).toBe(true);
  });

  it("detects a broken run", () => {
    expect(isContiguous(nested(), "X")).toBe(true);
    // An outsider wedged between two members violates the invariant.
    const broken = glyph([L("x1", "X"), L("outsider"), L("x2", "X")], [G("X")]);
    expect(isContiguous(broken, "X")).toBe(false);
  });
});

describe("inherited visibility and lock", () => {
  it("a hidden group hides its members", () => {
    const g = glyph([L("base"), L("x1", "X")], [G("X", undefined, { visible: false })]);
    expect(effectiveVisible(g, g.layers[0]!)).toBe(true); // outside the group
    expect(effectiveVisible(g, g.layers[1]!)).toBe(false);
  });

  it("a locked group locks its members", () => {
    const g = glyph([L("x1", "X")], [G("X", undefined, { locked: true })]);
    expect(effectiveLocked(g, g.layers[0]!)).toBe(true);
  });

  it("inherits from EVERY ancestor, not just the nearest", () => {
    // Y itself is visible/unlocked; its parent X is not.
    const g = glyph(
      [L("y1", "Y")],
      [G("X", undefined, { visible: false, locked: true }), G("Y", "X")],
    );
    expect(effectiveVisible(g, g.layers[0]!)).toBe(false);
    expect(effectiveLocked(g, g.layers[0]!)).toBe(true);
  });

  it("the layer's own flags still win", () => {
    const g = glyph([L("x1", "X", { visible: false, locked: true })], [G("X")]);
    expect(effectiveVisible(g, g.layers[0]!)).toBe(false);
    expect(effectiveLocked(g, g.layers[0]!)).toBe(true);
  });

  it("a dangling groupId is treated as top level, not as hidden", () => {
    // Defensive: a pruned group must never make its ex-members invisible.
    const g = glyph([L("orphan", "GONE")]);
    expect(effectiveVisible(g, g.layers[0]!)).toBe(true);
    expect(effectiveLocked(g, g.layers[0]!)).toBe(false);
  });
});

describe("visibleRows", () => {
  const ids = (g: Glyph) =>
    visibleRows(g).map((r) => (r.group ? `[${r.group.id}]` : r.layer!.id));

  it("is TOP-DOWN, with the group row above its members", () => {
    // Stored bottom-to-top: base, x1, x2, top  →  displayed top-down.
    expect(ids(nested())).toEqual(["top", "[X]", "x2", "x1", "base"]);
  });

  it("indents by depth", () => {
    const rows = visibleRows(nested());
    expect(rows.map((r) => r.depth)).toEqual([0, 0, 1, 1, 0]);
  });

  it("a collapsed group hides its members but keeps its own row", () => {
    const g = glyph(
      [L("base"), L("x1", "X"), L("x2", "X"), L("top")],
      [G("X", undefined, { collapsed: true })],
    );
    expect(ids(g)).toEqual(["top", "[X]", "base"]);
  });

  it("nests groups within groups", () => {
    expect(ids(deep())).toEqual(["top", "[X]", "[Y]", "y2", "y1", "x1", "base"]);
    expect(visibleRows(deep()).map((r) => r.depth)).toEqual([0, 0, 1, 2, 2, 1, 0]);
  });

  it("a collapsed OUTER group hides the inner group too", () => {
    const g = glyph(
      [L("base"), L("x1", "X"), L("y1", "Y")],
      [G("X", undefined, { collapsed: true }), G("Y", "X")],
    );
    expect(ids(g)).toEqual(["[X]", "base"]);
  });

  it("an ungrouped document yields plain reversed rows", () => {
    const g = glyph([L("a"), L("b"), L("c")]);
    expect(ids(g)).toEqual(["c", "b", "a"]);
    expect(visibleRows(g).every((r) => r.depth === 0)).toBe(true);
  });

  it("keeps a childless group visible in the list", () => {
    const g = glyph([L("a")], [G("EMPTY")]);
    expect(ids(g)).toContain("[EMPTY]");
  });
});

describe("resolvedLayers", () => {
  it("returns the SAME array when there are no groups (identity preserved)", () => {
    const g = glyph([L("a"), L("b")]);
    expect(resolvedLayers(g)).toBe(g.layers);
  });

  it("keeps the identity of layers no group affects", () => {
    const g = glyph([L("out"), L("in", "X")], [G("X", undefined, { visible: false })]);
    const out = resolvedLayers(g);
    expect(out[0]).toBe(g.layers[0]); // untouched layer keeps its object
    expect(out[1]).not.toBe(g.layers[1]); // this one really changed
  });

  it("folds a hidden group into its members' visible flag", () => {
    const g = glyph([L("a", "X")], [G("X", undefined, { visible: false })]);
    expect(resolvedLayers(g)[0]!.visible).toBe(false);
  });

  it("folds a locked group into its members' locked flag", () => {
    const g = glyph([L("a", "X")], [G("X", undefined, { locked: true })]);
    expect(resolvedLayers(g)[0]!.locked).toBe(true);
  });

  it("inherits through nesting", () => {
    const g = glyph(
      [L("a", "Y")],
      [G("X", undefined, { visible: false }), G("Y", "X")],
    );
    expect(resolvedLayers(g)[0]!.visible).toBe(false);
  });

  it("never re-enables a layer the user hid individually", () => {
    const g = glyph([L("a", "X", { visible: false })], [G("X")]);
    expect(resolvedLayers(g)[0]!.visible).toBe(false);
  });
});
