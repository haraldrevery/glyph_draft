import { describe, it, expect } from "vitest";
import type { Viewport } from "../../types/viewport";
import {
  clampZoom,
  screenToWorld,
  worldToScreen,
  worldMatrix,
  zoomAt,
  MIN_ZOOM,
  MAX_ZOOM,
} from "./transform";

describe("worldToScreen / screenToWorld", () => {
  it("maps a world point to the expected screen pixel", () => {
    const vp: Viewport = { zoom: 2, pan: { x: 10, y: 300 } };
    expect(worldToScreen({ x: 100, y: 50 }, vp)).toEqual({ x: 210, y: 200 });
  });

  it("flips Y: increasing world Y moves up the screen (smaller screen Y)", () => {
    const vp: Viewport = { zoom: 3, pan: { x: 0, y: 0 } };
    const low = worldToScreen({ x: 0, y: 0 }, vp);
    const high = worldToScreen({ x: 0, y: 1 }, vp);
    expect(high.y).toBeLessThan(low.y);
  });

  it("round-trips through screenToWorld", () => {
    const vp: Viewport = { zoom: 1.7, pan: { x: 33, y: -12 } };
    const p = { x: 42, y: -7 };
    const back = screenToWorld(worldToScreen(p, vp), vp);
    expect(back.x).toBeCloseTo(42, 6);
    expect(back.y).toBeCloseTo(-7, 6);
  });
});

describe("worldMatrix", () => {
  it("encodes the single Y-flip as -zoom on the d term", () => {
    expect(worldMatrix({ zoom: 2, pan: { x: 10, y: 300 } })).toBe(
      "matrix(2,0,0,-2,10,300)",
    );
  });
});

describe("clampZoom", () => {
  it("clamps to [MIN_ZOOM, MAX_ZOOM]", () => {
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
    expect(clampZoom(0.00001)).toBe(MIN_ZOOM);
    expect(clampZoom(5)).toBe(5);
  });
});

describe("zoomAt", () => {
  it("keeps the world point under the cursor pinned (zoom-to-cursor)", () => {
    const vp: Viewport = { zoom: 1, pan: { x: 50, y: 80 } };
    const cursor = { x: 120, y: 90 };
    const before = screenToWorld(cursor, vp);
    const next = zoomAt(vp, 2.5, cursor);
    const after = screenToWorld(cursor, next);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(next.zoom).toBeCloseTo(2.5, 6);
  });
});
