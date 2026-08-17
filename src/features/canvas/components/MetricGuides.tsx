import type { FontMetrics } from "../../../constants/metrics";
import { useViewportStore } from "../../../state/viewportStore";

/**
 * Horizontal metric lines (baseline, x-height, cap height, ascender, descender)
 * plus the two sidebearing verticals (x=0 and advance width). The baseline gets
 * its own class for stronger emphasis since it is the primary reference line.
 *
 * The four guide-line Y positions come from the user-adjustable `guides` (VISUAL
 * ONLY — they don't change the em box or export); `advanceWidth` stays from the
 * glyph's metrics (the em width).
 */
export function MetricGuides({ metrics }: { metrics: FontMetrics }) {
  const { ascender, descender, capHeight, xHeight } = useViewportStore((s) => s.guides);
  const { advanceWidth } = metrics;
  const left = 0;
  const right = advanceWidth;

  const hLine = (y: number, key: string, extra = "") => (
    <line
      key={key}
      x1={left}
      y1={y}
      x2={right}
      y2={y}
      className={`metric-line ${extra}`.trim()}
      vectorEffect="non-scaling-stroke"
    />
  );

  return (
    <g className="metrics">
      {hLine(ascender, "ascender")}
      {hLine(capHeight, "capheight")}
      {hLine(xHeight, "xheight")}
      {hLine(0, "baseline", "baseline")}
      {hLine(-descender, "descender")}
      <line
        x1={left}
        y1={-descender}
        x2={left}
        y2={ascender}
        className="metric-line sidebearing"
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={right}
        y1={-descender}
        x2={right}
        y2={ascender}
        className="metric-line sidebearing"
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}
