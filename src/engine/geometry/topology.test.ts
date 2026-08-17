import { describe, it, expect } from "vitest";
import { extractContours, reverseContour, joinContours, splitContourAt, splitContourAtPoints } from "./topology";
import type { AnchorPoint, Contour, StrokeStyle } from "../../types/geometry";

/**
 * Pure node-topology ops: the shared substrate for split-on-delete, cut, and
 * merge-endpoints. DOM-free.
 */

function pt(id: string, x: number, y: number): AnchorPoint {
  return { id, type: "corner", x, y };
}
function open(ids: string[]): Contour {
  return { id: "c", closed: false, points: ids.map((id, i) => pt(id, i * 10, 0)) };
}
const STROKE: StrokeStyle = { width: 20, startCap: "round", endCap: "rectangle", join: "round" };

describe("extractContours", () => {
  it("splits an open path at a dropped interior node into two open fragments", () => {
    const c = open(["a", "b", "c", "d", "e"]); // drop "c"
    const out = extractContours(c, new Set(["a", "b", "d", "e"]));
    expect(out.length).toBe(2);
    expect(out.map((f) => f.points.map((p) => p.id))).toEqual([
      ["a", "b"],
      ["d", "e"],
    ]);
    expect(out.every((f) => !f.closed)).toBe(true);
  });

  it("butt-caps newly created ends, keeps original terminal caps", () => {
    const c: Contour = { ...open(["a", "b", "c", "d", "e"]), stroke: STROKE };
    const [first, second] = extractContours(c, new Set(["a", "b", "d", "e"]));
    // first fragment: original start kept (round), new cut end → butt
    expect(first!.stroke!.startCap).toBe("round");
    expect(first!.stroke!.endCap).toBe("butt");
    // second fragment: new cut start → butt, original end kept (rectangle)
    expect(second!.stroke!.startCap).toBe("butt");
    expect(second!.stroke!.endCap).toBe("rectangle");
    // deep-cloned & independent
    expect(second!.stroke).not.toBe(STROKE);
  });

  it("opens a closed path into one open run when a node is dropped (seam wraps)", () => {
    const c: Contour = { ...open(["a", "b", "c", "d"]), closed: true };
    const out = extractContours(c, new Set(["a", "b", "d"])); // drop "c"
    expect(out.length).toBe(1);
    expect(out[0]!.closed).toBe(false);
    // run wraps past the seam: d, a, b
    expect(out[0]!.points.map((p) => p.id)).toEqual(["d", "a", "b"]);
  });

  it("preserves a fully-kept closed ring as one closed contour", () => {
    const c: Contour = { ...open(["a", "b", "c", "d"]), closed: true };
    const out = extractContours(c, new Set(["a", "b", "c", "d"]));
    expect(out.length).toBe(1);
    expect(out[0]!.closed).toBe(true);
    expect(out[0]!.points).toHaveLength(4);
  });

  it("drops runs shorter than two points", () => {
    const c = open(["a", "b", "c"]); // keep only "a" → orphan
    expect(extractContours(c, new Set(["a"]))).toEqual([]);
  });
});

describe("reverseContour", () => {
  it("reverses order and swaps in/out handles", () => {
    const c: Contour = {
      id: "c",
      closed: false,
      points: [
        { id: "a", type: "smooth", x: 0, y: 0, handleOut: { x: 5, y: 0 } },
        { id: "b", type: "smooth", x: 10, y: 0, handleIn: { x: 8, y: 0 } },
      ],
    };
    const r = reverseContour(c);
    expect(r.points.map((p) => p.id)).toEqual(["b", "a"]);
    expect(r.points[0]!.handleOut).toEqual({ x: 8, y: 0 }); // b's in → out
    expect(r.points[1]!.handleIn).toEqual({ x: 5, y: 0 }); // a's out → in
  });
});

describe("joinContours", () => {
  it("fuses a's tail to b's head, dropping the coincident anchor", () => {
    const a = open(["a1", "a2"]); // join at a's last (a2)
    const b = open(["b1", "b2"]); // join at b's first (b1)
    const j = joinContours(a, b, false, true);
    expect(j.closed).toBe(false);
    // b1 coincides with a2 and is dropped
    expect(j.points.map((p) => p.id)).toEqual(["a1", "a2", "b2"]);
  });

  it("reverses operands so any chosen ends meet", () => {
    const a = open(["a1", "a2"]); // join at a's FIRST → a reversed
    const b = open(["b1", "b2"]); // join at b's LAST → b reversed
    const j = joinContours(a, b, true, false);
    // a reversed: a2,a1 ; b reversed: b2,b1 ; drop b2 → a2,a1,b1
    expect(j.points.map((p) => p.id)).toEqual(["a2", "a1", "b1"]);
  });
});

