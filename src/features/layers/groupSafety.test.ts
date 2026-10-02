import { describe, it, expect } from "vitest";
import { useDocumentStore } from "../../state/documentStore";
import { mergeLayers } from "./mergeLayers";
import { findGroup, isContiguous } from "./layerTree";
import { glyphFillGroups } from "../canvas/layerFills";
import { getGeometryService } from "../../engine/geometry/geometryEngine";
import type { BooleanPair, Glyph, Layer, LayerGroup } from "../../types/document";
import type { Contour, Paint } from "../../types/geometry";

/**
 * Regression guards from the audit for layer GROUPS and locks. Each case was
 * reproduced against the real store / render pipeline before the fix:
 *  - grouping changed what rendered (stacking order, pair colour, dormant pairs);
 *  - merging a mid-group layer split the group's run (two fills with one id);
 *  - group locks were bypassed, leaving one contour id on two layers.
 */

const geom = getGeometryService();
const RED: Paint = { fill: "#ff0000" };

const sq = (id: string, o: number, paint?: Paint): Contour => ({
  id,
  closed: true,
  points: [
    [0, 0],
    [0, 100],
    [100, 100],
    [100, 0],
  ].map(([x, y], i) => ({ id: `${id}${i}`, type: "corner" as const, x: x! + o, y: y! + o })),
  ...(paint ? { paint } : {}),
});
const line = (id: string, x0: number, x1: number): Contour => ({
  id,
  closed: false,
  points: [
    { id: `${id}s`, type: "corner", x: x0, y: 0 },
    { id: `${id}e`, type: "corner", x: x1, y: 0 },
  ],
});
const lay = (id: string, contours: Contour[], over: Partial<Layer> = {}): Layer => ({
  id,
  name: id,
  visible: true,
  locked: false,
  contours,
  ...over,
});
const grp = (id: string, over: Partial<LayerGroup> = {}): LayerGroup => ({
  id,
  name: id,
  visible: true,
  locked: false,
  ...over,
});

function seed(layers: Layer[], extra: { layerGroups?: LayerGroup[]; booleanPairs?: BooleanPair[] } = {}) {
  const glyph: Glyph = { id: "G", codepoint: 0x41, name: "A", advanceWidth: 600, layers, ...extra };
  useDocumentStore.setState({
    glyphs: { G: glyph },
    activeGlyphId: "G",
    activeLayerId: layers[layers.length - 1]!.id,
    selectedLayerIds: [layers[layers.length - 1]!.id],
    activeGroupId: null,
  });
}
const state = () => useDocumentStore.getState();
const g = () => state().glyphs.G!;
const fills = () => glyphFillGroups(g(), geom).map((f) => `${f.paint?.fill ?? "black"}`);

describe("grouping is organisation-only by default", () => {
  it("a new group does not render as one", () => {
    seed([lay("a", [sq("a", 0)]), lay("b", [sq("b", 50)])]);
    const gid = state().groupLayers(["a", "b"])!;
    expect(findGroup(g(), gid)?.renderAsOne).toBeFalsy();
  });

  it("grouping black / red / black keeps the stacking order", () => {
    seed([lay("a", [sq("a", 0)]), lay("b", [sq("b", 25, RED)]), lay("c", [sq("c", 50)])]);
    const before = fills();
    state().groupLayers(["a", "b", "c"]);
    expect(fills()).toEqual(before); // ["black", "#ff0000", "black"] — red stays in the middle
  });

  it("grouping one operand of a pair keeps the boolean working", () => {
    seed([lay("b", [sq("b", 50)]), lay("a", [sq("a", 0)]), lay("c", [sq("c", 300)])], {
      booleanPairs: [{ id: "p", layerIds: ["a", "b"], op: "subtract" }],
    });
    const before = glyphFillGroups(g(), geom).map((f) => f.id);
    state().groupLayers(["a", "c"]);
    expect(glyphFillGroups(g(), geom).map((f) => f.id)).toEqual(before);
  });

  it("render-as-one can't be switched off while the group is a Pathfinder operand", () => {
    seed([lay("x", [sq("x", 0)]), lay("a", [sq("a", 50)], { groupId: "G1" })], {
      layerGroups: [grp("G1", { renderAsOne: true })],
      booleanPairs: [{ id: "p", layerIds: ["G1", "x"], op: "subtract" }],
    });
    state().setGroupRenderAsOne("G1", false);
    expect(findGroup(g(), "G1")?.renderAsOne).toBe(true);
  });
});

