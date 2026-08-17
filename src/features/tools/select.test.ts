import { describe, it, expect } from "vitest";
import { rectRing, applyHandle, mirrorForDrag } from "./select";
import { refsInPolygon } from "./shared";
import type { Layer } from "../../types/document";
import type { AnchorPoint, Contour, PointRef } from "../../types/geometry";

/**
 * Marquee (box-select) math: rectRing builds the selection ring from two drag
 * corners and feeds the shared, pure refsInPolygon (same path the lasso uses).
 * DOM-free.
 */

function pt(id: string, x: number, y: number): AnchorPoint {
  return { id, type: "corner", x, y };
}
function layer(id: string, points: AnchorPoint[]): Layer {
  const contour: Contour = { id: `${id}_c`, closed: false, points };
  return { id, name: id, visible: true, locked: false, contours: [contour] };
}

describe("rectRing", () => {
  it("normalizes either drag direction to the same min/max rectangle", () => {
    const forward = rectRing({ x: 0, y: 0 }, { x: 100, y: 50 });
    const reverse = rectRing({ x: 100, y: 50 }, { x: 0, y: 0 });
    expect(forward).toEqual(reverse);
    expect(forward).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ]);
  });
});

describe("marquee selection (rectRing + refsInPolygon)", () => {
  it("selects exactly the anchors inside the box, regardless of drag direction", () => {
    const L = layer("L", [pt("in", 50, 25), pt("out", 200, 25)]);
    const ring = rectRing({ x: 120, y: 60 }, { x: 0, y: 0 }); // drawn up-left
    const refs = refsInPolygon([L], ring);
    expect(refs).toEqual([{ layerId: "L", contourId: "L_c", pointId: "in" }]);
  });
});

describe("mirrorForDrag — type-aware handle mirroring", () => {
  const smooth: AnchorPoint = { id: "s", type: "smooth", x: 0, y: 0 };
  const cusp: AnchorPoint = { id: "c", type: "corner", x: 0, y: 0 };
  it("mirrors only for a smooth node with Alt up", () => {
    expect(mirrorForDrag(smooth, false)).toBe(true);
    expect(mirrorForDrag(smooth, true)).toBe(false); // Alt breaks it
    expect(mirrorForDrag(cusp, false)).toBe(false); // cusp/corner is independent
    expect(mirrorForDrag(undefined, false)).toBe(false);
  });
});

describe("applyHandle — set, mirror, and collapse-to-corner", () => {
  // A smooth node at (100,100) with both handles, plus a neighbor so it's a path.
  const node: AnchorPoint = {
    id: "n",
    type: "smooth",
    x: 100,
    y: 100,
    handleOut: { x: 120, y: 100 },
    handleIn: { x: 80, y: 100 },
  };
  const origin: Contour = {
    id: "c",
    closed: false,
    points: [{ id: "a", type: "corner", x: 0, y: 0 }, node],
  };
  const ref: PointRef = { layerId: "L", contourId: "c", pointId: "n" };
  const result = (c: Contour) => c.points.find((p) => p.id === "n")!;

  it("sets the dragged handle and mirrors the opposite (smooth)", () => {
    const out = result(applyHandle(origin, ref, "out", { x: 140, y: 120 }, true));
    expect(out.handleOut).toEqual({ x: 140, y: 120 });
    expect(out.handleIn).toEqual({ x: 60, y: 80 }); // mirror about (100,100)
    expect(out.type).toBe("smooth");
  });

  it("clearing with mirror drops BOTH handles and makes it a corner", () => {
    const out = result(applyHandle(origin, ref, "out", null, true));
    expect(out.handleOut).toBeUndefined();
    expect(out.handleIn).toBeUndefined();
    expect(out.type).toBe("corner");
  });

  it("clearing with mirror off drops only the dragged side (cusp kept)", () => {
    const out = result(applyHandle(origin, ref, "out", null, false));
    expect(out.handleOut).toBeUndefined();
    expect(out.handleIn).toEqual({ x: 80, y: 100 }); // other curve preserved
    expect(out.type).toBe("smooth"); // still has a handle ⇒ not a corner
  });
});
