import { describe, it, expect } from "vitest";
import { cloneContourWithNewIds } from "./glyphHelpers";
import {
  closeEnds,
  extractContours,
  joinContours,
  reverseContour as reverseWithNewId,
  splitContourAt,
  splitContourAtPoints,
} from "../engine/geometry/topology";
import { ensureWinding, reverseContour } from "../engine/geometry/path";
import { transformSelected, translate } from "../engine/geometry/affine";
import { convertPoint } from "../engine/geometry/nodeHandles";
import { roundCorners } from "../engine/geometry/corners";
import { translatePoint } from "../features/tools/shared";
import type { AnchorPoint, Contour } from "../types/geometry";

/**
 * GUARD against the "field-by-field rebuild" rake.
 *
 * Every operation that copies or rebuilds a contour or a node must carry the fields it
 * does not know about. A copy that LISTS the fields to keep compiles clean when a new
 * optional field is added, and silently drops it — that is how paste/duplicate once lost
 * `paint`/`filled`/`corner`, and how cut / delete-split / scissors / merge-endpoints lost
 * them later. So this test plants an unknown field on a contour and on each of its nodes
 * and runs it through every copy site; adding a new copy site? Add it here.
 */

type Probe = { probe?: string };
const pt = (id: string, x: number, y: number): AnchorPoint & Probe => ({ id, type: "corner", x, y, probe: `pt:${id}` });
const contour = (closed: boolean): Contour & Probe => ({
  id: "c",
  closed,
  probe: "contour",
  points: [pt("a", 0, 0), pt("b", 100, 0), pt("c", 100, 100), pt("d", 0, 100)],
});

/** Every output contour carries the contour probe; every surviving node carries its own. */
function expectProbes(out: Contour[]): void {
  expect(out.length).toBeGreaterThan(0);
  for (const c of out) {
    expect((c as Contour & Probe).probe).toBe("contour");
    for (const p of c.points) {
      // Nodes CREATED by the op (a cut point, a fillet) have no source to inherit from.
      if (["a", "b", "c", "d"].includes(p.id)) expect((p as AnchorPoint & Probe).probe).toBe(`pt:${p.id}`);
    }
  }
}

describe("unknown fields survive every contour/node copy", () => {
  it("paste / duplicate (cloneContourWithNewIds) — keeps them, though ids change", () => {
    const out = cloneContourWithNewIds(contour(true));
    expect((out as Contour & Probe).probe).toBe("contour");
    expect(out.points.map((p) => (p as AnchorPoint & Probe).probe)).toEqual(["pt:a", "pt:b", "pt:c", "pt:d"]);
  });

  it("delete-split / Cut (extractContours)", () => expectProbes(extractContours(contour(true), new Set(["a", "b", "c"]))));
  it("scissors (splitContourAt)", () => expectProbes(splitContourAt(contour(false), 1, 0.5)));
  it("knife / eraser (splitContourAtPoints)", () => expectProbes(splitContourAtPoints(contour(true), [{ segIndex: 0, t: 0.3 }])));
  it("merge endpoints (joinContours)", () => {
    const other = { ...contour(false), id: "o", points: [pt("a", 0, 0), pt("b", -50, 0)] };
    expectProbes([joinContours(contour(false), other, true, true)]);
  });
  it("close a path (closeEnds)", () => expectProbes([closeEnds(contour(false), "end")]));
  it("reverse / winding fix (reverseContour, ensureWinding)", () => {
    expectProbes([reverseContour(contour(true)), reverseWithNewId(contour(true))]);
    expectProbes([ensureWinding(contour(true), "ccw"), ensureWinding(contour(true), "cw")]);
  });
  it("node drag / nudge (translatePoint)", () => {
    const c = contour(true);
    expectProbes([{ ...c, points: c.points.map((p) => translatePoint(p, { x: 5, y: 5 })) }]);
  });
  it("transform box / flip / align (transformSelected)", () => {
    expectProbes(transformSelected([contour(true)], new Set(["a", "b"]), translate(3, 4)));
  });
  it("node continuity (convertPoint: smooth / cusp / corner)", () => {
    const c = contour(true);
    for (const mode of ["smooth", "cusp", "corner"] as const) {
      expect((convertPoint(c, "b", mode) as AnchorPoint & Probe).probe).toBe("pt:b");
    }
  });
  it("path corners (roundCorners)", () => {
    expectProbes([roundCorners(contour(true), { type: "round", radius: 10 })]);
  });
});
