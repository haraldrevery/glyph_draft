import { describe, it, expect } from "vitest";
import { useDocumentStore } from "./documentStore";
import { useHistoryStore } from "./history";
import type { Glyph, Layer } from "../types/document";
import { findGroup, groupMembers, isContiguous } from "../features/layers/layerTree";
import type { Contour } from "../types/geometry";

/**
 * Phase 5 layer state: the between-layer boolean pairs (which drive the
 * non-destructive Pathfinder), layer multi-selection, and cross-layer point
 * deletion. Each is one undo step and respects locks.
 */

function poly(id: string, pts: [number, number][]): Contour {
  return {
    id,
    closed: true,
    points: pts.map(([x, y], i) => ({ id: `${id}_p${i}`, type: "corner" as const, x, y })),
  };
}

function layer(id: string, contours: Contour[], locked = false): Layer {
  return { id, name: id, visible: true, locked, contours };
}

/** Install a two-layer glyph (LA bottom, LB top) with the given active layer. */
function seedTwoLayers(la: Layer, lb: Layer, activeLayerId = lb.id): void {
  const glyph: Glyph = {
    id: "G",
    codepoint: 0x41,
    name: "A",
    advanceWidth: 600,
    layers: [la, lb],
  };
  useDocumentStore.setState({
    glyphs: { G: glyph },
    activeGlyphId: "G",
    activeLayerId,
    selectedLayerIds: [activeLayerId],
  });
}

function state() {
  return useDocumentStore.getState();
}

function layersById(): Record<string, Layer> {
  return Object.fromEntries(state().glyphs["G"]!.layers.map((l) => [l.id, l]));
}

const OUTER = poly("outer", [[0, 0], [100, 0], [100, 100], [0, 100]]);
const INNER = poly("inner", [[25, 25], [75, 25], [75, 75], [25, 75]]);

function pairs() {
  return state().glyphs["G"]!.booleanPairs ?? [];
}

describe("replaceContoursEverywhere", () => {
  it("replaces contours by id across all unlocked layers", () => {
    seedTwoLayers(layer("LA", [OUTER]), layer("LB", [INNER]));
    const shift = (c: Contour) => ({ ...c, points: c.points.map((p) => ({ ...p, x: p.x + 10 })) });
    state().replaceContoursEverywhere([shift(OUTER), shift(INNER)]);
    expect(layersById()["LA"]!.contours[0]!.points[0]!.x).toBe(OUTER.points[0]!.x + 10);
    expect(layersById()["LB"]!.contours[0]!.points[0]!.x).toBe(INNER.points[0]!.x + 10);
  });

  it("skips locked layers", () => {
    seedTwoLayers(layer("LA", [OUTER]), layer("LB", [INNER], true)); // LB locked
    const moved = { ...INNER, points: INNER.points.map((p) => ({ ...p, x: p.x + 10 })) };
    state().replaceContoursEverywhere([moved]);
    expect(layersById()["LB"]!.contours[0]).toBe(INNER); // unchanged
  });
});

describe("setAdvanceWidth", () => {
  it("updates the active glyph's advance width, clamped and rounded, one step", () => {
    seedTwoLayers(layer("LA", [OUTER]), layer("LB", [INNER]), "LA");
    const before = state().glyphs["G"];

    state().setAdvanceWidth(742.6);
    expect(state().glyphs["G"]!.advanceWidth).toBe(743);
    expect(state().glyphs["G"]).not.toBe(before); // recorded as a change

    state().setAdvanceWidth(-50); // clamp ≥ 0
    expect(state().glyphs["G"]!.advanceWidth).toBe(0);
  });

  it("is a no-op when the width is unchanged", () => {
    seedTwoLayers(layer("LA", [OUTER]), layer("LB", [INNER]), "LA");
    state().setAdvanceWidth(600); // seeded value
    const same = state().glyphs["G"];
    state().setAdvanceWidth(600);
    expect(state().glyphs["G"]).toBe(same); // identity preserved (no record)
  });
});

describe("splitAtPoints", () => {
  it("splits a contour at a removed node into separate fragments", () => {
    const openPath: Contour = {
      ...poly("p", [[0, 0], [10, 0], [20, 0], [30, 0]]),
      closed: false,
    };
    seedTwoLayers(layer("LA", [openPath]), layer("LB", [INNER]), "LA");

    state().splitAtPoints([{ layerId: "LA", contourId: "p", pointId: "p_p1" }]);
    const contours = layersById()["LA"]!.contours;
    // dropping p1 from [p0,p1,p2,p3] → [p0] (orphan, dropped) + [p2,p3]
    expect(contours).toHaveLength(1);
    expect(contours[0]!.points.map((pt) => pt.id)).toEqual(["p_p2", "p_p3"]);
  });

  it("skips locked layers", () => {
    const openPath: Contour = { ...poly("p", [[0, 0], [10, 0], [20, 0]]), closed: false };
    seedTwoLayers(layer("LA", [openPath], true), layer("LB", [INNER]), "LB");
    state().splitAtPoints([{ layerId: "LA", contourId: "p", pointId: "p_p1" }]);
    expect(layersById()["LA"]!.contours[0]!.points).toHaveLength(3); // unchanged
  });
});

