import { worldToScreen } from "../../../engine/viewport/transform";
import { useActiveLayerId } from "../../../state/documentStore";
import { useEditorStore } from "../../../state/editorStore";
import type { AnchorPoint, Contour } from "../../../types/geometry";
import type { Vec2, Viewport } from "../../../types/viewport";
import { useEditableLayers } from "../useGlyphContours";

/**
 * The editing chrome, drawn in screen space so markers stay a constant pixel
 * size at any zoom: a square for corner anchors, a circle for smooth ones, and
 * — only for SELECTED anchors — their bezier handles as a line plus a dot.
 * Selection is shown in the ember accent (reserved for live interaction). The
 * pen's not-yet-committed point is drawn here too, so you can see the next
 * anchor and its handles forming before release.
 *
 * Phase 5: anchors are shown for EVERY editable (visible + unlocked) layer, not
 * just the active one, so contours can be selected across layers for the
 * cross-layer boolean / compound-path workflow. Non-active layers are dimmed so
 * the active editing target still reads clearly.
 */

const HALF = 3; // half-side for corner squares
const R_SMOOTH = 3.5; // radius for smooth-anchor circles
const R_HANDLE = 2.75; // radius for handle dots

function key(layerId: string, contourId: string, pointId: string): string {
  return `${layerId}:${contourId}:${pointId}`;
}

function Handle({ anchor, handle }: { anchor: Vec2; handle: Vec2 }) {
  return (
    <g className="anchor-handle">
      <line x1={anchor.x} y1={anchor.y} x2={handle.x} y2={handle.y} />
      <circle cx={handle.x} cy={handle.y} r={R_HANDLE} />
    </g>
  );
}

function Anchor({
  point,
  screen,
  selected,
  color,
}: {
  point: AnchorPoint;
  screen: Vec2;
  selected: boolean;
  color: string;
}) {
  const cls = selected ? "anchor anchor-selected" : "anchor";
  // Unselected anchors take their layer's color (so you can tell layers apart);
  // selected ones keep the accent via .anchor-selected.
  const style = selected ? undefined : { stroke: color };
  if (point.type === "smooth") {
    return <circle className={cls} style={style} cx={screen.x} cy={screen.y} r={R_SMOOTH} />;
  }
  return (
    <rect
      className={cls}
      style={style}
      x={screen.x - HALF}
      y={screen.y - HALF}
      width={HALF * 2}
      height={HALF * 2}
    />
  );
}

export function EditOverlay({ viewport }: { viewport: Viewport }) {
  const layers = useEditableLayers();
  const activeLayerId = useActiveLayerId();
  const selection = useEditorStore((s) => s.selection);
  const pending = useEditorStore((s) => s.pen.pending);

  const selected = new Set(selection.map((r) => key(r.layerId, r.contourId, r.pointId)));
  const activeEditable = layers.some((l) => l.id === activeLayerId);
  const activeColor = layers.find((l) => l.id === activeLayerId)?.color ?? "#5b9cff";

  const renderPoint = (
    layerId: string,
    contour: Contour,
    point: AnchorPoint,
    color: string,
  ) => {
    const screen = worldToScreen(point, viewport);
    const isSelected = selected.has(key(layerId, contour.id, point.id));
    return (
      <g key={point.id}>
        {isSelected && point.handleIn && (
          <Handle anchor={screen} handle={worldToScreen(point.handleIn, viewport)} />
        )}
        {isSelected && point.handleOut && (
          <Handle anchor={screen} handle={worldToScreen(point.handleOut, viewport)} />
        )}
        <Anchor point={point} screen={screen} selected={isSelected} color={color} />
      </g>
    );
  };

  return (
    <g className="edit-overlay">
      {layers.map((layer) => (
        <g
          key={layer.id}
          className={layer.id === activeLayerId ? undefined : "overlay-inactive"}
        >
          {layer.contours.map((contour) => (
            <g key={contour.id}>
              {contour.points.map((p) => renderPoint(layer.id, contour, p, layer.color))}
            </g>
          ))}
        </g>
      ))}

      {pending && activeEditable && (
        <g className="pen-pending">
          {pending.handleOut && (
            <Handle
              anchor={worldToScreen(pending, viewport)}
              handle={worldToScreen(pending.handleOut, viewport)}
            />
          )}
          {pending.handleIn && (
            <Handle
              anchor={worldToScreen(pending, viewport)}
              handle={worldToScreen(pending.handleIn, viewport)}
            />
          )}
          <Anchor
            point={pending}
            screen={worldToScreen(pending, viewport)}
            selected
            color={activeColor}
          />
        </g>
      )}
    </g>
  );
}
