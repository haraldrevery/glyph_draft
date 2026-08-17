import { describe, it, expect } from "vitest";
import { cloneContourWithNewIds } from "./glyphHelpers";
import type { Contour } from "../types/geometry";

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
});
