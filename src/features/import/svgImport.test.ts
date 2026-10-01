import { describe, it, expect } from "vitest";
import { parseTransform, toPaint } from "./svgImport";
import { apply } from "../../engine/geometry/affine";

// (importSvg itself needs a DOM/DOMParser, so it's verified in-app; these cover the
// pure pieces — transform composition and the fill→paint mapping.)

describe("parseTransform", () => {
  it("composes a transform list left-to-right (applied outer→inner)", () => {
    // translate then scale: point (1,1) → scale → (2,2) → translate → (12,2).
    const m = parseTransform("translate(10 0) scale(2)");
    expect(apply(m, { x: 1, y: 1 })).toEqual({ x: 12, y: 2 });
  });
  it("reads a raw matrix(...)", () => {
    const m = parseTransform("matrix(1 0 0 1 5 7)");
    expect(apply(m, { x: 0, y: 0 })).toEqual({ x: 5, y: 7 });
  });
  it("returns identity for empty/absent", () => {
    expect(apply(parseTransform(null), { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
  });
});

describe("toPaint", () => {
  it("treats black / absent / fully-opaque as the default ink (no paint)", () => {
    expect(toPaint(undefined, 1)).toBeUndefined();
    expect(toPaint("black", 1)).toBeUndefined();
    expect(toPaint("#000000", 1)).toBeUndefined();
  });
  it("keeps a real colour and transparency", () => {
    expect(toPaint("#ff0000", 1)).toEqual({ fill: "#ff0000" });
    expect(toPaint("none", 1)).toEqual({ fill: "none" });
    expect(toPaint("#ff0000", 0.5)).toEqual({ fill: "#ff0000", opacity: 0.5 });
    expect(toPaint(undefined, 0.5)).toEqual({ opacity: 0.5 }); // black at 50%
  });
});

describe("import hardening (regression)", () => {
  it("transforms with CSS units read as numbers, not NaN", () => {
    expect(apply(parseTransform("translate(10px, 5px)"), { x: 0, y: 0 })).toEqual({ x: 10, y: 5 });
    const r = apply(parseTransform("rotate(90deg)"), { x: 1, y: 0 });
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(1);
  });

  it("an unparseable transform function is ignored rather than poisoning the points", () => {
    const p = apply(parseTransform("translate(oops) scale(2)"), { x: 1, y: 1 });
    expect(p).toEqual({ x: 2, y: 2 });
  });

  it("a paint server or currentColor falls back to the default ink (was invisible)", () => {
    expect(toPaint("url(#grad)", 1)).toBeUndefined();
    expect(toPaint('url("#grad")', 1)).toBeUndefined();
    expect(toPaint("currentColor", 1)).toBeUndefined();
  });
});

