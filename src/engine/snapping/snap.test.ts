import { describe, it, expect } from "vitest";
import { snapPoint, snapValue, constrainAngle } from "./snap";

describe("snapValue", () => {
  it("rounds to the nearest grid multiple", () => {
    expect(snapValue(7, 5)).toBe(5);
    expect(snapValue(8, 5)).toBe(10);
    expect(snapValue(-3, 5)).toBe(-5);
  });

  it("is a no-op when the grid size is non-positive", () => {
    expect(snapValue(13, 0)).toBe(13);
    expect(snapValue(13, -5)).toBe(13);
  });
});

describe("snapPoint", () => {
  it("snaps both axes when enabled", () => {
    expect(snapPoint({ x: 7, y: 8 }, 5, true)).toEqual({ x: 5, y: 10 });
  });

  it("returns the point unchanged when disabled", () => {
    expect(snapPoint({ x: 7, y: 8 }, 5, false)).toEqual({ x: 7, y: 8 });
  });
});

describe("constrainAngle", () => {
  const O = { x: 0, y: 0 };
  const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

  it("snaps a near-horizontal drag to 0° (keeps distance)", () => {
    const r = constrainAngle(O, { x: 100, y: 12 }, 45);
    near(r.x, Math.hypot(100, 12)); // distance preserved on the +x axis
    near(r.y, 0);
  });

  it("snaps a near-vertical drag to 90°", () => {
    const r = constrainAngle(O, { x: 8, y: 100 }, 45);
    near(r.x, 0);
    near(r.y, Math.hypot(8, 100));
  });

  it("snaps a ~45° drag onto the exact diagonal", () => {
    const r = constrainAngle(O, { x: 90, y: 100 }, 45);
    near(r.x, r.y); // lands on y = x
  });

  it("works off-origin and leaves a zero-length drag unchanged", () => {
    const a = { x: 10, y: 20 };
    expect(constrainAngle(a, a, 45)).toEqual(a);
    const r = constrainAngle(a, { x: 60, y: 22 }, 45); // near +x from a
    near(r.y, 20);
    near(r.x, 10 + Math.hypot(50, 2));
  });
});
