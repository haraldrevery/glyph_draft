import { useMemo } from "react";
import { contoursToPath } from "../../engine/geometry/path";
import { glyphFillGroups } from "../canvas/layerFills";
import { getGeometryService } from "../../engine/geometry/geometryEngine";
import { useViewportStore } from "../../state/viewportStore";
import { DEFAULT_METRICS as M } from "../../constants/metrics";
import type { Glyph } from "../../types/document";

/**
 * A small filled silhouette of a glyph, framed to the em box and Y-flipped
 * (world is Y-up; SVG is Y-down). The viewBox spans the full em width and the
 * ascender→descender height so every thumbnail is at the same scale, making the
 * sidebar a quick visual index. A faint baseline gives empty glyphs something
 * to show and anchors the eye.
 *
 * Fills go through `glyphFillGroups` — the same builder the canvas and export use
 * — so strokes (expanded outlines), baked layers, and the boolean Pathfinder render
 * here exactly as they do everywhere else. Memoized on the glyph so only an edited
 * glyph's thumbnail recomputes (and `glyphFillGroups` caches per glyph too).
 */
export function GlyphThumbnail({ glyph }: { glyph: Glyph }) {
  const mergeHalftones = useViewportStore((s) => s.mergeHalftones);
  const fills = useMemo(
    () => glyphFillGroups(glyph, getGeometryService(), mergeHalftones),
    [glyph, mergeHalftones],
  );

  // World y ∈ [-descender, ascender] → after scale(1,-1), y ∈ [-ascender, descender].
  const minY = -M.ascender;
  const height = M.ascender + M.descender;

  return (
    <svg
      className="glyph-thumb"
      viewBox={`0 ${minY} ${M.unitsPerEm} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <g transform="scale(1,-1)">
        <line
          className="thumb-baseline"
          x1={0}
          y1={0}
          x2={M.unitsPerEm}
          y2={0}
          vectorEffect="non-scaling-stroke"
        />
        {fills.map((group) => {
          const d = contoursToPath(group.contours);
          return d ? (
            <path key={group.id} className="thumb-fill" d={d} fillRule="nonzero" />
          ) : null;
        })}
      </g>
    </svg>
  );
}
