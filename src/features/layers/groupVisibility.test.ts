import { describe, it, expect } from "vitest";
import { glyphToSvg } from "../export/glyphToSvg";
import { glyphFillGroups } from "../canvas/layerFills";
import { getGeometryService } from "../../engine/geometry/geometryEngine";
import { DEFAULT_METRICS } from "../../constants/metrics";
import type { Glyph, Layer } from "../../types/document";
import type { Contour } from "../../types/geometry";

/**
 * Stage 3: a hidden GROUP must hide its members everywhere the fill pipeline is used
 * (canvas, thumbnails, text preview, export), and a nested group must inherit from
 * every ancestor. Rendering reaches this through `resolvedLayers`.
 */

const tri = (id: string, o: number): Contour => ({
  id, closed: true,
  points: [[0, 0], [100, 0], [100, 100]].map(([x, y], i) => ({
    id: `${id}${i}`, type: "corner" as const, x: x! + o, y: y! + o,
  })),
});
const lay = (id: string, o: number, groupId?: string): Layer => ({
  id, name: id, visible: true, locked: false, contours: [tri(id, o)],
  ...(groupId ? { groupId } : {}),
});
const gl = (layers: Layer[], groups?: Glyph["layerGroups"]): Glyph => ({
  id: "G", codepoint: 0x41, name: "A", advanceWidth: 600, layers,
  ...(groups ? { layerGroups: groups } : {}),
});
const regions = (g: Glyph) =>
  glyphFillGroups(g, getGeometryService()).flatMap((x) => x.contours).length;

describe("group visibility reaches the fill pipeline", () => {
  it("a hidden group drops its members from the render", () => {
    const shown = gl([lay("a", 0, "g1"), lay("b", 200)],
      [{ id: "g1", name: "G", visible: true, locked: false }]);
    const hidden = gl([lay("a", 0, "g1"), lay("b", 200)],
      [{ id: "g1", name: "G", visible: false, locked: false }]);
    expect(regions(shown)).toBe(2);
    expect(regions(hidden)).toBe(1);
  });

  it("the export agrees with the canvas", () => {
    const hidden = gl([lay("a", 0, "g1"), lay("b", 200)],
      [{ id: "g1", name: "G", visible: false, locked: false }]);
    const onlyB = gl([lay("b", 200)]);
    expect(glyphToSvg(hidden, DEFAULT_METRICS)).toBe(glyphToSvg(onlyB, DEFAULT_METRICS));
  });

  it("a nested group inherits the outer group's hidden state", () => {
    const g = gl([lay("a", 0, "inner"), lay("b", 200)], [
      { id: "outer", name: "outer", visible: false, locked: false },
      { id: "inner", name: "inner", parentId: "outer", visible: true, locked: false },
    ]);
    expect(regions(g)).toBe(1);
  });

  it("a visible group renders exactly as if it were not grouped", () => {
    const grouped = gl([lay("a", 0, "g1"), lay("b", 200)],
      [{ id: "g1", name: "G", visible: true, locked: false }]);
    const plain = gl([lay("a", 0), lay("b", 200)]);
    expect(glyphToSvg(grouped, DEFAULT_METRICS)).toBe(glyphToSvg(plain, DEFAULT_METRICS));
  });

  it("a locked-but-visible group still renders (lock is not hide)", () => {
    const g = gl([lay("a", 0, "g1")],
      [{ id: "g1", name: "G", visible: true, locked: true }]);
    expect(regions(g)).toBe(1);
  });
});
