import { describe, it, expect } from "vitest";
import { isDefaultInk, isDefaultPaint, patchPaint, pinLegacyStrokePaint } from "./paint";
import type { Contour } from "../../types/geometry";

describe("patchPaint", () => {
  it("changes only the named property (multi-selection keeps each path's colour)", () => {
    expect(patchPaint({ fill: "#ff0000" }, { opacity: 0.5 })).toEqual({ fill: "#ff0000", opacity: 0.5 });
    expect(patchPaint({ fill: "#0000ff" }, { opacity: 0.5 })).toEqual({ fill: "#0000ff", opacity: 0.5 });
  });

  it("merges a gradient patch into the path's own gradient; null removes it", () => {
    const g = { angle: 10, to: "#fff", midpoint: 0.3, fade: 0.2 };
    expect(patchPaint({ fill: "#f00", gradient: g }, { gradient: { angle: 90 } })!.gradient).toEqual({ ...g, angle: 90 });
    expect(patchPaint({ fill: "#f00", gradient: g }, { gradient: null })).toEqual({ fill: "#f00" });
  });

  it("stores the default ink as no paint at all", () => {
    expect(patchPaint({ fill: "#ff0000" }, { fill: "#000000" })).toBeUndefined();
    expect(patchPaint(undefined, { opacity: 1 })).toBeUndefined();
    expect(isDefaultPaint({ fill: "#000000", opacity: 0.5 })).toBe(false);
    expect(isDefaultInk("#000")).toBe(true);
  });
});

describe("pinLegacyStrokePaint", () => {
  const stroked = (extra: Partial<Contour>): Contour => ({
    id: "c",
    closed: true,
    points: [],
    stroke: { width: 10, startCap: "butt", endCap: "butt", join: "miter" },
    ...extra,
  });

  it("writes the outline's current (fill-derived) colour onto the stroke", () => {
    expect(pinLegacyStrokePaint(stroked({ paint: { fill: "#ff0000" } })).stroke!.color).toBe("#ff0000");
    expect(pinLegacyStrokePaint(stroked({})).stroke!.color).toBe("#000000"); // default ink
  });

  it("carries a fill gradient onto the outline it was drawing", () => {
    const gradient = { angle: 0, to: "#fff", midpoint: 0.5, fade: 0.5 };
    expect(pinLegacyStrokePaint(stroked({ paint: { fill: "#f00", gradient } })).stroke!.gradient).toBe(gradient);
  });

  it("leaves a stroke that already has its own colour alone", () => {
    const c = stroked({ paint: { fill: "#f00" }, stroke: { width: 1, startCap: "butt", endCap: "butt", join: "miter", color: "#0f0" } });
    expect(pinLegacyStrokePaint(c)).toBe(c);
  });

  it("does not half-pin a semi-transparent legacy outline (opacity has no stroke field)", () => {
    const c = stroked({ paint: { fill: "#f00", opacity: 0.5 } });
    expect(pinLegacyStrokePaint(c)).toBe(c);
  });
});
