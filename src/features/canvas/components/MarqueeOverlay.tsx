import { worldToScreen } from "../../../engine/viewport/transform";
import { useEditorStore } from "../../../state/editorStore";
import type { Viewport } from "../../../types/viewport";

/**
 * The in-progress marquee (box-select) rectangle, drawn in screen space so it
 * stays a constant pixel width at any zoom. The select tool stores the two
 * world-space corners; here they're projected and emitted as a dashed <rect>.
 */
export function MarqueeOverlay({ viewport }: { viewport: Viewport }) {
  const marquee = useEditorStore((s) => s.marquee);
  if (!marquee) return null;
  const a = worldToScreen(marquee.a, viewport);
  const b = worldToScreen(marquee.b, viewport);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.abs(a.x - b.x);
  const height = Math.abs(a.y - b.y);
  if (width < 1 && height < 1) return null; // nothing to show before the drag starts
  return <rect className="marquee-rect" x={x} y={y} width={width} height={height} />;
}
