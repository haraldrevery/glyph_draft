import { describe, it, expect } from "vitest";
import { refsInPolygon } from "./shared";
import type { Layer } from "../../types/document";
import type { AnchorPoint, Contour } from "../../types/geometry";
import type { Vec2 } from "../../types/viewport";

function pt(id: string, x: number, y: number): AnchorPoint {
  return { id, type: "corner", x, y };
}
function contour(id: string, points: AnchorPoint[]): Contour {
  return { id, closed: false, points };
}
function layer(id: string, contours: Contour[]): Layer {
  return { id, name: id, visible: true, locked: false, contours };
}

// A 100×100 square ring.
const RING: Vec2[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

describe("refsInPolygon", () => {
  it("returns only the anchors inside the polygon", () => {
    const L = layer("L1", [contour("c1", [pt("in", 50, 50), pt("out", 150, 50)])]);
    const refs = refsInPolygon([L], RING);
    expect(refs).toEqual([{ layerId: "L1", contourId: "c1", pointId: "in" }]);
  });

  it("gathers anchors across multiple layers", () => {
    const L1 = layer("L1", [contour("c1", [pt("a", 50, 50)])]);
    const L2 = layer("L2", [contour("c2", [pt("d", 20, 20), pt("e", 200, 200)])]);
    const ids = refsInPolygon([L1, L2], RING).map((r) => r.pointId);
    expect(ids).toContain("a");
    expect(ids).toContain("d");
    expect(ids).not.toContain("e");
  });

  it("returns nothing for a degenerate ring (< 3 points)", () => {
    const L = layer("L1", [contour("c1", [pt("a", 50, 50)])]);
    expect(refsInPolygon([L], RING.slice(0, 2))).toEqual([]);
  });
});
