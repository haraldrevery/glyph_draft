import type { Vec2 } from "../types/viewport";

/**
 * Font metrics, in font units. Coordinate convention: baseline at y=0, Y-up
 * (ascenders positive, descenders negative). `descender` is stored as a
 * positive magnitude; the descender line sits at y = -descender.
 *
 * In a later phase these become per-font, user-editable settings living in the
 * document store. For Phase 1 they are a fixed default so the metric guides and
 * em square have something to render.
 */
export interface FontMetrics {
  /** Units per em (UPM). FontForge's default is 1000. */
  unitsPerEm: number;
  ascender: number;
  /** Positive magnitude below the baseline. */
  descender: number;
  capHeight: number;
  xHeight: number;
  /** Default advance width for a fresh glyph. */
  advanceWidth: number;
}

export const DEFAULT_METRICS: FontMetrics = {
  unitsPerEm: 1000,
  ascender: 800,
  descender: 200,
  capHeight: 700,
  xHeight: 500,
  advanceWidth: 600,
};

export interface Box extends Vec2 {
  width: number;
  height: number;
}

/**
 * The em box in world coordinates: from the left sidebearing origin (x=0) to
 * the advance width, and vertically across the full em (descender..ascender).
 */
export function emBox(m: FontMetrics): Box {
  return {
    x: 0,
    y: -m.descender,
    width: m.advanceWidth,
    height: m.ascender + m.descender,
  };
}