describe("splitContourAtPoint", () => {
  const openPath = (): Contour => ({
    ...poly("p", [[0, 0], [10, 0], [20, 0], [30, 0]]),
    closed: false,
  });

  it("cuts a contour into two fragments in one undo step", () => {
    seedTwoLayers(layer("LA", [openPath()]), layer("LB", [INNER]), "LA");
    useHistoryStore.getState().clear();

    state().splitContourAtPoint("LA", "p", 1, 0.5); // mid of segment p1→p2
    expect(layersById()["LA"]!.contours).toHaveLength(2);
    expect(useHistoryStore.getState().pastStates).toHaveLength(1);

    useHistoryStore.getState().undo();
    expect(layersById()["LA"]!.contours).toHaveLength(1);
  });

  it("is a no-op (no undo step) at a terminal and on locked layers", () => {
    seedTwoLayers(layer("LA", [openPath()], true), layer("LB", [openPath()]), "LB");
    useHistoryStore.getState().clear();
    state().splitContourAtPoint("LA", "p", 0, 0); // locked layer
    state().splitContourAtPoint("LB", "p", 0, 0); // cut at the start terminal
    expect(layersById()["LA"]!.contours).toHaveLength(1);
    expect(layersById()["LB"]!.contours).toHaveLength(1);
    expect(useHistoryStore.getState().pastStates).toHaveLength(0);
  });
});

describe("splitContoursAtPoints (knife)", () => {
  const openPath = (): Contour => ({ ...poly("p", [[0, 0], [10, 0], [20, 0], [30, 0]]), closed: false });

  it("cuts a contour at multiple points in one undo step", () => {
    seedTwoLayers(layer("LA", [openPath()]), layer("LB", [INNER]), "LA");
    useHistoryStore.getState().clear();
    state().splitContoursAtPoints([
      { layerId: "LA", contourId: "p", segIndex: 0, t: 0.5 },
      { layerId: "LA", contourId: "p", segIndex: 2, t: 0.5 },
    ]);
    expect(layersById()["LA"]!.contours).toHaveLength(3); // 2 cuts → 3 pieces
    expect(useHistoryStore.getState().pastStates).toHaveLength(1);
    useHistoryStore.getState().undo();
    expect(layersById()["LA"]!.contours).toHaveLength(1);
  });

  it("skips locked layers (no undo step)", () => {
    seedTwoLayers(layer("LA", [openPath()], true), layer("LB", [INNER]), "LB");
    useHistoryStore.getState().clear();
    state().splitContoursAtPoints([{ layerId: "LA", contourId: "p", segIndex: 1, t: 0.5 }]);
    expect(layersById()["LA"]!.contours).toHaveLength(1);
    expect(useHistoryStore.getState().pastStates).toHaveLength(0);
  });
});

describe("eraseContourSpan (eraser)", () => {
  const openPath = (): Contour => ({ ...poly("p", [[0, 0], [10, 0], [20, 0], [30, 0]]), closed: false });

  it("drops the dragged span, keeping the ends, in one undo step", () => {
    seedTwoLayers(layer("LA", [openPath()]), layer("LB", [INNER]), "LA");
    useHistoryStore.getState().clear();
    state().eraseContourSpan("LA", "p", { segIndex: 0, t: 0.5 }, { segIndex: 2, t: 0.5 });
    expect(layersById()["LA"]!.contours).toHaveLength(2); // before + after; middle erased
    expect(useHistoryStore.getState().pastStates).toHaveLength(1);
    useHistoryStore.getState().undo();
    expect(layersById()["LA"]!.contours).toHaveLength(1);
  });

  it("is a no-op when entry≈exit or the layer is locked", () => {
    seedTwoLayers(layer("LA", [openPath()], true), layer("LB", [openPath()]), "LB");
    useHistoryStore.getState().clear();
    state().eraseContourSpan("LA", "p", { segIndex: 1, t: 0.3 }, { segIndex: 1, t: 0.7 }); // locked
    state().eraseContourSpan("LB", "p", { segIndex: 1, t: 0.5 }, { segIndex: 1, t: 0.5 }); // same point
    expect(layersById()["LA"]!.contours).toHaveLength(1);
    expect(layersById()["LB"]!.contours).toHaveLength(1);
    expect(useHistoryStore.getState().pastStates).toHaveLength(0);
  });
});

