import { describe, it, expect } from "vitest";
import { convertPoint } from "./nodeHandles";
import type { AnchorPoint, Contour } from "../../types/geometry";

/**
 * Node continuity conversions. A handle's presence is what curves a segment, so
 * "smooth"/"cusp" synthesize tangent handles and "corner" strips them; type
 * records the continuity (smooth = mirrored on drag, corner = independent).
 */

function corner(id: string, x: number, y: number): AnchorPoint {
  return { id, type: "corner", x, y };
}

// A horizontal three-node open path; the middle node's neighbors lie on the x-axis,
// so its tangent is horizontal and handles land symmetric about (100,100).
const contour: Contour = {
  id: "c",
  closed: false,
  points: [corner("a", 0, 100), corner("m", 100, 100), corner("b", 220, 100)],
};

describe("convertPoint", () => {
  it("smooth adds collinear, symmetric tangent handles", () => {
    const m = convertPoint(contour, "m", "smooth");
    expect(m.type).toBe("smooth");
    // min neighbor distance is 100 (to 'a'); length = 100/3 along +x.
    expect(m.handleOut).toEqual({ x: 100 + 100 / 3, y: 100 });
    expect(m.handleIn).toEqual({ x: 100 - 100 / 3, y: 100 });
  });

  it("cusp on a handle-less corner adds handles but stays corner-typed", () => {
    const m = convertPoint(contour, "m", "cusp");
    expect(m.type).toBe("corner");
    expect(m.handleOut).toBeDefined();
    expect(m.handleIn).toBeDefined();
  });

  it("cusp on a smooth node keeps its handle positions, just flips to corner", () => {
    const smooth = convertPoint(contour, "m", "smooth");
    const withSmooth: Contour = {
      ...contour,
      points: contour.points.map((p) => (p.id === "m" ? smooth : p)),
    };
    const m = convertPoint(withSmooth, "m", "cusp");
    expect(m.type).toBe("corner");
    expect(m.handleOut).toEqual(smooth.handleOut); // unchanged
    expect(m.handleIn).toEqual(smooth.handleIn);
  });

  it("corner strips both handles", () => {
    const smooth = convertPoint(contour, "m", "smooth");
    const withSmooth: Contour = {
      ...contour,
      points: contour.points.map((p) => (p.id === "m" ? smooth : p)),
    };
    const m = convertPoint(withSmooth, "m", "corner");
    expect(m.type).toBe("corner");
    expect(m.handleOut).toBeUndefined();
    expect(m.handleIn).toBeUndefined();
  });
});
