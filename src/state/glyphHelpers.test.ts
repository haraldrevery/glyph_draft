import { describe, it, expect } from "vitest";
import { cloneContourWithNewIds, cloneLayer } from "./glyphHelpers";
import type { Contour } from "../types/geometry";
import type { Layer } from "../types/document";

describe("cloneContourWithNewIds", () => {
  it("copies the stroke (deep + independent) and assigns fresh ids", () => {
    const src: Contour = {
      id: "c1",
      closed: false,
      points: [
        { id: "p1", type: "corner", x: 0, y: 0 },
        { id: "p2", type: "corner", x: 10, y: 0 },
      ],
      stroke: {
        width: 40,
        startCap: "round",
        endCap: "drop",
        join: "round",
        endDrop: { size: 50, ratio: 1.4, smear: 0.5, anchor: "far" },
      },
    };
    const clone = cloneContourWithNewIds(src);

    expect(clone.id).not.toBe("c1");
    expect(clone.points[0]!.id).not.toBe("p1");
    expect(clone.stroke).toEqual(src.stroke); // value-equal (stroke preserved)
    expect(clone.stroke).not.toBe(src.stroke); // deep-cloned, not shared
    expect(clone.stroke!.endDrop).not.toBe(src.stroke!.endDrop); // nested too
  });

  it("leaves stroke undefined when the source has none", () => {
    const src: Contour = {
      id: "c",
      closed: true,
      points: [{ id: "p", type: "corner", x: 0, y: 0 }],
    };
    expect(cloneContourWithNewIds(src).stroke).toBeUndefined();
  });

  // Regression: the clone rebuilds the contour field-by-field, so it previously carried
  // ONLY `stroke` — paste / Ctrl+D / duplicate-layer silently lost the path's colour,
  // its fill-interior flag, and its corner rounding.
  it("carries paint, filled and corner (deep + independent)", () => {
    const src: Contour = {
      id: "c1",
      closed: true,
      points: [
        { id: "p1", type: "corner", x: 0, y: 0 },
        { id: "p2", type: "corner", x: 100, y: 0 },
        { id: "p3", type: "corner", x: 100, y: 100 },
      ],
      paint: { fill: "#ff0000", opacity: 0.5 },
      filled: true,
      corner: { type: "round", radius: 12 },
    };
    const clone = cloneContourWithNewIds(src);

    expect(clone.paint).toEqual(src.paint);
    expect(clone.paint).not.toBe(src.paint); // deep-cloned, not shared
    expect(clone.filled).toBe(true);
    expect(clone.corner).toEqual(src.corner);
    expect(clone.corner).not.toBe(src.corner);
  });

  it("carries filled:false rather than dropping it", () => {
    const src: Contour = {
      id: "c",
      closed: true,
      points: [{ id: "p", type: "corner", x: 0, y: 0 }],
      filled: false,
    };
    // `false` is meaningful (explicitly unfilled), so a truthiness check would lose it.
    expect(cloneContourWithNewIds(src).filled).toBe(false);
  });
});

describe("cloneLayer", () => {
  const baked = (over: Partial<Layer> = {}): Layer => ({
    id: "l1",
    name: "Imported",
    visible: true,
    locked: false,
    contours: [{ id: "c", closed: true, points: [{ id: "p", type: "corner", x: 0, y: 0 }] }],
    ...over,
  });

  // Regression: renderContours returns a BAKED layer's contours verbatim (Invariant 4's
  // exception). Dropping the flag force-CWs them, filling in the holes of a duplicated
  // SVG import / merged layer / expanded stroke.
  it("carries the baked flag", () => {
    expect(cloneLayer(baked({ baked: true })).baked).toBe(true);
  });

  // Regression guard for the field-by-field rebuild: a duplicated layer that silently
  // left its group would break the CONTIGUITY invariant (its clone is inserted directly
  // above it, inside the group's run) and quietly change what renders.
  it("carries groupId", () => {
    expect(cloneLayer(baked({ groupId: "grp_1" })).groupId).toBe("grp_1");
  });

  it("leaves groupId unset on an ungrouped layer", () => {
    expect(cloneLayer(baked()).groupId).toBeUndefined();
  });

  it("leaves baked unset on an ordinary layer", () => {
    expect(cloneLayer(baked()).baked).toBeUndefined();
  });

  it("assigns fresh ids and unlocks the copy", () => {
    const src = baked({ locked: true, baked: true });
    const clone = cloneLayer(src);
    expect(clone.id).not.toBe("l1");
    expect(clone.locked).toBe(false);
    expect(clone.contours[0]!.id).not.toBe("c");
  });
});