describe("baking keeps a boolean pair's colour", () => {
  it("merging a red Subtract pair keeps it red", () => {
    seed([lay("b", [sq("b", 50)]), lay("a", [sq("a", 0, RED)])], {
      booleanPairs: [{ id: "p", layerIds: ["a", "b"], op: "subtract" }],
    });
    mergeLayers(["a", "b"]);
    const merged = g().layers[0]!;
    expect(merged.contours.every((c) => c.baked)).toBe(true);
    expect(merged.contours.every((c) => c.paint?.fill === "#ff0000")).toBe(true);
  });

  it("a red pair inside a render-as-one group stays red", () => {
    seed(
      [lay("b", [sq("b", 50)], { groupId: "G7" }), lay("a", [sq("a", 0, RED)], { groupId: "G7" })],
      {
        layerGroups: [grp("G7", { renderAsOne: true })],
        booleanPairs: [{ id: "p", layerIds: ["a", "b"], op: "subtract" }],
      },
    );
    expect(fills()).toEqual(["#ff0000"]);
  });
});

describe("merge keeps groups contiguous", () => {
  it("merging a MIDDLE group member with an outside layer doesn't split the group", () => {
    seed(
      [
        lay("a", [sq("a", 0)], { groupId: "G" }),
        lay("b", [sq("b", 10)], { groupId: "G" }),
        lay("c", [sq("c", 20)], { groupId: "G" }),
        lay("o", [sq("o", 30)]),
      ],
      { layerGroups: [grp("G", { renderAsOne: true })] },
    );
    mergeLayers(["b", "o"]);
    expect(isContiguous(g(), "G")).toBe(true);
    const ids = glyphFillGroups(g(), geom).map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate fill ids (React keys)
  });
});

describe("group locks are honoured", () => {
  it("moving a path out of a layer in a LOCKED group does nothing (no duplicated id)", () => {
    seed([lay("src", [sq("s", 0)], { groupId: "LG" }), lay("dst", [])], {
      layerGroups: [grp("LG", { locked: true })],
    });
    state().moveContoursToLayer(["s"], "dst");
    const owners = g().layers.filter((l) => l.contours.some((c) => c.id === "s")).map((l) => l.id);
    expect(owners).toEqual(["src"]);
  });

  it("moving INTO a layer of a locked group is refused", () => {
    seed([lay("free", [sq("f", 0)]), lay("in", [], { groupId: "LG" })], {
      layerGroups: [grp("LG", { locked: true })],
    });
    state().moveContoursToLayer(["f"], "in");
    expect(g().layers[1]!.contours).toEqual([]);
  });

  it("moving to a NEW layer skips a locked group's paths", () => {
    seed([lay("src", [sq("s", 0)], { groupId: "LG" }), lay("other", [])], {
      layerGroups: [grp("LG", { locked: true })],
    });
    expect(state().moveContoursToNewLayer(["s"])).toBeNull();
  });

  it("merge-nodes can't consume a path in a locked group", () => {
    seed([lay("la", [line("A", 0, 10)], { groupId: "LG" }), lay("lb", [line("B", 10, 20)])], {
      layerGroups: [grp("LG", { locked: true })],
    });
    state().joinEndpoints(
      { layerId: "la", contourId: "A", pointId: "Ae" },
      { layerId: "lb", contourId: "B", pointId: "Bs" },
    );
    expect(g().layers[0]!.contours.map((c) => c.id)).toEqual(["A"]);
  });
});