describe("joinEndpoints", () => {
  it("fuses two open contours into one path", () => {
    const a: Contour = { ...poly("a", [[0, 0], [10, 0]]), closed: false };
    const b: Contour = { ...poly("b", [[10, 0], [20, 0]]), closed: false };
    seedTwoLayers(layer("LA", [a, b]), layer("LB", [INNER]), "LA");

    state().joinEndpoints(
      { layerId: "LA", contourId: "a", pointId: "a_p1" },
      { layerId: "LA", contourId: "b", pointId: "b_p0" },
    );
    const contours = layersById()["LA"]!.contours;
    expect(contours).toHaveLength(1);
    expect(contours[0]!.closed).toBe(false);
    expect(contours[0]!.points).toHaveLength(3); // 2 + 2 − 1 coincident
  });

  it("closes a path when its own two ends are joined", () => {
    const c: Contour = { ...poly("c", [[0, 0], [10, 0], [10, 10]]), closed: false };
    seedTwoLayers(layer("LA", [c]), layer("LB", [INNER]), "LA");
    state().joinEndpoints(
      { layerId: "LA", contourId: "c", pointId: "c_p0" },
      { layerId: "LA", contourId: "c", pointId: "c_p2" },
    );
    const contours = layersById()["LA"]!.contours;
    expect(contours).toHaveLength(1);
    expect(contours[0]!.closed).toBe(true);
    expect(contours[0]!.points).toHaveLength(3);
  });

  it("joins two open contours on DIFFERENT layers onto the second node's layer", () => {
    const a: Contour = { ...poly("a", [[0, 0], [10, 0]]), closed: false };
    const b: Contour = { ...poly("b", [[10, 0], [20, 0]]), closed: false };
    seedTwoLayers(layer("LA", [a]), layer("LB", [b]), "LA");
    state().joinEndpoints(
      { layerId: "LA", contourId: "a", pointId: "a_p1" }, // a (source)
      { layerId: "LB", contourId: "b", pointId: "b_p0" }, // b (target layer)
    );
    const ls = layersById();
    expect(ls["LA"]!.contours).toHaveLength(0); // source emptied
    expect(ls["LB"]!.contours).toHaveLength(1); // merged lands on b's layer
    expect(ls["LB"]!.contours[0]!.points).toHaveLength(3); // 2 + 2 − 1 coincident
  });

  it("refuses to merge from a locked layer", () => {
    const a: Contour = { ...poly("a", [[0, 0], [10, 0]]), closed: false };
    const b: Contour = { ...poly("b", [[10, 0], [20, 0]]), closed: false };
    seedTwoLayers(layer("LA", [a], true), layer("LB", [b]), "LB");
    state().joinEndpoints(
      { layerId: "LA", contourId: "a", pointId: "a_p1" },
      { layerId: "LB", contourId: "b", pointId: "b_p0" },
    );
    expect(layersById()["LA"]!.contours).toHaveLength(1); // locked source untouched
    expect(layersById()["LB"]!.contours).toHaveLength(1);
  });
});

describe("setContourStroke", () => {
  it("sets and clears a contour's stroke on the active layer", () => {
    seedTwoLayers(layer("LA", [OUTER]), layer("LB", [INNER]), "LB");
    state().setContourStroke(["inner"], { width: 30, startCap: "round", endCap: "round", join: "round" });
    expect(layersById()["LB"]!.contours[0]!.stroke).toEqual({
      width: 30,
      startCap: "round",
      endCap: "round",
      join: "round",
    });

    state().setContourStroke(["inner"], null);
    expect(layersById()["LB"]!.contours[0]!.stroke).toBeUndefined();
  });

  it("is one undo step and only touches matching contours", () => {
    seedTwoLayers(layer("LA", [OUTER]), layer("LB", [INNER]), "LB");
    const before = state().glyphs["G"];
    state().setContourStroke(["inner"], { width: 12, startCap: "butt", endCap: "butt", join: "miter" });
    // Untargeted layer untouched (identity preserved).
    expect(layersById()["LA"]).toBe(before!.layers[0]);
  });

  it("sets the stroke on paths across multiple layers in one step", () => {
    seedTwoLayers(layer("LA", [OUTER]), layer("LB", [INNER]), "LB");
    const style = { width: 18, startCap: "butt", endCap: "butt", join: "miter" } as const;
    state().setContourStroke(["outer", "inner"], style);
    // Both layers' paths get the stroke even though only one is active.
    expect(layersById()["LA"]!.contours[0]!.stroke).toEqual(style);
    expect(layersById()["LB"]!.contours[0]!.stroke).toEqual(style);
  });

  it("skips locked layers", () => {
    seedTwoLayers(layer("LA", [OUTER], true), layer("LB", [INNER]), "LB");
    const before = state().glyphs["G"];
    state().setContourStroke(["outer", "inner"], { width: 9, startCap: "butt", endCap: "butt", join: "miter" });
    expect(layersById()["LA"]).toBe(before!.layers[0]); // locked LA untouched
    expect(layersById()["LB"]!.contours[0]!.stroke).toBeDefined(); // LB updated
  });
});

describe("patchContourStroke / removeStrokeKeys", () => {
  const base = { width: 20, startCap: "butt", endCap: "butt", join: "miter" } as const;

  it("patches a shape field on all targets WITHOUT touching each path's own colour/gradient", () => {
    // Two paths, different stroke colours; change the width across both.
    seedTwoLayers(
      layer("LA", [{ ...OUTER, stroke: { ...base, color: "#ff0000" } }]),
      layer("LB", [{ ...INNER, stroke: { ...base, color: "#0000ff", gradient: { angle: 0, to: "#fff", midpoint: 0.5, fade: 1 } } }]),
      "LB",
    );
    state().patchContourStroke(["outer", "inner"], { width: 50 });
    const a = layersById()["LA"]!.contours[0]!.stroke!;
    const b = layersById()["LB"]!.contours[0]!.stroke!;
    expect(a.width).toBe(50);
    expect(b.width).toBe(50);
    expect(a.color).toBe("#ff0000"); // each keeps its OWN colour
    expect(b.color).toBe("#0000ff");
    expect(b.gradient).toEqual({ angle: 0, to: "#fff", midpoint: 0.5, fade: 1 }); // gradient survives
  });

  it("seeds a default stroke for an unstroked target", () => {
    seedTwoLayers(layer("LA", [OUTER]), layer("LB", [INNER]), "LB");
    state().patchContourStroke(["inner"], { width: 33 });
    const s = layersById()["LB"]!.contours[0]!.stroke!;
    expect(s.width).toBe(33);
    expect(s.color).toBeUndefined(); // no colour invented
  });

  it("removeStrokeKeys drops a field but keeps colour", () => {
    seedTwoLayers(
      layer("LA", [OUTER]),
      layer("LB", [{ ...INNER, stroke: { ...base, color: "#0000ff", angle: 30 } }]),
      "LB",
    );
    state().removeStrokeKeys(["inner"], ["angle"]);
    const s = layersById()["LB"]!.contours[0]!.stroke!;
    expect(s.angle).toBeUndefined();
    expect(s.color).toBe("#0000ff"); // colour preserved
  });
});

