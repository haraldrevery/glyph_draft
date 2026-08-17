import { describe, it, expect } from "vitest";
import {
  apply,
  translate,
  scaleAbout,
  rotateAbout,
  transformSelected,
  IDENTITY,
} from "./affine";
import type { AnchorPoint, Contour } from "../../types/geometry";

/** Round a Vec2 for tolerant comparison of trig results. */
function r(p: { x: number; y: number }) {
  return { x: Math.round(p.x * 1e6) / 1e6, y: Math.round(p.y * 1e6) / 1e6 };
}

describe("affine matrices", () => {
  it("identity and translate", () => {
    expect(apply(IDENTITY, { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
    expect(apply(translate(10, -5), { x: 3, y: 4 })).toEqual({ x: 13, y: -1 });
  });

  it("scaleAbout keeps the pivot fixed and scales the rest", () => {
    const pivot = { x: 100, y: 100 };
    expect(r(apply(scaleAbout(2, 2, pivot), pivot))).toEqual({ x: 100, y: 100 });
    expect(r(apply(scaleAbout(2, 3, pivot), { x: 110, y: 110 }))).toEqual({ x: 120, y: 130 });
  });

  it("rotateAbout origin maps (1,0)→(0,1) at 90°", () => {
    expect(r(apply(rotateAbout(Math.PI / 2, { x: 0, y: 0 }), { x: 1, y: 0 }))).toEqual({ x: 0, y: 1 });
  });

  it("rotateAbout keeps the pivot fixed", () => {
    const pivot = { x: 50, y: 20 };
    expect(r(apply(rotateAbout(0.7, pivot), pivot))).toEqual({ x: 50, y: 20 });
  });
});

describe("transformSelected", () => {
  const anchor = (id: string, x: number, y: number): AnchorPoint => ({
    id,
    type: "corner",
    x,
    y,
  });

  it("moves only selected anchors, and carries their handles", () => {
    const c: Contour = {
      id: "c",
      closed: false,
      points: [
        { id: "a", type: "smooth", x: 0, y: 0, handleOut: { x: 5, y: 0 } },
        anchor("b", 10, 0),
      ],
    };
    const out = transformSelected([c], new Set(["a"]), translate(100, 0));
    expect(out[0]!.points[0]).toEqual({
      id: "a",
      type: "smooth",
      x: 100,
      y: 0,
      handleOut: { x: 105, y: 0 },
    });
    expect(out[0]!.points[1]).toEqual(anchor("b", 10, 0)); // untouched
  });

  it("leaves a contour identity-equal when none of its points are selected", () => {
    const c: Contour = { id: "c", closed: true, points: [anchor("p", 1, 1)] };
    const out = transformSelected([c], new Set(["other"]), translate(5, 5));
    expect(out[0]).toBe(c);
  });
});
