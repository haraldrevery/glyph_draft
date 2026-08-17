import type { FillGroup } from "./layerFills";

/**
 * Pure helper that turns a fill group's optional `paint.gradient` into the data
 * every renderer needs to emit an SVG `<linearGradient>`. ONE place computes the
 * gradient geometry so the canvas (`GlyphView`), the text preview, and the export
 * (`glyphToSvg`) can never drift — each maps this spec to its own output (JSX vs.
 * string). Returns null for a group with no gradient (the solid-fill path is
 * unchanged).
 *
 * The gradient is `objectBoundingBox` (relative to the path bbox), so a single def
 * serves a glyph repeated across the text preview. The two stops sit at
 * `midpoint ∓ fade/2` (clamped): fade 0 = a hard split, fade 1 = a full blend. The
 * angle is NEGATED here because all three renderers wrap their content in a world→SVG
 * Y-flip (`scale(…, −…)`); negating keeps the knob's on-screen direction correct.
 */
export interface GradientStop {
  offset: number;
  color: string;
  /** Stop opacity (0–1); omitted = fully opaque. Only the `to` stop carries one,
   *  driven by `GradientFill.toOpacity`. */
  opacity?: number;
}

export interface GradientSpec {
  id: string;
  transform: string;
  stops: [GradientStop, GradientStop];
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** Compact number for SVG attributes (3 decimals max). */
function num(value: number): string {
  return (Math.round(value * 1000) / 1000).toString();
}

/** The DOM-unique id for a group's gradient. Layer/pair ids are globally unique, so
 *  this is safe even when many glyphs render at once (sidebar / text preview). A
 *  painted group's id carries the paint key (`layerId#fill|opacity`), whose `#`/`|`
 *  are illegal inside an SVG id / `url(#…)` reference, so non-id chars are mapped to
 *  `_` (the layerId prefix keeps it unique). */
export function gradientId(group: FillGroup): string {
  return `grad-${group.id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

export function linearGradientSpec(group: FillGroup): GradientSpec | null {
  const g = group.paint?.gradient;
  if (!g) return null;
  // First stop = the group's fill colour (default ink, never the "none" sentinel).
  const from = group.paint?.fill && group.paint.fill !== "none" ? group.paint.fill : "#000000";
  const half = clamp01(g.fade) / 2;
  const mid = clamp01(g.midpoint);
  const o0 = clamp01(mid - half);
  const o1 = clamp01(mid + half);
  // The `to` stop may carry an opacity (fade toward transparent); the `from` stop is
  // always opaque (the base fill's own opacity is the whole-group fill-opacity).
  const toStop: GradientStop =
    g.toOpacity != null ? { offset: o1, color: g.to, opacity: g.toOpacity } : { offset: o1, color: g.to };
  return {
    id: gradientId(group),
    transform: `rotate(${num(-g.angle)} 0.5 0.5)`,
    stops: [{ offset: o0, color: from }, toStop],
  };
}
