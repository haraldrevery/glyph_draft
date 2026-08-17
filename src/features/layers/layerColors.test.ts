import { describe, it, expect } from "vitest";
import { layerColor, layerColorMap } from "./layerColors";

describe("layerColor", () => {
  it("gives the first several layers distinct colors", () => {
    const first = [0, 1, 2, 3, 4].map(layerColor);
    expect(new Set(first).size).toBe(first.length); // all distinct
  });

  it("cycles the palette for large stacks and is stable per index", () => {
    expect(layerColor(8)).toBe(layerColor(0)); // 8-color palette wraps
    expect(layerColor(3)).toBe(layerColor(3));
  });
});

describe("layerColorMap", () => {
  it("assigns colors by position", () => {
    const m = layerColorMap(["a", "b", "c"]);
    expect(m.get("a")).toBe(layerColor(0));
    expect(m.get("b")).toBe(layerColor(1));
    expect(m.get("c")).toBe(layerColor(2));
  });
});
