import { describe, it, expect } from "vitest";
import { withOverrides } from "./useGlyphContours";
import type { Contour } from "../../types/geometry";

const c = (id: string, x = 0): Contour => ({
  id,
  closed: false,
  points: [
    { id: `${id}0`, type: "corner", x, y: 0 },
    { id: `${id}1`, type: "corner", x: x + 1, y: 0 },
  ],
});

describe("withOverrides", () => {
  it("keeps a layer's array identity when none of its contours is dragged", () => {
    // The render-as-one bake cache keys on these arrays; a fresh array per drag frame
    // re-baked every group on every frame.
    const layer = [c("a"), c("b")];
    expect(withOverrides(layer, new Map([["z", c("z", 9)]]))).toBe(layer);
    expect(withOverrides(layer, null)).toBe(layer);
  });

  it("substitutes the dragged contour (new array) when one is", () => {
    const layer = [c("a"), c("b")];
    const moved = c("b", 50);
    const out = withOverrides(layer, new Map([["b", moved]]));
    expect(out).not.toBe(layer);
    expect(out[0]).toBe(layer[0]);
    expect(out[1]).toBe(moved);
  });
});