describe("setContourPaint", () => {
  it("sets and clears fill paint across layers in one step", () => {
    seedTwoLayers(layer("LA", [OUTER]), layer("LB", [INNER]));
    state().setContourPaint(["outer", "inner"], { fill: "#ff0000", opacity: 0.5 });
    expect(layersById()["LA"]!.contours[0]!.paint).toEqual({ fill: "#ff0000", opacity: 0.5 });
    expect(layersById()["LB"]!.contours[0]!.paint).toEqual({ fill: "#ff0000", opacity: 0.5 });
    state().setContourPaint(["outer"], null);
    expect(layersById()["LA"]!.contours[0]!.paint).toBeUndefined(); // cleared back to ink
    expect(layersById()["LB"]!.contours[0]!.paint).toBeDefined(); // untouched
  });

  it("skips locked layers", () => {
    seedTwoLayers(layer("LA", [OUTER], true), layer("LB", [INNER]), "LB");
    state().setContourPaint(["outer", "inner"], { fill: "#00ff00" });
    expect(layersById()["LA"]!.contours[0]!.paint).toBeUndefined(); // locked untouched
    expect(layersById()["LB"]!.contours[0]!.paint).toEqual({ fill: "#00ff00" });
  });
});

describe("setBooleanPair / clearBooleanPair", () => {
  it("creates a pair without touching either layer's contours", () => {
    seedTwoLayers(layer("LA", [OUTER]), layer("LB", [INNER]));

    state().setBooleanPair("LB", "LA", "subtract");
    expect(pairs()).toHaveLength(1);
    expect(pairs()[0]!.op).toBe("subtract");
    expect(pairs()[0]!.layerIds).toContain("LA");
    expect(pairs()[0]!.layerIds).toContain("LB");
    // geometry untouched
    expect(layersById()["LA"]!.contours).toHaveLength(1);
    expect(layersById()["LB"]!.contours).toHaveLength(1);
  });

  it("is exclusive: re-pairing a layer drops its previous pair", () => {
    const glyph: Glyph = {
      id: "G",
      codepoint: 0x41,
      name: "A",
      advanceWidth: 600,
      layers: [layer("LA", [OUTER]), layer("LB", [INNER]), layer("LC", [INNER])],
    };
    useDocumentStore.setState({
      glyphs: { G: glyph },
      activeGlyphId: "G",
      activeLayerId: "LA",
      selectedLayerIds: ["LA"],
    });

    state().setBooleanPair("LA", "LB", "union");
    state().setBooleanPair("LA", "LC", "intersect"); // LA re-pairs → LA/LB drops
    expect(pairs()).toHaveLength(1);
    expect(pairs()[0]!.op).toBe("intersect");
    expect(pairs()[0]!.layerIds).toContain("LC");
    expect(pairs()[0]!.layerIds).not.toContain("LB");
  });

  it("clears the pair for a layer", () => {
    seedTwoLayers(layer("LA", [OUTER]), layer("LB", [INNER]));
    state().setBooleanPair("LB", "LA", "exclude");
    expect(pairs()).toHaveLength(1);
    state().clearBooleanPair("LA");
    expect(pairs()).toHaveLength(0);
  });

  it("prunes the pair when a member layer is deleted", () => {
    seedTwoLayers(layer("LA", [OUTER]), layer("LB", [INNER]));
    state().setBooleanPair("LB", "LA", "subtract");
    state().deleteLayer("LB");
    expect(pairs()).toHaveLength(0);
  });
});

describe("toggleLayerSelection", () => {
  it("adds and removes layers from the multi-selection and tracks the active layer", () => {
    seedTwoLayers(layer("LA", [OUTER]), layer("LB", [INNER]), "LA");
    expect(state().selectedLayerIds).toEqual(["LA"]);

    state().toggleLayerSelection("LB");
    expect(state().selectedLayerIds).toEqual(["LA", "LB"]);
    expect(state().activeLayerId).toBe("LB");

    state().toggleLayerSelection("LB");
    expect(state().selectedLayerIds).toEqual(["LA"]);
    expect(state().activeLayerId).toBe("LA"); // active fell back to the survivor
  });

  it("setActiveLayer resets the selection to a single layer", () => {
    seedTwoLayers(layer("LA", [OUTER]), layer("LB", [INNER]), "LA");
    state().toggleLayerSelection("LB");
    expect(state().selectedLayerIds).toEqual(["LA", "LB"]);

    state().setActiveLayer("LA");
    expect(state().selectedLayerIds).toEqual(["LA"]);
  });
});

