import type { FontMetrics } from "../../../constants/metrics";

/**
 * The em square: the box from the sidebearing origin to the advance width,
 * spanning the full em vertically (descender..ascender). Rendered in world
 * space; the world group's Y-flip transform takes care of orientation.
 */
export function EmSquare({ metrics }: { metrics: FontMetrics }) {
  const { ascender, descender, advanceWidth } = metrics;
  return (
    <rect
      className="em-square"
      x={0}
      y={-descender}
      width={advanceWidth}
      height={ascender + descender}
      vectorEffect="non-scaling-stroke"
    />
  );
}
