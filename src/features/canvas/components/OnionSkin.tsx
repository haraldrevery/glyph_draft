import { useMemo } from "react";
import { contoursToPath } from "../../../engine/geometry/path";
import { useActiveGlyphId, useDocumentStore } from "../../../state/documentStore";
import { useOnionStore } from "../../../state/onionStore";
import { useViewportStore } from "../../../state/viewportStore";
import { glyphFillGroups } from "../layerFills";
import { getGeometryService } from "../../../engine/geometry/geometryEngine";
import type { Glyph } from "../../../types/document";

/**
 * Onion-skinning: the chosen reference glyphs drawn faintly behind the active
 * one, in the SAME shared coordinate space (em square + baseline are common to
 * every glyph), so heights, widths, and overshoots line up directly — the point
 * of the feature. Rendered in the Y-flipped world group, before GlyphView so it
 * sits underneath, and non-interactive. The active glyph is never ghosted, and
 * references that point at a since-deleted glyph are simply skipped.
 *
 * Two ghost modes (`onionStore.renderSvg`): the raw contour skeleton (default), or
 * the TRUE rendered output — expanded strokes, Pathfinder booleans, baked/imported
 * layers — via `glyphFillGroups` (the same builder the glyph thumbnails/export use),
 * drawn as a monochrome silhouette.
 */
export function OnionSkin() {
  const enabled = useOnionStore((s) => s.enabled);
  const opacity = useOnionStore((s) => s.opacity);
  const renderSvg = useOnionStore((s) => s.renderSvg);
  const referenceIds = useOnionStore((s) => s.referenceIds);
  const glyphs = useDocumentStore((s) => s.glyphs);
  const activeGlyphId = useActiveGlyphId();

  if (!enabled) return null;
  const refs = referenceIds.filter((id) => id !== activeGlyphId && glyphs[id]);
  if (refs.length === 0) return null;

  return (
    <g className="onion-skin" style={{ opacity }} pointerEvents="none">
      {refs.map((id) => (
        <OnionGlyph key={id} glyph={glyphs[id]!} renderSvg={renderSvg} />
      ))}
    </g>
  );
}

/** One ghosted reference glyph. Split out so the rendered-output fill build can be
 *  memoized per glyph (and the per-glyph cache in `glyphFillGroups` keeps it cheap). */
function OnionGlyph({ glyph, renderSvg }: { glyph: Glyph; renderSvg: boolean }) {
  const mergeHalftones = useViewportStore((s) => s.mergeHalftones);

  // The true rendered output as a single monochrome silhouette (paint ignored).
  const renderedD = useMemo(() => {
    if (!renderSvg) return null;
    return glyphFillGroups(glyph, getGeometryService(), { mergeHalftones })
      .map((g) => contoursToPath(g.contours))
      .filter(Boolean)
      .join(" ");
  }, [renderSvg, glyph, mergeHalftones]);

  if (renderSvg) {
    return renderedD ? (
      <g className="onion-glyph">
        <path className="onion-fill" d={renderedD} fillRule="nonzero" />
      </g>
    ) : null;
  }

  // Raw skeleton: a naive nonzero fill of the closed contours + the outline.
  const contours = glyph.layers.filter((l) => l.visible).flatMap((l) => l.contours);
  if (contours.length === 0) return null;
  const fillD = contoursToPath(contours.filter((c) => c.closed));
  return (
    <g className="onion-glyph">
      {fillD && <path className="onion-fill" d={fillD} fillRule="nonzero" />}
      <path
        className="onion-outline"
        d={contoursToPath(contours)}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}
