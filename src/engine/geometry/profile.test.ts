import { describe, it, expect } from "vitest";
import { evalProfile } from "./profile";
import type { StrokeProfile } from "../../types/geometry";

const profile = (pts: [number, number][], loop = false): StrokeProfile => ({
  points: pts.map(([x, y]) => ({ x, y })),
  loop,
});

/** Sample the profile densely for range/monotonicity checks. */
function sample(p: StrokeProfile, n = 200): number[] {
  return Array.from({ length: n + 1 }, (_, i) => evalProfile(p, i / n));
}

describe("evalProfile", () => {
  it("returns the endpoint values at t=0 and t=1", () => {
    const p = profile([[0, 0.5], [1, 1.5]]);
    expect(evalProfile(p, 0)).toBeCloseTo(0.5, 6);
    expect(evalProfile(p, 1)).toBeCloseTo(1.5, 6);
  });

  it("passes through every control point exactly", () => {
    const p = profile([[0, 1], [0.3, 0.4], [0.7, 1.8], [1, 1]]);
    for (const pt of p.points) expect(evalProfile(p, pt.x)).toBeCloseTo(pt.y, 6);
  });

  it("interpolates a flat profile to the constant value", () => {
    const p = profile([[0, 1], [1, 1]]);
    for (const v of sample(p)) expect(v).toBeCloseTo(1, 6);
  });

  it("clamps t outside [0,1] to the nearest endpoint", () => {
    const p = profile([[0, 0.2], [1, 1.9]]);
    expect(evalProfile(p, -5)).toBeCloseTo(0.2, 6);
    expect(evalProfile(p, 5)).toBeCloseTo(1.9, 6);
  });

  it("never overshoots a peak (monotone cubic stays within control range)", () => {
    const p = profile([[0, 1], [0.5, 2], [1, 1]]);
    const xs = sample(p);
    expect(Math.max(...xs)).toBeLessThanOrEqual(2 + 1e-9); // no spike above the peak
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(1 - 1e-9); // no dip below the base
    expect(evalProfile(p, 0.5)).toBeCloseTo(2, 6);
  });

  it("keeps a flat-then-rising profile from dipping below zero", () => {
    // (0,0)–(0.5,0) flat, then rising to (1,1): a width multiplier must not go negative.
    const p = profile([[0, 0], [0.5, 0], [1, 1]]);
    expect(evalProfile(p, 0.25)).toBeCloseTo(0, 6); // flat segment stays flat
    const rise = sample(p);
    expect(Math.min(...rise)).toBeGreaterThanOrEqual(0 - 1e-9);
    // the [0.5,1] half is monotonically non-decreasing
    for (let i = 100; i < rise.length; i += 1) expect(rise[i]!).toBeGreaterThanOrEqual(rise[i - 1]! - 1e-9);
  });

  it("handles degenerate point counts", () => {
    expect(evalProfile(profile([]), 0.5)).toBe(0);
    expect(evalProfile(profile([[0.4, 0.7]]), 0.9)).toBeCloseTo(0.7, 6);
  });
});
