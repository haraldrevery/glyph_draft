import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useGlyphList } from "../../state/documentStore";
import { useViewportStore } from "../../state/viewportStore";
import { DEFAULT_METRICS } from "../../constants/metrics";
import { contoursToPath } from "../../engine/geometry/path";
import { getGeometryService } from "../../engine/geometry/geometryEngine";
import { glyphFillGroups, type FillGroup } from "../canvas/layerFills";
import { linearGradientSpec, gradientId } from "../canvas/fillPaint";
import { Slider } from "../../components/controls/Slider";
import type { Glyph } from "../../types/document";
import { layoutText } from "./textLayout";

/**
 * A quick "how will it read" window: type a string and see it set in the project's
 * glyphs, with simple mono spacing (~10% of each glyph's width). Renders the SAME
 * coloured fills as the canvas/export (via glyphFillGroups), so colour shows true.
 * A character with no glyph leaves a blank mono gap. Controlled by its caller.
 */

interface Props {
  open: boolean;
  onClose: () => void;
}

const SPACING = 0.1;
const LINE_HEIGHT = DEFAULT_METRICS.ascender + DEFAULT_METRICS.descender; // one em
const SPACE_WIDTH = Math.round(DEFAULT_METRICS.advanceWidth * 0.5);
const PAD = 60; // world-unit padding around the text in the preview frame
const STAGE_PAD_PX = 12; // .text-preview-stage CSS padding (var(--space-3)); excluded from wrap width
const SIZE_MIN = 24;
const SIZE_MAX = 160;

export function TextPreviewModal({ open, onClose }: Props) {
  const glyphs = useGlyphList();
  const [text, setText] = useState("Handgloves");
  // Glyph size in px-per-em (the type-tester size control). Modal-local; resets per open.
  const [sizePx, setSizePx] = useState(80);

  // Measure the stage so we can word-wrap the text to its width (in world units).
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(720);
  useLayoutEffect(() => {
    if (!open) return;
    const el = stageRef.current;
    if (!el) return;
    const update = () => setStageWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  const byCodepoint = useMemo(() => {
    const m = new Map<number, Glyph>();
    for (const g of glyphs) m.set(g.codepoint, g);
    return m;
  }, [glyphs]);

  // px-per-world-unit: one em (unitsPerEm) renders at `sizePx`. Wrap to the stage's
  // content width converted back to world units, so the glyph size stays constant and
  // long text flows into lines (the stage scrolls vertically).
  const scale = sizePx / DEFAULT_METRICS.unitsPerEm;
  const contentWidthPx = Math.max(stageWidth - 2 * STAGE_PAD_PX, 80);
  const maxWidthWorld = contentWidthPx / scale;

  const layout = useMemo(
    () =>
      layoutText(text, byCodepoint, {
        spacing: SPACING,
        spaceWidth: SPACE_WIDTH,
        lineHeight: LINE_HEIGHT,
        maxWidth: maxWidthWorld,
      }),
    [text, byCodepoint, maxWidthWorld],
  );

  // Fill groups per UNIQUE glyph in the layout (repeated letters reuse the result).
  const mergeHalftones = useViewportStore((s) => s.mergeHalftones);
  const fillsByGlyph = useMemo(() => {
    const geom = getGeometryService();
    const m = new Map<string, FillGroup[]>();
    for (const item of layout.items) {
      if (!m.has(item.glyph.id)) m.set(item.glyph.id, glyphFillGroups(item.glyph, geom, { mergeHalftones }));
    }
    return m;
  }, [layout, mergeHalftones]);

  // One shared <defs> for every gradient across the unique glyphs — group ids are
  // globally unique, so a repeated glyph reuses the same objectBoundingBox gradient.
  const gradients = useMemo(() => {
    const out = [];
    for (const groups of fillsByGlyph.values()) {
      for (const g of groups) {
        const spec = linearGradientSpec(g);
        if (spec) out.push(spec);
      }
    }
    return out;
  }, [fillsByGlyph]);

  // Esc closes the modal (capture phase so it doesn't also reach the canvas behind it).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  // World → SVG frame (Y-up → Y-down). Top = ascender of line 0; bottom = baseline of
  // the last line minus the descender.
  const top = DEFAULT_METRICS.ascender;
  const bottom = -(layout.height - layout.lineHeight) - DEFAULT_METRICS.descender;
  const vbX = -PAD;
  const vbY = -top - PAD;
  const vbW = Math.max(layout.width, SPACE_WIDTH) + PAD * 2;
  const vbH = top - bottom + PAD * 2;

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="text-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Text preview"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-preview-title">Text preview</h2>
        <p className="text-preview-sub">
          Your glyphs at mono spacing (~10%); characters without a glyph leave a blank gap.
        </p>

        <div className="text-preview-stage" ref={stageRef}>
          {layout.items.length === 0 ? (
            <p className="text-preview-empty">Type below — drawn glyphs will appear here.</p>
          ) : (
            <svg
              className="text-preview-svg"
              width={vbW * scale}
              height={vbH * scale}
              viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
              preserveAspectRatio="xMinYMin meet"
              role="img"
              aria-label={`Preview of: ${text}`}
            >
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
              <g transform="scale(1 -1)">
                {layout.items.map((item, i) => (
                  <g key={i} transform={`translate(${item.x} ${item.y})`}>
                    {(fillsByGlyph.get(item.glyph.id) ?? []).map((group) => {
                      const d = contoursToPath(group.contours);
                      if (!d) return null;
                      return (
                        <path
                          key={group.id}
                          d={d}
                          fillRule="nonzero"
                          fill={group.paint?.gradient ? `url(#${gradientId(group)})` : (group.paint?.fill ?? "#111111")}
                          {...(group.paint?.opacity != null ? { fillOpacity: group.paint.opacity } : {})}
                        />
                      );
                    })}
                  </g>
                ))}
              </g>
            </svg>
          )}
        </div>

        <div className="text-preview-size">
          <Slider
            label={`Size · ${sizePx} px`}
            value={sizePx}
            min={SIZE_MIN}
            max={SIZE_MAX}
            step={2}
            onChange={setSizePx}
          />
        </div>

        <textarea
          className="text-preview-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="Type a word or sentence…"
          aria-label="Preview text"
        />

        <div className="text-preview-actions">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
