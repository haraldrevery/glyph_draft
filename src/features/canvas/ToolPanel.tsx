import { useState, type ComponentType } from "react";
import { useEditorStore, type ToolId } from "../../state/editorStore";
import { useViewportStore } from "../../state/viewportStore";
import { getTool } from "../tools";
import { NumberInput } from "../../components/controls/NumberInput";
import { Toggle } from "../../components/controls/Toggle";
import { CollapseButton } from "../../components/controls/CollapseButton";

/**
 * Contextual tool-options panel: the HUD shows the ACTIVE tool's settings (or
 * nothing if it has none). Like the Toolbar's `ICONS`, `TOOL_PANELS` is a
 * VIEW-layer map keyed by `ToolId` — `ToolDefinition` stays React-free (logic
 * only), and `TOOLS` remains the single source of which tools exist. To give a
 * tool its own options, write a small controls component and register it below;
 * it then gets a panel for free, the same way adding a tool gets a toolbar button.
 */

/** Shared shape-tool option: draw symmetrically from the start point (center) vs
 *  corner-to-corner. Used by rectangle/ellipse/polygon/triangle (all box-based). */
function FromCenterToggle() {
  const on = useViewportStore((s) => s.shapeFromCenter);
  const toggle = useViewportStore((s) => s.toggleShapeFromCenter);
  return <Toggle label="Draw from center" checked={on} onChange={toggle} />;
}

/** Rectangle / Ellipse / Triangle: just the draw-from-center option. */
function ShapeControls() {
  return (
    <div className="control-group">
      <FromCenterToggle />
    </div>
  );
}

/** Polygon tool: the regular-polygon side count (used by the polygon factory). */
function PolygonControls() {
  const sides = useViewportStore((s) => s.polygonSides);
  const setSides = useViewportStore((s) => s.setPolygonSides);
  return (
    <div className="control-group">
      <NumberInput label="Polygon sides" value={sides} min={3} max={24} step={1} onChange={setSides} />
      <FromCenterToggle />
    </div>
  );
}

/** Free-pen tool: how aggressively the raw cursor trail is simplified/smoothed. */
function FreehandControls() {
  const smoothing = useViewportStore((s) => s.freehandSmoothing);
  const setSmoothing = useViewportStore((s) => s.setFreehandSmoothing);
  return (
    <div className="control-group">
      <NumberInput label="Smoothing" value={smoothing} min={0} max={40} step={1} onChange={setSmoothing} />
    </div>
  );
}

/** Eraser tool: the pick radius (also the on-canvas size indicator), in screen px. */
function EraserControls() {
  const size = useViewportStore((s) => s.eraserSize);
  const setSize = useViewportStore((s) => s.setEraserSize);
  return (
    <div className="control-group">
      <NumberInput label="Eraser size" value={size} min={2} max={60} step={1} onChange={setSize} />
    </div>
  );
}

const TOOL_PANELS: Partial<Record<ToolId, ComponentType>> = {
  rectangle: ShapeControls,
  ellipse: ShapeControls,
  triangle: ShapeControls,
  polygon: PolygonControls,
  freepen: FreehandControls,
  eraser: EraserControls,
};

export function ToolPanel() {
  const activeTool = useEditorStore((s) => s.activeTool);
  const [collapsed, setCollapsed] = useState(false);

  const Body = TOOL_PANELS[activeTool];
  if (!Body) return null; // tools without options show no panel

  const label = getTool(activeTool).label;
  return (
    <div className="panel tool-panel" role="region" aria-label={`${label} options`}>
      <div className="panel-bar">
        <span className="panel-title">{label}</span>
        <CollapseButton
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          label={label}
        />
      </div>
      {collapsed ? null : (
        <div className="panel-content">
          <Body />
        </div>
      )}
    </div>
  );
}
