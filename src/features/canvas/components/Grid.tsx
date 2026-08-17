import { useMemo } from "react";
import type { Size, Viewport } from "../../../types/viewport";
import { visibleWorldBounds } from "../../../engine/viewport/transform";

/** Above this many lines the grid would be visual noise (and slow); skip it. */
const MAX_LINES = 600;

interface GridProps {
  viewport: Viewport;
  size: Size;
  gridSize: number;
}

/**
 * Drawn inside the world-space <g>, so coordinates are font units. Strokes use
 * vector-effect="non-scaling-stroke" to stay a crisp 1px regardless of zoom —
 * the grid is UI, not geometry, so it should not get thicker as you zoom in.
 */
export function Grid({ viewport, size, gridSize }: GridProps) {
  const lines = useMemo(() => {
    if (gridSize <= 0) return null;
    const b = visibleWorldBounds(viewport, size);
    const minX = b.x;
    const minY = b.y;
    const maxX = b.x + b.width;
    const maxY = b.y + b.height;

    const startX = Math.floor(minX / gridSize) * gridSize;
    const startY = Math.floor(minY / gridSize) * gridSize;
    const vCount = Math.ceil((maxX - startX) / gridSize) + 1;
    const hCount = Math.ceil((maxY - startY) / gridSize) + 1;

    if (vCount < 0 || hCount < 0 || vCount + hCount > MAX_LINES) return null;

    const verticals = [];
    for (let i = 0; i < vCount; i += 1) {
      const x = startX + i * gridSize;
      verticals.push(
        <line
          key={`v${x}`}
          x1={x}
          y1={minY}
          x2={x}
          y2={maxY}
          className="grid-line"
          vectorEffect="non-scaling-stroke"
        />,
      );
    }
    const horizontals = [];
    for (let i = 0; i < hCount; i += 1) {
      const y = startY + i * gridSize;
      horizontals.push(
        <line
          key={`h${y}`}
          x1={minX}
          y1={y}
          x2={maxX}
          y2={y}
          className="grid-line"
          vectorEffect="non-scaling-stroke"
        />,
      );
    }
    return [...verticals, ...horizontals];
  }, [viewport, size, gridSize]);

  if (!lines) return null;
  return <g className="grid">{lines}</g>;
}
