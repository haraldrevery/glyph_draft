import { memo, useMemo } from "react";
import { contourToPath, contoursToPath } from "../../../engine/geometry/path";
import { getGeometryService } from "../../../engine/geometry/geometryEngine";
import { buildGlyphFills } from "../layerFills";
import { memberLayerIds } from "../../layers/layerTree";
import { linearGradientSpec, gradientId } from "../fillPaint";
import { useVisibleRenderLayers } from "../useGlyphContours";
import { useBooleanPairs, useLayerGroups } from "../../../state/documentStore";
import { useViewportStore } from "../../../state/viewportStore";

/**
 * Renders the active glyph as it will export. Fills are built by buildFillGroups:
 * each unpaired layer paints as one solid region (nonzero), and any two layers
 * joined by a boolean pair are combined by the geometry service (union/subtract/
 * intersect/exclude) into a single live result — non-destructively, so both
 * source layers stay separate and editable. Outlines are drawn per layer so every
 * shape stays visible/editable; a layer that feeds a boolean pair is drawn dashed
 * so its source shape stays distinguishable from the combined fill.
 *
 * Authored in world units inside the Y-flipped group; outlines use
 * non-scaling-stroke so they stay a constant width at any zoom. The boolean
 * computation is memoized on the layers + pairs so it only recomputes when the
 * geometry or the pairing actually changes.
 *
 * Wrapped in `memo` (it takes no props) so it does NOT re-render when its parent
 * (CanvasViewport) re-renders for a cursor move — it re-renders only when its own
 * store subscriptions change. Combined with the stable selectors in useGlyphContours,
 * this keeps `buildFillGroups` (and a heavy blend) from rebuilding on every mouse move.
 */
export const GlyphView = memo(function GlyphView() {
  const layers = useVisibleRenderLayers();
  const pairs = useBooleanPairs();
  const groups = useLayerGroups();
  const viewMode = useViewportStore((s) => s.viewMode);
  const previewPaths = useViewportStore((s) => s.previewPaths);
  const mergeHalftones = useViewportStore((s) => s.mergeHalftones);
  // edit = fills + outlines; outline = outlines only (fills hidden);
  // final = fills only, with the path-line outlines shown only when previewPaths.
  const showFills = viewMode !== "outline";
  const showOutlines = viewMode !== "final" || previewPaths;

  // Skip the boolean/stroke geometry entirely when fills are hidden (outline mode),
  // so heavy editing stays light.
  //
  // `buildGlyphFills` (not the cached `glyphFillGroups`) because the canvas needs the
  // live drag overrides in `layers`. It is the shared entry point that applies the
  // render-as-one group pre-pass, so the canvas and the export cannot diverge.
  const fills = useMemo(
    () =>
      showFills
        ? buildGlyphFills(layers, groups, pairs, getGeometryService(), { mergeHalftones })
        : [],
    [layers, groups, pairs, showFills, mergeHalftones],
  );

  // Layers whose outline is dashed because they take part in a boolean pair. An
  // operand can be a GROUP, so expand it to its member layers — otherwise a paired
  // folder would show no operand cue at all on the canvas.
  const pairedLayerIds = useMemo(() => {
    const set = new Set<string>();
    const add = (id: string): void => {
      set.add(id);
      const g = groups.find((x) => x.id === id);
      if (g) for (const m of memberLayerIds(groups, layers, id)) set.add(m);
    };
    for (const p of pairs) {
      add(p.layerIds[0]);
      add(p.layerIds[1]);
    }
    return set;
  }, [pairs, groups, layers]);

  if (layers.length === 0) return null;

  // Gradient defs for any group whose paint carries a gradient (one shared pure spec
  // per group, reused by the export/preview). objectBoundingBox so it tracks each path.
  const gradients = fills.map(linearGradientSpec).filter((g): g is NonNullable<typeof g> => g !== null);

  return (
    <g className={viewMode === "final" ? "glyph-view glyph-view-final" : "glyph-view"}>
      {gradients.length > 0 && (
        <defs>
          {gradients.map((g) => (
            <linearGradient key={g.id} id={g.id} gradientUnits="objectBoundingBox" gradientTransform={g.transform}>
              {g.stops.map((s, i) => (
                <stop
                  key={i}
                  offset={s.offset}
                  stopColor={s.color}
                  {...(s.opacity != null ? { stopOpacity: s.opacity } : {})}
                />
              ))}
            </linearGradient>
          ))}
        </defs>
      )}
      {fills.map((group) => {
        const d = contoursToPath(group.contours);
        if (!d) return null;
        // A coloured group sets its fill via inline STYLE, not the `fill` attribute —
        // an SVG `fill` attribute LOSES to the `.glyph-fill` CSS rule (presentation
        // attributes are the weakest cascade layer), so the colour would be ignored.
        // Inline style beats the class. A default (unpainted) group keeps no inline
        // style, so the `.glyph-fill` ink still drives it — monochrome look unchanged.
        // A gradient group fills via url(#id) (the same inline-style precedence).
        const paintStyle = group.paint
          ? {
              ...(group.paint.gradient
                ? { fill: `url(#${gradientId(group)})` }
                : group.paint.fill
                  ? { fill: group.paint.fill }
                  : {}),
              ...(group.paint.opacity != null ? { fillOpacity: group.paint.opacity } : {}),
            }
          : undefined;
        return (
          <path key={group.id} className="glyph-fill" d={d} fillRule="nonzero" style={paintStyle} />
        );
      })}
      {showOutlines &&
        layers.map((layer) => {
          const paired = pairedLayerIds.has(layer.id);
          return (
            <g key={layer.id} className="glyph-layer">
              {layer.contours.map((c) => (
                <path
                  key={c.id}
                  className={paired ? "glyph-outline glyph-outline-boolean" : "glyph-outline"}
                  style={{ stroke: layer.color }}
                  d={contourToPath(c)}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          );
        })}
    </g>
  );
});
