import { describe, it, expect } from "vitest";
import { cascadeProp, parseOpacity, parseStyleSheet, parseTransform, toPaint, type StyleTarget } from "./svgImport";
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

describe("CSS cascade (style sheets, inline style, attributes)", () => {
  const el = (over: Partial<StyleTarget> & { attrs?: Record<string, string> } = {}): StyleTarget => ({
    tag: over.tag ?? "path",
    id: over.id ?? null,
    classes: over.classes ?? [],
    inlineStyle: over.inlineStyle ?? null,
    attr: (n) => over.attrs?.[n] ?? null,
  });

  it("reads Illustrator-style class rules (they used to be ignored → everything black)", () => {
    const rules = parseStyleSheet(".cls-1{fill:#e53935;}\n.cls-2, .cls-3 { fill: #1e88e5; fill-opacity: 0.5 }");
    expect(cascadeProp("fill", el({ classes: ["cls-1"] }), rules)).toBe("#e53935");
    expect(cascadeProp("fill", el({ classes: ["cls-3"] }), rules)).toBe("#1e88e5");
    expect(cascadeProp("fill-opacity", el({ classes: ["cls-2"] }), rules)).toBe("0.5");
  });

  it("applies CSS precedence: style=\"\" > sheet rule > presentation attribute", () => {
    const rules = parseStyleSheet(".a{fill:green}");
    const attrOnly = el({ attrs: { fill: "red" } });
    const attrAndRule = el({ classes: ["a"], attrs: { fill: "red" } });
    const all = el({ classes: ["a"], attrs: { fill: "red" }, inlineStyle: "fill: blue" });
    expect(cascadeProp("fill", attrOnly, rules)).toBe("red");
    expect(cascadeProp("fill", attrAndRule, rules)).toBe("green"); // was "red"
    expect(cascadeProp("fill", all, rules)).toBe("blue");
  });

  it("the more specific rule wins; at equal specificity the later one does", () => {
    const rules = parseStyleSheet("path{fill:red} .a{fill:green} .a{fill:teal} #x{fill:blue}");
    expect(cascadeProp("fill", el({ classes: ["a"] }), rules)).toBe("teal");
    expect(cascadeProp("fill", el({ classes: ["a"], id: "x" }), rules)).toBe("blue");
    expect(cascadeProp("fill", el(), rules)).toBe("red");
  });

  it("skips selectors it can't evaluate instead of mis-applying them", () => {
    const rules = parseStyleSheet("g .a{fill:red} .a:hover{fill:red} @media print{.a{fill:red}}");
    expect(cascadeProp("fill", el({ classes: ["a"] }), rules)).toBeNull();
  });

  it("parses opacity as a number or a percentage; an unusable value is ignored, not 0", () => {
    expect(parseOpacity("0.25")).toBe(0.25);
    expect(parseOpacity("50%")).toBe(0.5);
    expect(parseOpacity("inherit")).toBeNull(); // used to become 0 → invisible
    expect(parseOpacity("2")).toBe(1);
  });
});
