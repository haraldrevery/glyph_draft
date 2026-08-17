import { describe, it, expect } from "vitest";
import type { Contour } from "../../types/geometry";
import { contourWinding } from "./path";
import { correctWinding } from "./winding";

function poly(pts: [number, number][]): Contour {
  return {
    id: "c",
    closed: true,
    points: pts.map(([x, y], i) => ({ id: `p${i}`, type: "corner" as const, x, y })),
  };
}

describe("correctWinding", () => {
  it("forces a single outer contour clockwise", () => {
    const ccw = poly([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]);
    const result = correctWinding([ccw]);
    expect(contourWinding(result[0]!)).toBe("cw");
  });

  it("sets nesting by depth: outer CW, contained hole CCW", () => {
    const outer = poly([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]);
    const inner = poly([
      [25, 25],
      [75, 25],
      [75, 75],
      [25, 75],
    ]);
    const result = correctWinding([outer, inner]);
    expect(contourWinding(result[0]!)).toBe("cw"); // depth 0 → outer
    expect(contourWinding(result[1]!)).toBe("ccw"); // depth 1 → hole
  });
});
