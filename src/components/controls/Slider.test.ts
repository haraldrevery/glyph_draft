import { describe, it, expect } from "vitest";
import { clampToStep } from "./Slider";

describe("clampToStep", () => {
  it("clamps below min and above max", () => {
    expect(clampToStep(-5, 0, 100, 1)).toBe(0);
    expect(clampToStep(250, 0, 100, 1)).toBe(100);
  });
  it("snaps to the nearest step offset from min", () => {
    expect(clampToStep(13, 0, 100, 5)).toBe(15);
    expect(clampToStep(12, 0, 100, 5)).toBe(10);
    expect(clampToStep(7, 1, 100, 3)).toBe(7); // 1 + 2*3
  });
  it("snaps to the nearest in-range step (not past max)", () => {
    expect(clampToStep(99, 0, 100, 40)).toBe(80); // steps {0,40,80}; 99→nearest 80
    expect(clampToStep(95, 0, 100, 40)).toBe(80); // 95→80 (120 would clamp, but 80 is nearer)
  });
  it("passes through when step is 0", () => {
    expect(clampToStep(42.7, 0, 100, 0)).toBe(42.7);
  });
});
