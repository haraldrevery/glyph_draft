import { contourToPath } from "../../../engine/geometry/path";
import { useEditorStore } from "../../../state/editorStore";
import type { AnchorPoint, Contour } from "../../../types/geometry";
import type { Vec2 } from "../../../types/viewport";
import { useActiveLayerContours } from "../useGlyphContours";

/**
 * Transient drawing feedback, in world space: the pen's next segment (either the
 * committed-anchor-to-pending segment while a handle is being dragged, or a
 * rubber band from the last anchor to the cursor while hovering) and the live
 * shape draft for the rectangle/ellipse/line tools. None of this is in the
 * document; it is rebuilt from ephemeral editor state every frame and styled as
 * a dashed accent so it reads as provisional.
 */

function corner(at: Vec2): AnchorPoint {
  return { id: "preview-cursor", type: "corner", x: at.x, y: at.y };
}

/** Path for a single segment between two anchors (uses out(a)/in(b) handles). */
function segmentPath(a: AnchorPoint, b: AnchorPoint): string {
  const contour: Contour = { id: "preview", closed: false, points: [a, b] };
  return contourToPath(contour);
}

export function PreviewLayer() {
  const contours = useActiveLayerContours();
  const pen = useEditorStore((s) => s.pen);
  const draft = useEditorStore((s) => s.draft);
  const cursor = useEditorStore((s) => s.cursor);

  const penContour = pen.contourId
    ? contours.find((c) => c.id === pen.contourId) ?? null
    : null;
  const lastAnchor =
    penContour && penContour.points.length > 0
      ? penContour.points[penContour.points.length - 1]!
      : null;

  // While placing a point: segment from the last anchor to the pending point.
  // Otherwise, while hovering an open path: rubber band to the cursor.
  let penPath: string | null = null;
  if (lastAnchor && pen.pending) {
    penPath = segmentPath(lastAnchor, pen.pending);
  } else if (lastAnchor && cursor) {
    penPath = segmentPath(lastAnchor, corner(cursor.snapped ?? cursor.raw));
  }

  return (
    <g className="preview-layer">
      {penPath && (
        <path className="preview-path" d={penPath} vectorEffect="non-scaling-stroke" />
      )}
      {draft && (
        <path
          className="preview-path"
          d={contourToPath(draft)}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  );
}
