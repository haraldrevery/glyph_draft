import { describe, it, expect } from "vitest";
import { nearestPointOnContours, lineCrossings } from "./hitTest";
import type { Layer } from "../../types/document";
import type { Contour } from "../../types/geometry";
import type { Viewport } from "../../types/viewport";

function openC(pts: [number, number][]): Contour {
  return { id: "c", closed: false, points: pts.map(([x, y], i) => ({ id: `p${i}`, type: "corner" as const, x, y })) };
}

// zoom 1, no pan → screen = (x, -y); so a world point (x,y) is at screen (x,-y).
const VP: Viewport = { zoom: 1, pan: { x: 0, y: 0 } };

function layer(pts: [number, number][], closed = false): Layer {
  return {
    id: "L",
    name: "L",
    visible: true,
    locked: false,
    contours: [
      {
        id: "c",
        closed,
        points: pts.map(([x, y], i) => ({ id: `p${i}`, type: "corner" as const, x, y })),
      },
    ],
  };
}

describe("nearestPointOnContours", () => {
  it("projects a click onto the nearest segment with a plausible t", () => {
    const hit = nearestPointOnContours([layer([[0, 0], [10, 0], [20, 0]])], VP, { x: 5, y: 0 }, 8);
    expect(hit).not.toBeNull();
    expect(hit!.segIndex).toBe(0); // first segment (0,0)→(10,0)
    expect(hit!.t).toBeCloseTo(0.5, 1); // halfway along it
  });

  it("returns null when no path is within maxPx", () => {
    expect(nearestPointOnContours([layer([[0, 0], [10, 0]])], VP, { x: 5, y: 50 }, 8)).toBeNull();
  });

  it("considers a closed contour's closing segment", () => {
    // square corners; left edge is the closing segment (index 3): (0,10)→(0,0).
    const sq = layer([[0, 0], [10, 0], [10, 10], [0, 10]], true);
    const hit = nearestPointOnContours([sq], VP, { x: 0, y: -5 }, 8); // world (0,5) on the left edge
    expect(hit!.segIndex).toBe(3);
  });
});

describe("lineCrossings (knife)", () => {
  it("finds a single crossing of a straight segment", () => {
    const out = lineCrossings(openC([[0, 0], [100, 0]]), { x: 50, y: -10 }, { x: 50, y: 10 });
    expect(out).toHaveLength(1);
    expect(out[0]!.segIndex).toBe(0);
    expect(out[0]!.t).toBeCloseTo(0.5, 2);
  });

  it("ignores a crossing of the infinite line that's outside the knife segment", () => {
    // knife runs y∈[5,20] at x=50 — never reaches the stroke at y=0.
    expect(lineCrossings(openC([[0, 0], [100, 0]]), { x: 50, y: 5 }, { x: 50, y: 20 })).toHaveLength(0);
  });

  it("finds two crossings when the knife crosses a path twice", () => {
    const v = openC([[0, 100], [50, 0], [100, 100]]); // a 'V'
    const out = lineCrossings(v, { x: -10, y: 50 }, { x: 110, y: 50 }); // horizontal across both legs
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.segIndex).sort()).toEqual([0, 1]);
  });
});
