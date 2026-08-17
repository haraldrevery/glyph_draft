import { describe, it, expect } from "vitest";
import { nearestAnchor, snapToGeometry, NO_EXCLUDE } from "./snapGeometry";
import type { Layer } from "../../types/document";
import type { Viewport } from "../../types/viewport";

// zoom 1, no pan → screen = (x, -y); so a world anchor (x,y) sits at screen (x,-y).
const VP: Viewport = { zoom: 1, pan: { x: 0, y: 0 } };

function layer(id: string, pts: [string, number, number][]): Layer {
  return {
    id,
    name: id,
    visible: true,
    locked: false,
    contours: [
      { id: `${id}c`, closed: false, points: pts.map(([pid, x, y]) => ({ id: pid, type: "corner" as const, x, y })) },
    ],
  };
}

describe("nearestAnchor", () => {
  const L = layer("L", [["a", 0, 0], ["b", 100, 0], ["c", 200, 0]]);

  it("finds the closest anchor within tolerance", () => {
    const hit = nearestAnchor([L], VP, { x: 103, y: 0 }, 8, new Set()); // near world (100,0) = anchor b
    expect(hit?.ref.pointId).toBe("b");
    expect(hit?.point).toEqual({ x: 100, y: 0 });
  });

  it("returns null when nothing is within tolerance", () => {
    expect(nearestAnchor([L], VP, { x: 50, y: 0 }, 8, new Set())).toBeNull(); // midway, > 8px from any anchor
  });

  it("excludes the dragged anchor (no self-snap)", () => {
    // Query right on anchor b, but exclude b → next-nearest is too far ⇒ null.
    expect(nearestAnchor([L], VP, { x: 100, y: 0 }, 8, new Set(["b"]))).toBeNull();
  });
});

describe("snapToGeometry", () => {
  it("reports an anchor snap (kind 'anchor')", () => {
    const L = layer("L", [["a", 0, 0], ["b", 100, 0]]);
    const snap = snapToGeometry([L], VP, { x: 2, y: 0 }, 8, NO_EXCLUDE);
    expect(snap).toEqual({ point: { x: 0, y: 0 }, kind: "anchor" });
  });

  it("returns null when out of range", () => {
    const L = layer("L", [["a", 0, 0]]);
    expect(snapToGeometry([L], VP, { x: 60, y: 0 }, 8, NO_EXCLUDE)).toBeNull();
  });

  it("falls back to a PATH snap mid-segment (kind 'path')", () => {
    // Segment (0,0)→(100,0); query at world (50,0) = screen (50,0): far from both
    // anchors but right on the edge → a path snap at the projected point.
    const L = layer("L", [["a", 0, 0], ["b", 100, 0]]);
    const snap = snapToGeometry([L], VP, { x: 50, y: 0 }, 8, NO_EXCLUDE);
    expect(snap?.kind).toBe("path");
    expect(snap?.point.x).toBeCloseTo(50, 1);
    expect(snap?.point.y).toBeCloseTo(0, 1);
  });

  it("anchor wins over path when both are in range", () => {
    const L = layer("L", [["a", 0, 0], ["b", 100, 0]]);
    expect(snapToGeometry([L], VP, { x: 2, y: 1 }, 8, NO_EXCLUDE)?.kind).toBe("anchor");
  });

  it("excludes the dragged contour from path snap (no self-snap)", () => {
    // The only contour is the one being dragged → no path target ⇒ null.
    const L = layer("L", [["a", 0, 0], ["b", 100, 0]]);
    const exclude = { pointIds: new Set(["a", "b"]), contourIds: new Set(["Lc"]) };
    expect(snapToGeometry([L], VP, { x: 50, y: 0 }, 8, exclude)).toBeNull();
  });
});
