import { describe, it, expect } from "vitest";
import { layoutText } from "./textLayout";
import type { Glyph } from "../../types/document";

function g(codepoint: number, advanceWidth: number): Glyph {
  return { id: `g${codepoint}`, codepoint, name: "", advanceWidth, layers: [] };
}

const A = g(0x41, 100);
const B = g(0x42, 200);
const map = new Map<number, Glyph>([
  [0x41, A],
  [0x42, B],
]);

describe("layoutText", () => {
  it("advances each glyph by width × (1 + spacing)", () => {
    const { items, width } = layoutText("AB", map, { spacing: 0.1, lineHeight: 1000 });
    expect(items[0]!.x).toBeCloseTo(0, 6); // A at 0
    expect(items[1]!.x).toBeCloseTo(110, 6); // B after 100×1.1
    expect(width).toBeCloseTo(110 + 220, 6); // + B's 200×1.1
    expect(items.map((i) => i.glyph.codepoint)).toEqual([0x41, 0x42]);
  });

  it("leaves a blank gap for a space and for a missing glyph (no item)", () => {
    const { items } = layoutText("A ZB", map, { spacing: 0, spaceWidth: 50 });
    // 'Z' (no glyph) and ' ' each advance 50, producing no item; A and B remain.
    expect(items.map((i) => i.glyph.codepoint)).toEqual([0x41, 0x42]);
    // A at 0; then space(50) → 150? no: A width 100 → x=100; space 50 → 150; Z 50 → 200; B at 200.
    expect(items[1]!.x).toBe(200);
  });

  it("wraps on newline, stepping the baseline down by lineHeight", () => {
    const { items, height, lineHeight } = layoutText("A\nB", map, { lineHeight: 1000 });
    expect(items[0]!.y).toBe(0); // line 0 baseline
    expect(items[1]!.y).toBe(-1000); // line 1 baseline (Y-up)
    expect(height).toBe(2000);
    expect(lineHeight).toBe(1000);
  });

  it("word-wraps at maxWidth, stepping each wrapped line down", () => {
    // Two words "A" (110) and "B" (220) with a space (50) between; maxWidth forces a wrap.
    const { items, height } = layoutText("A B", map, {
      spacing: 0.1,
      spaceWidth: 50,
      lineHeight: 1000,
      maxWidth: 150,
    });
    expect(items[0]!.y).toBe(0); // "A" on line 0
    expect(items[1]!.y).toBe(-1000); // "B" wrapped to line 1
    expect(items[1]!.x).toBe(0); // wrapped word starts at the line's left
    expect(height).toBe(2000); // two visual lines
  });

  it("keeps a single over-long word on one line (no infinite loop / no leading break)", () => {
    const { items, height } = layoutText("AB", map, { spacing: 0, maxWidth: 10 });
    expect(items.map((i) => i.glyph.codepoint)).toEqual([0x41, 0x42]); // both placed
    expect(items[0]!.y).toBe(0);
    expect(items[1]!.y).toBe(0); // same line — never wraps before the first word
    expect(height).toBe(1000);
  });

  it("no maxWidth ⇒ identical to the unwrapped layout", () => {
    const a = layoutText("A B A", map, { spacing: 0.1, spaceWidth: 50, lineHeight: 1000 });
    const b = layoutText("A B A", map, { spacing: 0.1, spaceWidth: 50, lineHeight: 1000, maxWidth: 0 });
    expect(a).toEqual(b);
  });
});
