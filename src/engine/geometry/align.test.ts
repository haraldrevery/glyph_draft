import { describe, it, expect } from "vitest";
import { contourBounds, contourTightBounds, alignDeltas, type BBox } from "./align";
import type { Contour } from "../../types/geometry";

/** A rectangle contour from (x,y) sized w×h. */
function rect(id: string, x: number, y: number, w: number, h: number): Contour {
  return {
    id,
    closed: true,
    points: [
      { id: `${id}0`, type: "corner", x, y },
      { id: `${id}1`, type: "corner", x: x + w, y },
      { id: `${id}2`, type: "corner", x: x + w, y: y + h },
      { id: `${id}3`, type: "corner", x, y: y + h },
    ],
  };
}

const box = (minX: number, minY: number, maxX: number, maxY: number): BBox => ({
  minX, minY, maxX, maxY,
});

describe("contourBounds", () => {
  it("bounds a rectangle over its anchors", () => {
    expect(contourBounds(rect("r", 10, 20, 30, 40))).toEqual({ minX: 10, minY: 20, maxX: 40, maxY: 60 });
  });
  it("includes handles in the bounds", () => {
    const c: Contour = {
      id: "c", closed: false,
      points: [
        { id: "a", type: "smooth", x: 0, y: 0, handleOut: { x: -5, y: 0 } },
        { id: "b", type: "corner", x: 10, y: 10 },
      ],
    };
    expect(contourBounds(c)!.minX).toBe(-5); // handle pushes minX left of the anchor
  });
});

describe("alignDeltas", () => {
  // Two boxes: A spans x[0,10], B spans x[20,40]; union x[0,40].
  const boxes = [box(0, 0, 10, 10), box(20, 5, 40, 25)];

  it("aligns left edges to the union left", () => {
    expect(alignDeltas(boxes, "left")).toEqual([{ dx: 0, dy: 0 }, { dx: -20, dy: 0 }]);
  });
  it("aligns right edges to the union right", () => {
    expect(alignDeltas(boxes, "right")).toEqual([{ dx: 30, dy: 0 }, { dx: 0, dy: 0 }]);
  });
  it("aligns horizontal centers to the union center", () => {
    // union center x = 20; A center 5 → +15; B center 30 → −10.
    expect(alignDeltas(boxes, "centerH")).toEqual([{ dx: 15, dy: 0 }, { dx: -10, dy: 0 }]);
  });
  it("aligns top edges to the union top (max y, Y-up)", () => {
    // union maxY = 25; A maxY 10 → +15; B maxY 25 → 0.
    expect(alignDeltas(boxes, "top")).toEqual([{ dx: 0, dy: 15 }, { dx: 0, dy: 0 }]);
  });
  it("aligns bottom edges to the union bottom (min y)", () => {
    expect(alignDeltas(boxes, "bottom")).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: -5 }]);
  });

  it("distributes three boxes' centers evenly (and is a no-op for two)", () => {
    // centers x: 5, 35, 100 → evenly between 5 and 100 → middle target 52.5 → +17.5.
    const three = [box(0, 0, 10, 10), box(30, 0, 40, 10), box(90, 0, 110, 10)];
    const d = alignDeltas(three, "distributeH");
    expect(d[0]).toEqual({ dx: 0, dy: 0 }); // extremes don't move
    expect(d[2]).toEqual({ dx: 0, dy: 0 });
    expect(d[1]!.dx).toBeCloseTo(17.5, 6);
    // Two boxes can't be distributed.
    expect(alignDeltas([box(0, 0, 10, 10), box(50, 0, 60, 10)], "distributeH")).toEqual([
      { dx: 0, dy: 0 }, { dx: 0, dy: 0 },
    ]);
  });
});

describe("contourTightBounds", () => {
  it("matches contourBounds on a handle-free path", () => {
    const r = rect("r", 10, 20, 30, 40);
    expect(contourTightBounds(r)).toEqual(contourBounds(r));
  });

  it("is tighter than contourBounds where handles overshoot the curve", () => {
    // An open segment whose handles reach y=30; the curve tops out at y=22.5.
    const c: Contour = {
      id: "c",
      closed: false,
      points: [
        { id: "a", type: "smooth", x: 0, y: 0, handleOut: { x: 0, y: 30 } },
        { id: "b", type: "smooth", x: 10, y: 0, handleIn: { x: 10, y: 30 } },
      ],
    };
    expect(contourBounds(c)!.maxY).toBe(30);
    expect(contourTightBounds(c)!.maxY).toBeCloseTo(22.5, 9);
  });

  it("includes the closing segment of a closed contour", () => {
    // The bulge lives ONLY on the last→first segment, so an open path misses it.
    const pts = [
      { id: "a", type: "smooth" as const, x: 0, y: 0, handleIn: { x: -30, y: 0 } },
      { id: "b", type: "corner" as const, x: 10, y: 0 },
      { id: "c", type: "smooth" as const, x: 10, y: 10, handleOut: { x: -30, y: 10 } },
    ];
    expect(contourTightBounds({ id: "open", closed: false, points: pts })!.minX).toBe(0);
    expect(contourTightBounds({ id: "shut", closed: true, points: pts })!.minX).toBeLessThan(0);
  });

  it("drops a non-finite segment instead of propagating NaN", () => {
    // One corrupt coordinate must not poison the box — the export frames its whole
    // viewBox off this, and NaN spreads through every later min/max.
    const c: Contour = {
      id: "c",
      closed: true,
      points: [
        { id: "a", type: "corner", x: NaN, y: 0 },
        { id: "b", type: "corner", x: 100, y: 0 },
        { id: "c", type: "corner", x: 100, y: 100 },
      ],
    };
    const b = contourTightBounds(c)!;
    for (const v of [b.minX, b.minY, b.maxX, b.maxY]) expect(Number.isFinite(v)).toBe(true);
    expect(b).toEqual({ minX: 100, minY: 0, maxX: 100, maxY: 100 });
    // All-corrupt = nothing to measure at all.
    expect(
      contourTightBounds({
        id: "all",
        closed: false,
        points: [{ id: "p", type: "corner", x: NaN, y: NaN }],
      }),
    ).toBeNull();
  });

  it("returns null for an empty contour and a point for a single anchor", () => {
    expect(contourTightBounds({ id: "e", closed: false, points: [] })).toBeNull();
    expect(contourTightBounds({
      id: "one",
      closed: false,
      points: [{ id: "p", type: "corner", x: 4, y: 5 }],
    })).toEqual({ minX: 4, minY: 5, maxX: 4, maxY: 5 });
  });
});