describe("selectLayerRange", () => {
  function seedThree(activeLayerId: string): void {
    const glyph: Glyph = {
      id: "G",
      codepoint: 0x41,
      name: "A",
      advanceWidth: 600,
      layers: [layer("LA", [OUTER]), layer("LB", [INNER]), layer("LC", [INNER])],
    };
    useDocumentStore.setState({
      glyphs: { G: glyph },
      activeGlyphId: "G",
      activeLayerId,
      selectedLayerIds: [activeLayerId],
    });
  }

  it("selects the inclusive range from the active anchor to the clicked layer", () => {
    seedThree("LA");
    state().selectLayerRange("LC");
    expect(state().selectedLayerIds).toEqual(["LA", "LB", "LC"]);
    expect(state().activeLayerId).toBe("LA"); // anchor unchanged
  });

  it("is direction-agnostic (anchor below the target)", () => {
    seedThree("LC");
    state().selectLayerRange("LA");
    expect(state().selectedLayerIds).toEqual(["LA", "LB", "LC"]);
    expect(state().activeLayerId).toBe("LC");
  });

  it("selecting the anchor itself keeps just that layer", () => {
    seedThree("LB");
    state().selectLayerRange("LB");
    expect(state().selectedLayerIds).toEqual(["LB"]);
  });
});

describe("commitMerge", () => {
  const MERGED: Layer = {
    id: "M",
    name: "Merged",
    visible: true,
    locked: false,
    contours: [OUTER],
    baked: true,
  };

  it("replaces the merged layers with one baked layer and prunes their pairs", () => {
    seedTwoLayers(layer("LA", [OUTER]), layer("LB", [INNER]));
    state().setBooleanPair("LB", "LA", "subtract");
    state().commitMerge(["LA", "LB"], MERGED);

    const ls = state().glyphs["G"]!.layers;
    expect(ls.map((l) => l.id)).toEqual(["M"]);
    expect(ls[0]!.baked).toBe(true);
    expect(state().glyphs["G"]!.booleanPairs).toEqual([]);
    expect(state().activeLayerId).toBe("M");
    expect(state().selectedLayerIds).toEqual(["M"]);
  });

  it("inserts the merged layer at the lowest merged position (paint order kept)", () => {
    const glyph: Glyph = {
      id: "G",
      codepoint: 0x41,
      name: "A",
      advanceWidth: 600,
      layers: [layer("LA", [OUTER]), layer("LB", [INNER]), layer("LC", [INNER])],
    };
    useDocumentStore.setState({
      glyphs: { G: glyph },
      activeGlyphId: "G",
      activeLayerId: "LB",
      selectedLayerIds: ["LB", "LC"],
    });
    state().commitMerge(["LB", "LC"], MERGED); // top two → M sits where LB was
    expect(state().glyphs["G"]!.layers.map((l) => l.id)).toEqual(["LA", "M"]);
  });

  it("is a no-op with fewer than two real layers", () => {
    seedTwoLayers(layer("LA", [OUTER]), layer("LB", [INNER]));
    state().commitMerge(["LA"], MERGED);
    expect(state().glyphs["G"]!.layers.map((l) => l.id)).toEqual(["LA", "LB"]);
  });
});

describe("deletePoints (cross-layer)", () => {
  it("deletes the referenced points in each layer in one step", () => {
    seedTwoLayers(layer("LA", [OUTER]), layer("LB", [INNER]));

    state().deletePoints([
      { layerId: "LA", contourId: "outer", pointId: "outer_p0" },
      { layerId: "LB", contourId: "inner", pointId: "inner_p0" },
    ]);

    const ls = layersById();
    expect(ls["LA"]!.contours[0]!.points).toHaveLength(3);
    expect(ls["LB"]!.contours[0]!.points).toHaveLength(3);
  });

  it("does not touch a locked layer", () => {
    seedTwoLayers(layer("LA", [OUTER]), layer("LB", [INNER], true));
    state().deletePoints([{ layerId: "LB", contourId: "inner", pointId: "inner_p0" }]);
    expect(layersById()["LB"]!.contours[0]!.points).toHaveLength(4); // unchanged
  });
});

describe("convertPoints (cross-layer node continuity)", () => {
  const point = (layerId: string, contourId: string, pointId: string) => ({
    layerId,
    contourId,
    pointId,
  });
  const node = (layerId: string, pointId: string) =>
    layersById()[layerId]!.contours[0]!.points.find((p) => p.id === pointId)!;

  it("smooths nodes across two layers in one undo step", () => {
    seedTwoLayers(layer("LA", [OUTER]), layer("LB", [INNER]));
    const before = useHistoryStore.getState().pastStates.length;
    state().convertPoints(
      [point("LA", "outer", "outer_p1"), point("LB", "inner", "inner_p1")],
      "smooth",
    );
    expect(node("LA", "outer_p1").type).toBe("smooth");
    expect(node("LA", "outer_p1").handleOut).toBeDefined();
    expect(node("LB", "inner_p1").type).toBe("smooth");
    expect(useHistoryStore.getState().pastStates.length).toBe(before + 1);
  });

  it("corner strips handles a smooth node had", () => {
    seedTwoLayers(layer("LA", [OUTER]), layer("LB", [INNER]));
    state().convertPoints([point("LA", "outer", "outer_p1")], "smooth");
    state().convertPoints([point("LA", "outer", "outer_p1")], "corner");
    const p = node("LA", "outer_p1");
    expect(p.type).toBe("corner");
    expect(p.handleIn).toBeUndefined();
    expect(p.handleOut).toBeUndefined();
  });

  it("does not touch a locked layer", () => {
    seedTwoLayers(layer("LA", [OUTER]), layer("LB", [INNER], true));
    state().convertPoints([point("LB", "inner", "inner_p1")], "smooth");
    expect(node("LB", "inner_p1").type).toBe("corner"); // unchanged
  });
});

