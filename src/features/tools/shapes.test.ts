import { describe, it, expect } from "vitest";
import { squareBox, centerBox } from "./shapes";

/**
 * The Shift-constrain helper for the shape tools: equalises the box to a square
 * footprint (→ square / circle / regular polygon) while preserving each side's
 * drag direction.
 */
describe("squareBox", () => {
  it("equalises to the larger side, keeping signs", () => {
    expect(squareBox({ x: 0, y: 0, width: 30, height: 10 })).toEqual({ x: 0, y: 0, width: 30, height: 30 });
    expect(squareBox({ x: 5, y: 5, width: -8, height: 40 })).toEqual({ x: 5, y: 5, width: -40, height: 40 });
  });

  it("keeps a negative-up drag square in both axes", () => {
    expect(squareBox({ x: 0, y: 0, width: -50, height: -20 })).toEqual({ x: 0, y: 0, width: -50, height: -50 });
  });
});

/**
 * "Draw from center": the anchor (the box's x,y = the drag start) becomes the box
 * CENTER and the box grows symmetrically (double the extent).
 */
describe("centerBox", () => {
  it("centers the box on its anchor and doubles the size", () => {
    // anchor (10,10), corner at (40,30) → extent (30,20) → centered box spans (-20..40, -10..30).
    expect(centerBox({ x: 10, y: 10, width: 30, height: 20 })).toEqual({ x: -20, y: -10, width: 60, height: 40 });
  });

  it("preserves drag-direction signs", () => {
    expect(centerBox({ x: 0, y: 0, width: -8, height: 5 })).toEqual({ x: 8, y: -5, width: -16, height: 10 });
  });

  it("composes with squareBox for a centered square", () => {
    expect(centerBox(squareBox({ x: 0, y: 0, width: 30, height: 10 }))).toEqual({ x: -30, y: -30, width: 60, height: 60 });
  });
});