describe("splitContourAt", () => {
  const xy = (c: Contour) => c.points.map((p) => [p.x, p.y]);

  it("cuts an open path mid-segment into two fragments sharing the cut point", () => {
    const c = open(["a", "b", "c", "d"]); // x = 0,10,20,30 on y=0
    const out = splitContourAt(c, 1, 0.5); // segment b→c at the midpoint (15,0)
    expect(out).toHaveLength(2);
    expect(xy(out[0]!)).toEqual([[0, 0], [10, 0], [15, 0]]);
    expect(xy(out[1]!)).toEqual([[15, 0], [20, 0], [30, 0]]);
    expect(out.every((f) => !f.closed)).toBe(true);
    // the duplicated cut point gets a fresh id (uniqueness across fragments)
    expect(out[0]!.points[2]!.id).not.toBe(out[1]!.points[0]!.id);
  });

  it("butt-caps the new cut ends, keeps the original terminal caps", () => {
    const c: Contour = { ...open(["a", "b", "c", "d"]), stroke: STROKE };
    const [a, b] = splitContourAt(c, 1, 0.5);
    expect(a!.stroke!.startCap).toBe("round"); // kept
    expect(a!.stroke!.endCap).toBe("butt"); // cut
    expect(b!.stroke!.startCap).toBe("butt"); // cut
    expect(b!.stroke!.endCap).toBe("rectangle"); // kept
    expect(b!.stroke).not.toBe(STROKE); // deep-cloned
  });

  it("cuts at an existing node without inserting a point", () => {
    const out = splitContourAt(open(["a", "b", "c", "d"]), 1, 0); // at node b
    expect(out).toHaveLength(2);
    expect(out[0]!.points.map((p) => p.id)).toEqual(["a", "b"]);
    expect(xy(out[1]!)).toEqual([[10, 0], [20, 0], [30, 0]]);
  });

  it("is a no-op when cutting at an open path's own terminal", () => {
    const c = open(["a", "b", "c"]);
    expect(splitContourAt(c, 0, 0)).toEqual([c]); // node a is the start terminal
    expect(splitContourAt(c, 1, 1)).toEqual([c]); // node c is the end terminal
  });

  it("opens a closed path into one path beginning and ending at the cut", () => {
    const square: Contour = {
      id: "sq",
      closed: true,
      points: [
        { id: "a", type: "corner", x: 0, y: 0 },
        { id: "b", type: "corner", x: 10, y: 0 },
        { id: "c", type: "corner", x: 10, y: 10 },
        { id: "d", type: "corner", x: 0, y: 10 },
      ],
    };
    const out = splitContourAt(square, 0, 0.5); // cut bottom edge at (5,0)
    expect(out).toHaveLength(1);
    expect(out[0]!.closed).toBe(false);
    expect(xy(out[0]!)).toEqual([[5, 0], [10, 0], [10, 10], [0, 10], [0, 0], [5, 0]]);
    expect(out[0]!.points[0]!.id).not.toBe(out[0]!.points[5]!.id); // duplicate has a fresh id
  });

  it("subdivides a curved segment so the cut lands on the curve, with handles", () => {
    const curve: Contour = {
      id: "cv",
      closed: false,
      points: [
        { id: "a", type: "smooth", x: 0, y: 0, handleOut: { x: 0, y: 10 } },
        { id: "b", type: "smooth", x: 10, y: 0, handleIn: { x: 10, y: 10 } },
      ],
    };
    const [a, b] = splitContourAt(curve, 0, 0.5);
    const mid = a!.points[a!.points.length - 1]!;
    expect(mid.x).toBeCloseTo(5, 9); // symmetric arc midpoint
    expect(mid.handleIn).toBeDefined();
    expect(b!.points[0]!.handleOut).toBeDefined();
  });

  it("returns the contour unchanged when it has fewer than two points", () => {
    const c: Contour = { id: "p", closed: false, points: [{ id: "a", type: "corner", x: 0, y: 0 }] };
    expect(splitContourAt(c, 0, 0.5)).toEqual([c]);
  });
});

describe("splitContourAtPoints (multi-cut — knife/eraser)", () => {
  const xs = (out: Contour[]) => out.map((c) => c.points.map((p) => Math.round(p.x * 10) / 10));

  it("cuts an open path at two interior points into three pieces", () => {
    const c = open(["a", "b", "c", "d"]); // x = 0,10,20,30 on y=0
    const out = splitContourAtPoints(c, [{ segIndex: 0, t: 0.5 }, { segIndex: 2, t: 0.5 }]);
    expect(out).toHaveLength(3);
    expect(out.every((p) => !p.closed)).toBe(true);
    expect(xs(out)).toEqual([[0, 5], [5, 10, 20, 25], [25, 30]]); // cut points duplicated across pieces
  });

  it("cuts two points on the SAME segment", () => {
    const out = splitContourAtPoints(open(["a", "b"]), [{ segIndex: 0, t: 0.25 }, { segIndex: 0, t: 0.75 }]);
    expect(out).toHaveLength(3);
    expect(xs(out)).toEqual([[0, 2.5], [2.5, 7.5], [7.5, 10]]);
  });

  it("opens a closed path into arcs between the cuts", () => {
    const sq: Contour = {
      id: "sq",
      closed: true,
      points: [
        { id: "a", type: "corner", x: 0, y: 0 },
        { id: "b", type: "corner", x: 10, y: 0 },
        { id: "c", type: "corner", x: 10, y: 10 },
        { id: "d", type: "corner", x: 0, y: 10 },
      ],
    };
    const out = splitContourAtPoints(sq, [{ segIndex: 0, t: 0.5 }, { segIndex: 2, t: 0.5 }]); // bottom + top mid
    expect(out).toHaveLength(2);
    expect(out.every((p) => !p.closed)).toBe(true);
  });

  it("is a no-op for no cuts or a cut at a terminal", () => {
    const c = open(["a", "b", "c"]);
    expect(splitContourAtPoints(c, [])).toEqual([c]);
    expect(splitContourAtPoints(c, [{ segIndex: 0, t: 0 }])).toEqual([c]); // snaps to the start terminal
  });
});