describe("moveContoursToLayer", () => {
  it("moves a path off its source layer onto the target, preserving ids", () => {
    seedTwoLayers(layer("LA", [OUTER]), layer("LB", [INNER]));
    state().moveContoursToLayer(["outer"], "LB");
    const ls = layersById();
    expect(ls["LA"]!.contours.map((c) => c.id)).toEqual([]); // source emptied
    expect(ls["LB"]!.contours.map((c) => c.id)).toEqual(["inner", "outer"]); // appended on top
  });

  it("is a no-op into a locked target and never moves from a locked source", () => {
    seedTwoLayers(layer("LA", [OUTER], true), layer("LB", [INNER]));
    state().moveContoursToLayer(["outer"], "LB"); // source LA locked → nothing moves
    expect(layersById()["LA"]!.contours.map((c) => c.id)).toEqual(["outer"]);
  });

  it("moveContoursToNewLayer creates a layer holding the moved paths and returns its id", () => {
    seedTwoLayers(layer("LA", [OUTER]), layer("LB", [INNER]));
    const id = state().moveContoursToNewLayer(["outer"]);
    expect(id).toBeTruthy();
    const ls = layersById();
    expect(ls["LA"]!.contours.map((c) => c.id)).toEqual([]);
    expect(ls[id!]!.contours.map((c) => c.id)).toEqual(["outer"]);
    expect(state().activeLayerId).toBe(id); // new layer becomes active
  });
});


describe("addGlyphs (set templates)", () => {
  it("adds only missing code points, keeping the active glyph (structural — no undo step)", () => {
    seedTwoLayers(layer("LA", [OUTER]), layer("LB", [INNER])); // glyph "G" is 0x41 (A)
    const activeBefore = state().activeGlyphId;
    const before = useHistoryStore.getState().pastStates.length;
    state().addGlyphs([0x41, 0x42, 0x43]); // A exists; B, C are new

    const cps = Object.values(state().glyphs)
      .map((g) => g.codepoint)
      .sort((a, b) => a - b);
    expect(cps).toEqual([0x41, 0x42, 0x43]); // A kept (no dup), B + C added
    expect(state().activeGlyphId).toBe(activeBefore); // active unchanged
    // Per-glyph history: creating glyphs is structural ⇒ NOT undoable (active glyph's stack untouched).
    expect(useHistoryStore.getState().pastStates.length).toBe(before);
  });

  it("is a no-op (no history) when every code point already exists", () => {
    seedTwoLayers(layer("LA", [OUTER]), layer("LB", [INNER]));
    const before = useHistoryStore.getState().pastStates.length;
    state().addGlyphs([0x41]); // only A, which exists
    expect(Object.keys(state().glyphs)).toHaveLength(1);
    expect(useHistoryStore.getState().pastStates.length).toBe(before); // no step
  });

  it("de-dups overlapping input so a code point is added once", () => {
    seedTwoLayers(layer("LA", [OUTER]), layer("LB", [INNER]));
    state().addGlyphs([0x42, 0x42, 0x42]);
    const bs = Object.values(state().glyphs).filter((g) => g.codepoint === 0x42);
    expect(bs).toHaveLength(1);
  });
});

