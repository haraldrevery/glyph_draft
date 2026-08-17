import { describe, it, expect } from "vitest";
import { linearGradientSpec, gradientId } from "./fillPaint";
import type { FillGroup } from "./layerFills";

function group(paint: FillGroup["paint"]): FillGroup {
  return { id: "L1", contours: [], ...(paint ? { paint } : {}) };
}

describe("linearGradientSpec", () => {
  it("returns null for a group without a gradient", () => {
    expect(linearGradientSpec(group(undefined))).toBeNull();
    expect(linearGradientSpec(group({ fill: "#ff0000" }))).toBeNull();
  });

  it("uses the fill as the first stop and `to` as the second", () => {
    const spec = linearGradientSpec(
      group({ fill: "#ff0000", gradient: { angle: 0, to: "#0000ff", midpoint: 0.5, fade: 1 } }),
    )!;
    expect(spec.id).toBe("grad-L1");
    expect(spec.stops[0].color).toBe("#ff0000");
    expect(spec.stops[1].color).toBe("#0000ff");
    expect(spec.stops[0].offset).toBe(0); // midpoint .5 − fade/2 (.5) = 0
    expect(spec.stops[1].offset).toBe(1); // midpoint .5 + fade/2 (.5) = 1
  });

  it("defaults the first stop to black when fill is absent or 'none'", () => {
    const g = { angle: 0, to: "#0000ff", midpoint: 0.5, fade: 1 };
    expect(linearGradientSpec(group({ gradient: g }))!.stops[0].color).toBe("#000000");
    expect(linearGradientSpec(group({ fill: "none", gradient: g }))!.stops[0].color).toBe("#000000");
  });

  it("places the band at the midpoint with width = fade, clamped to [0,1]", () => {
    const spec = linearGradientSpec(
      group({ fill: "#000000", gradient: { angle: 0, to: "#fff", midpoint: 0.25, fade: 0.2 } }),
    )!;
    expect(spec.stops[0].offset).toBeCloseTo(0.15); // .25 − .1
    expect(spec.stops[1].offset).toBeCloseTo(0.35); // .25 + .1

    // fade 0 → both stops collapse to the midpoint (a hard split).
    const hard = linearGradientSpec(
      group({ fill: "#000000", gradient: { angle: 0, to: "#fff", midpoint: 0.6, fade: 0 } }),
    )!;
    expect(hard.stops[0].offset).toBeCloseTo(0.6);
    expect(hard.stops[1].offset).toBeCloseTo(0.6);
  });

  it("puts opacity on the second (To) stop only when toOpacity is set", () => {
    const withAlpha = linearGradientSpec(
      group({ fill: "#000000", gradient: { angle: 0, to: "#fff", midpoint: 0.5, fade: 1, toOpacity: 0.3 } }),
    )!;
    expect(withAlpha.stops[1].opacity).toBe(0.3);
    expect(withAlpha.stops[0].opacity).toBeUndefined(); // the `from` stop stays opaque

    const noAlpha = linearGradientSpec(
      group({ fill: "#000000", gradient: { angle: 0, to: "#fff", midpoint: 0.5, fade: 1 } }),
    )!;
    expect(noAlpha.stops[0].opacity).toBeUndefined();
    expect(noAlpha.stops[1].opacity).toBeUndefined(); // absent → no opacity (byte-identical)
  });

  it("negates the angle for the Y-flip in the gradientTransform", () => {
    const spec = linearGradientSpec(
      group({ fill: "#000000", gradient: { angle: 45, to: "#fff", midpoint: 0.5, fade: 1 } }),
    )!;
    expect(spec.transform).toBe("rotate(-45 0.5 0.5)");
  });

  it("gradientId is derived from the group id", () => {
    expect(gradientId(group(undefined))).toBe("grad-L1");
  });
});
