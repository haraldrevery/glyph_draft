import { worldToScreen } from "../../../engine/viewport/transform";
import { useEditorStore } from "../../../state/editorStore";
import type { Viewport } from "../../../types/viewport";

/**
 * The in-progress freeform lasso, drawn in screen space (constant pixel width at
 * any zoom). Rendered as a <polygon> so it shows closed — the same closed ring
 * the lasso tool uses for its point-in-polygon node test.
 */
export function LassoOverlay({ viewport }: { viewport: Viewport }) {
  const lasso = useEditorStore((s) => s.lasso);
  if (!lasso || lasso.length < 2) return null;
  const points = lasso
    .map((p) => {
      const s = worldToScreen(p, viewport);
      return `${s.x},${s.y}`;
    })
    .join(" ");
  return <polygon className="lasso-path" points={points} />;
}