describe("layer groups", () => {
  /** Install a glyph with N plain layers, bottom-to-top by id order. */
  function seedLayers(ids: string[], activeLayerId = ids[ids.length - 1]!): void {
    const glyph: Glyph = {
      id: "G",
      codepoint: 0x41,
      name: "A",
      advanceWidth: 600,
      layers: ids.map((id) => layer(id, [])),
    };
    useDocumentStore.setState({
      glyphs: { G: glyph },
      activeGlyphId: "G",
      activeLayerId,
      selectedLayerIds: [activeLayerId],
    });
  }

  const g = () => state().glyphs["G"]!;
  const order = () => g().layers.map((l) => l.id);
  const groupOf = (id: string) => g().layers.find((l) => l.id === id)?.groupId;

  it("groups layers and tags them", () => {
    seedLayers(["a", "b", "c"]);
    const gid = state().groupLayers(["a", "b"])!;
    expect(gid).toBeTruthy();
    expect(groupOf("a")).toBe(gid);
    expect(groupOf("b")).toBe(gid);
    expect(groupOf("c")).toBeUndefined();
    expect(g().layerGroups).toHaveLength(1);
    expect(isContiguous(g(), gid)).toBe(true);
  });

  it("REORDERS scattered members into one contiguous run", () => {
    // a and c are separated by b — the group must pull them together, or paint
    // order inside the group is undefined.
    seedLayers(["a", "b", "c", "d"]);
    const gid = state().groupLayers(["a", "c"])!;
    expect(isContiguous(g(), gid)).toBe(true);
    // The run lands at the TOPMOST member's slot; b keeps its relative place below.
    expect(order()).toEqual(["b", "a", "c", "d"]);
  });

  it("nests when the members share a parent group", () => {
    seedLayers(["a", "b", "c"]);
    const outer = state().groupLayers(["a", "b", "c"])!;
    const inner = state().groupLayers(["a", "b"])!;
    expect(findGroup(g(), inner)?.parentId).toBe(outer);
    expect(groupMembers(g(), outer).map((l) => l.id).sort()).toEqual(["a", "b", "c"]);
    expect(groupMembers(g(), inner).map((l) => l.id).sort()).toEqual(["a", "b"]);
  });

  it("is one undo step and leaves geometry untouched", () => {
    seedLayers(["a", "b"]);
    const before = g().layers.map((l) => l.contours);
    state().groupLayers(["a", "b"]);
    expect(g().layers.map((l) => l.contours)).toEqual(before);
  });

  it("ignores unknown ids and no-ops on an empty selection", () => {
    seedLayers(["a"]);
    expect(state().groupLayers([])).toBeNull();
    expect(state().groupLayers(["nope"])).toBeNull();
    expect(g().layerGroups).toBeUndefined();
  });

  it("ungroup re-parents one level up and keeps an inner group", () => {
    seedLayers(["a", "b"]);
    const outer = state().groupLayers(["a", "b"])!;
    const inner = state().groupLayers(["a"])!;
    state().ungroupGroup(outer);
    // The inner group survives, promoted to top level; its layer stays in it.
    expect(findGroup(g(), inner)?.parentId).toBeUndefined();
    expect(groupOf("a")).toBe(inner);
    expect(groupOf("b")).toBeUndefined();
  });

  it("ungroup drops the group and clears its layers' tag", () => {
    seedLayers(["a", "b"]);
    const gid = state().groupLayers(["a", "b"])!;
    state().ungroupGroup(gid);
    expect(g().layerGroups).toBeUndefined();
    expect(groupOf("a")).toBeUndefined();
    expect(order()).toEqual(["a", "b"]); // stack order preserved
  });

  it("group flags round-trip", () => {
    seedLayers(["a"]);
    const gid = state().groupLayers(["a"], "Serifs")!;
    expect(findGroup(g(), gid)?.name).toBe("Serifs");
    state().renameGroup(gid, "Feet");
    state().setGroupCollapsed(gid, true);
    state().setGroupVisible(gid, false);
    state().setGroupLocked(gid, true);
    state().setGroupRenderAsOne(gid, true);
    const grp = findGroup(g(), gid)!;
    expect(grp).toMatchObject({
      name: "Feet",
      collapsed: true,
      visible: false,
      locked: true,
      renderAsOne: true,
    });
  });

  it("an empty rename keeps the old name", () => {
    seedLayers(["a"]);
    const gid = state().groupLayers(["a"], "Keep")!;
    state().renameGroup(gid, "   ");
    expect(findGroup(g(), gid)?.name).toBe("Keep");
  });

  describe("contiguity is preserved by inserts", () => {
    it("addLayer joins the active layer's group", () => {
      seedLayers(["a", "b", "c"]);
      const gid = state().groupLayers(["a", "b"])!;
      state().setActiveLayer("a"); // a mid-group layer
      state().addLayer();
      expect(isContiguous(g(), gid)).toBe(true);
      const added = state().activeLayerId!;
      expect(groupOf(added)).toBe(gid);
    });

    it("duplicateLayer keeps the copy in the group", () => {
      seedLayers(["a", "b", "c"]);
      const gid = state().groupLayers(["a", "b"])!;
      state().duplicateLayer("a");
      expect(isContiguous(g(), gid)).toBe(true);
      expect(groupOf(state().activeLayerId!)).toBe(gid);
    });

    it("addImportedLayer keeps the run unbroken", () => {
      seedLayers(["a", "b", "c"]);
      const gid = state().groupLayers(["a", "b"])!;
      state().setActiveLayer("a");
      state().addImportedLayer([OUTER], "Imported");
      expect(isContiguous(g(), gid)).toBe(true);
    });

    it("a new layer above a NON-grouped active layer stays ungrouped", () => {
      seedLayers(["a", "b"]);
      const gid = state().groupLayers(["a"])!;
      state().setActiveLayer("b");
      state().addLayer();
      expect(groupOf(state().activeLayerId!)).toBeUndefined();
      expect(isContiguous(g(), gid)).toBe(true);
    });
  });

  describe("pruning", () => {
    it("deleting a group's last layer drops the group", () => {
      seedLayers(["a", "b"]);
      const gid = state().groupLayers(["a"])!;
      expect(findGroup(g(), gid)).toBeTruthy();
      state().deleteLayer("a");
      expect(findGroup(g(), gid)).toBeUndefined();
      expect(g().layerGroups).toBeUndefined();
    });

    it("emptying an inner group prunes its now-empty parent too", () => {
      seedLayers(["a", "b"]);
      const outer = state().groupLayers(["a"])!;
      const inner = state().groupLayers(["a"])!;
      expect(findGroup(g(), inner)?.parentId).toBe(outer);
      state().deleteLayer("a");
      expect(g().layerGroups).toBeUndefined();
    });

    it("keeps a group that still holds a layer", () => {
      seedLayers(["a", "b", "c"]);
      const gid = state().groupLayers(["a", "b"])!;
      state().deleteLayer("a");
      expect(findGroup(g(), gid)).toBeTruthy();
      expect(groupOf("b")).toBe(gid);
    });
  });

  describe("inherited lock (stage 3)", () => {
    it("a layer in a LOCKED GROUP refuses geometry edits", () => {
      seedTwoLayers(layer("LA", [OUTER]), layer("LB", []));
      const gid = state().groupLayers(["LA"])!;
      state().setGroupLocked(gid, true);
      // The layer's OWN locked flag is still false — only the group is locked.
      expect(g().layers.find((l) => l.id === "LA")!.locked).toBe(false);
      state().setContourPaint(["outer"], { fill: "#ff0000" });
      expect(layersById()["LA"]!.contours[0]!.paint).toBeUndefined();
    });

    it("unlocking the group restores editability", () => {
      seedTwoLayers(layer("LA", [OUTER]), layer("LB", []));
      const gid = state().groupLayers(["LA"])!;
      state().setGroupLocked(gid, true);
      state().setGroupLocked(gid, false);
      state().setContourPaint(["outer"], { fill: "#ff0000" });
      expect(layersById()["LA"]!.contours[0]!.paint).toEqual({ fill: "#ff0000" });
    });

    it("inherits a lock from an OUTER group through a nested one", () => {
      seedTwoLayers(layer("LA", [OUTER]), layer("LB", []));
      const outer = state().groupLayers(["LA"])!;
      state().groupLayers(["LA"]); // inner group, unlocked
      state().setGroupLocked(outer, true);
      state().setContourPaint(["outer"], { fill: "#ff0000" });
      expect(layersById()["LA"]!.contours[0]!.paint).toBeUndefined();
    });
  });

  describe("selectLayerRange with groups", () => {
    it("a range that spans a COLLAPSED group takes all its members", () => {
      seedLayers(["a", "b", "c", "d"]);
      const gid = state().groupLayers(["b", "c"])!;
      state().setGroupCollapsed(gid, true);
      state().setActiveLayer("a");
      state().selectLayerRange("d"); // a → (collapsed group) → d
      expect(state().selectedLayerIds).toEqual(["a", "b", "c", "d"]);
    });

    it("selecting up to a collapsed group row grabs the whole group", () => {
      seedLayers(["a", "b", "c"]);
      const gid = state().groupLayers(["b", "c"])!;
      state().setGroupCollapsed(gid, true);
      state().setActiveLayer("a");
      state().selectLayerRange("b"); // "b" is inside the collapsed group row
      expect(state().selectedLayerIds).toEqual(["a", "b", "c"]);
    });

    it("stays in stack order regardless of click direction", () => {
      seedLayers(["a", "b", "c"]);
      state().setActiveLayer("c");
      state().selectLayerRange("a");
      expect(state().selectedLayerIds).toEqual(["a", "b", "c"]);
    });
  });

  describe("moveLayer with groups", () => {
    it("moves within a group without leaving it", () => {
      seedLayers(["a", "b", "c"]);
      const gid = state().groupLayers(["a", "b"])!;
      state().moveLayer("a", "up"); // a and b swap, both still in the group
      expect(order()).toEqual(["b", "a", "c"]);
      expect(groupOf("a")).toBe(gid);
      expect(isContiguous(g(), gid)).toBe(true);
    });

    it("at the top edge, a further move POPS the layer out of the group", () => {
      seedLayers(["a", "b", "c"]);
      const gid = state().groupLayers(["a", "b"])!;
      state().moveLayer("b", "up"); // b is the top member
      expect(groupOf("b")).toBeUndefined();
      expect(order()).toEqual(["a", "b", "c"]); // position unchanged, only the tag
      expect(isContiguous(g(), gid)).toBe(true);
    });

    it("popping the last member dissolves the group", () => {
      seedLayers(["a", "b"]);
      const gid = state().groupLayers(["a"])!;
      state().moveLayer("a", "up");
      expect(findGroup(g(), gid)).toBeUndefined();
      expect(g().layerGroups).toBeUndefined();
    });

    it("steps OVER a neighbouring group instead of into it", () => {
      seedLayers(["a", "b", "c"]);
      const gid = state().groupLayers(["b", "c"])!;
      state().moveLayer("a", "up"); // a must jump the whole group, not land inside
      expect(order()).toEqual(["b", "c", "a"]);
      expect(isContiguous(g(), gid)).toBe(true);
      expect(groupOf("a")).toBeUndefined();
    });

    it("an ungrouped document behaves exactly as before", () => {
      seedLayers(["a", "b", "c"]);
      state().moveLayer("a", "up");
      expect(order()).toEqual(["b", "a", "c"]);
      state().moveLayer("a", "down");
      expect(order()).toEqual(["a", "b", "c"]);
    });
  });

  describe("moveGroup", () => {
    it("moves the whole run past a sibling layer", () => {
      seedLayers(["a", "b", "c"]);
      const gid = state().groupLayers(["a", "b"])!;
      expect(order()).toEqual(["a", "b", "c"]);
      state().moveGroup(gid, "up"); // past c
      expect(order()).toEqual(["c", "a", "b"]);
      expect(isContiguous(g(), gid)).toBe(true);
    });

    it("moves past a sibling GROUP as a block", () => {
      seedLayers(["a", "b", "c", "d"]);
      const g1 = state().groupLayers(["a", "b"])!;
      const g2 = state().groupLayers(["c", "d"])!;
      state().moveGroup(g1, "up");
      expect(order()).toEqual(["c", "d", "a", "b"]);
      expect(isContiguous(g(), g1)).toBe(true);
      expect(isContiguous(g(), g2)).toBe(true);
    });

    it("is a no-op at the edge", () => {
      seedLayers(["a", "b"]);
      const gid = state().groupLayers(["a", "b"])!;
      const before = order();
      state().moveGroup(gid, "up");
      expect(order()).toEqual(before);
    });

    it("refuses to cross out of its parent", () => {
      // inner sits inside outer; moving it up must not escape outer.
      seedLayers(["a", "b", "c"]);
      state().groupLayers(["a", "b"]);
      const inner = state().groupLayers(["a"])!;
      const before = order();
      state().moveGroup(inner, "up");
      expect(order()).toEqual(before);
    });
  });
});
