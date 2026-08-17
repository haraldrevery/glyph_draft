import type { StrokeStyle } from "../../types/geometry";

/**
 * Built-in brush presets — a starter "brush library". Applying one is just
 * setting the target path's StrokeStyle (non-destructive: the centerline is
 * untouched and the stroke can be re-edited or re-brushed anytime). Kept as plain
 * constants (no persistence) for now; a user-savable library is a later phase.
 */
export interface BrushPreset {
  id: string;
  label: string;
  style: StrokeStyle;
}

export const BRUSH_PRESETS: BrushPreset[] = [
  {
    id: "uniform",
    label: "Uniform",
    style: { width: 40, startCap: "round", endCap: "round", join: "round" },
  },
  {
    id: "broad-30",
    label: "Broad nib 30°",
    style: { width: 70, startCap: "butt", endCap: "butt", join: "round", angle: 30, contrast: 0.12 },
  },
  {
    id: "broad-45",
    label: "Broad nib 45°",
    style: { width: 70, startCap: "butt", endCap: "butt", join: "round", angle: 45, contrast: 0.12 },
  },
  {
    id: "serifed",
    label: "Serifed stem",
    style: {
      width: 40,
      startCap: "serif",
      endCap: "serif",
      join: "miter",
      startSerif: { length: 70, depth: 60 },
      endSerif: { length: 70, depth: 60 },
    },
  },
  {
    id: "ink-drop",
    label: "Ink drop",
    style: {
      width: 30,
      startCap: "round",
      endCap: "drop",
      join: "round",
      endDrop: { size: 60, ratio: 1.6, smear: 0.6, anchor: "far" },
    },
  },
];
