import type { Viewport } from "../../../types/viewport";
import { worldToScreen } from "../../../engine/viewport/transform";
import { useViewportStore } from "../../../state/viewportStore";

/**
 * Metric line labels. These live in the NON-transformed overlay group and
 * compute their screen position from the world Y via worldToScreen — if they
 * were inside the flipped world group the text would render upside-down and
 * scale with zoom. Anchored at the left gutter so they stay readable. The four
 * guide rows track the user-adjustable `guides` (visual only), matching MetricGuides.
 */
export function MetricLabels({ viewport }: { viewport: Viewport }) {
  const guides = useViewportStore((s) => s.guides);
  const rows: Array<{ label: string; worldY: number }> = [
    { label: "ascender", worldY: guides.ascender },
    { label: "cap height", worldY: guides.capHeight },
    { label: "x-height", worldY: guides.xHeight },
    { label: "baseline", worldY: 0 },
    { label: "descender", worldY: -guides.descender },
  ];

  return (
    <g className="metric-labels">
      {rows.map(({ label, worldY }) => {
        const { y } = worldToScreen({ x: 0, y: worldY }, viewport);
        return (
          <text key={label} x={8} y={y - 4} className="metric-label">
            {label}
          </text>
        );
      })}
    </g>
  );
}
