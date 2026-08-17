import { describe, it, expect } from "vitest";
import { mergeLayers } from "./mergeLayers";
import { useDocumentStore } from "../../state/documentStore";
import { contourWinding } from "../../engine/geometry/path";
import type { BooleanPair, Glyph, Layer } from "../../types/document";
import type { Contour } from "../../types/geometry";

/**
 * Phase F merge glue end-to-end (geometry via the live Paper service + the store).
 * Bakes the selected layers' rendered geometry into one `baked` layer.
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
const OUTER = poly("outer", [[0, 0], [100, 0], [100, 100], [0, 100]]);
const INNER = poly("inner", [[25, 25], [75, 25], [75, 75], [25, 75]]);

function seed(layers: Layer[], booleanPairs?: BooleanPair[]): void {
  const glyph: Glyph = {
    id: "G",
    codepoint: 0x41,
    name: "A",
    advanceWidth: 600,
    layers,
    ...(booleanPairs ? { booleanPairs } : {}),
  };
  useDocumentStore.setState({
    glyphs: { G: glyph },
    activeGlyphId: "G",
    activeLayerId: layers[0]!.id,
    selectedLayerIds: layers.map((l) => l.id),
  });
}
function layers(): Layer[] {
  return useDocumentStore.getState().glyphs["G"]!.layers;
}

describe("mergeLayers", () => {
  it("bakes a Subtract pair into one baked layer carrying the hole", () => {
    // Stack bottom→top: INNER (lower, B), OUTER (upper, A). A − B = ring.
    seed(
      [layer("LB", [INNER]), layer("LA", [OUTER])],
      [{ id: "p", layerIds: ["LA", "LB"], op: "subtract" }],
    );
    mergeLayers(["LA", "LB"]);

    const ls = layers();
    expect(ls).toHaveLength(1);
    expect(ls[0]!.baked).toBe(true);
    expect(ls[0]!.contours).toHaveLength(2); // outer + hole
    expect(contourWinding(ls[0]!.contours[0]!)).toBe("cw"); // outer
    expect(contourWinding(ls[0]!.contours[1]!)).toBe("ccw"); // hole preserved
    expect(useDocumentStore.getState().glyphs["G"]!.booleanPairs).toEqual([]);
  });

  it("excludes a locked layer (and is a no-op with <2 mergeable)", () => {
    seed([layer("LA", [OUTER]), layer("LB", [INNER], true)]); // LB locked
    mergeLayers(["LA", "LB"]); // only LA is mergeable → no-op
    expect(layers().map((l) => l.id)).toEqual(["LA", "LB"]);
  });

  it("merges two plain layers into one baked solid (no pair)", () => {
    seed([layer("LA", [OUTER]), layer("LB", [INNER])]);
    mergeLayers(["LA", "LB"]);
    const ls = layers();
    expect(ls).toHaveLength(1);
    expect(ls[0]!.baked).toBe(true);
    // Two unpaired layers → two solid (CW) regions, baked verbatim.
    for (const c of ls[0]!.contours) expect(contourWinding(c)).toBe("cw");
  });
});
