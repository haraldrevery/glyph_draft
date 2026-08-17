import { useEffect, useMemo, useRef } from "react";
import { useViewportStore } from "../../state/viewportStore";
import { useEditorStore } from "../../state/editorStore";
import { useActiveGlyph } from "../../state/documentStore";
import { usePanZoom } from "./hooks/usePanZoom";
import { useToolController } from "./hooks/useToolController";
import { worldMatrix } from "../../engine/viewport/transform";
import { DEFAULT_METRICS } from "../../constants/metrics";
import type { Viewport } from "../../types/viewport";
import { getTool } from "../tools";
import { Grid } from "./components/Grid";
import { EmSquare } from "./components/EmSquare";
import { MetricGuides } from "./components/MetricGuides";
import { MetricLabels } from "./components/MetricLabels";
import { SnapIndicator } from "./components/SnapIndicator";
import { CoordinateReadout } from "./components/CoordinateReadout";
import { GlyphView } from "./components/GlyphView";
import { OnionSkin } from "./components/OnionSkin";
import { PreviewLayer } from "./components/PreviewLayer";
import { EditOverlay } from "./components/EditOverlay";
import { LassoOverlay } from "./components/LassoOverlay";
import { MarqueeOverlay } from "./components/MarqueeOverlay";
import { TransformBox } from "./components/TransformBox";
import { EraserCursor } from "./components/EraserCursor";
import { UnitReference } from "./components/UnitReference";
import { AlignPanel } from "./components/AlignPanel";
import { Toolbar } from "./Toolbar";
import { LayersPanel } from "../layers/LayersPanel";
import { ToolPanel } from "./ToolPanel";
import { StrokePanel } from "./StrokePanel";
import { FillPanel } from "./FillPanel";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "../../components/menu";
import { commandMenuItems } from "../../commands";
import {
  canMovePaths,
  moveSelectedPathsToLayer,
  moveSelectedPathsToNewLayer,
  selectedContourRefs,
} from "./editActions";

/** Edit commands offered by the canvas right-click menu (each self-gates). */
const CANVAS_MENU = [
  "edit.cut",
  "edit.copy",
  "edit.paste",
  "edit.duplicate",
  "edit.transform",
  "edit.delete",
  "edit.smoothNode",
  "edit.cuspNode",
  "edit.cornerNode",
  "edit.flipH",
  "edit.flipV",
  "edit.reverse",
  "edit.mergeNodes",
  "edit.expandStroke",
  "edit.selectAll",
  "edit.undo",
  "edit.redo",
];

/**
 * The drawing surface. It owns the container element and keeps canvasSize in
 * sync (fitting the em square once, on first measurement), then layers in the
 * two input systems and the render tree:
 *
 *  - usePanZoom        -> navigation (wheel zoom, Space/middle-drag pan)
 *  - useToolController -> the active tool's pointer/keyboard gestures
 *
 * The SVG is split into a world group carrying the single Y-flip matrix (grid,
 * em square, metric guides, the glyph itself, and provisional previews are all
 * authored in plain font units) and an untransformed overlay group (labels, the
 * snap crosshair, and editing chrome compute their own screen positions so they
 * stay upright and a constant pixel size). The live cursor now lives in the
 * editor store, written by the tool controller, so the readout, snap marker,
 * and overlay all read one source of truth.
 */
export function CanvasViewport() {
  const containerRef = useRef<HTMLDivElement>(null);

  const zoom = useViewportStore((s) => s.zoom);
  const pan = useViewportStore((s) => s.pan);
  const canvasSize = useViewportStore((s) => s.canvasSize);
  const grid = useViewportStore((s) => s.grid);
  const snapToGeometry = useViewportStore((s) => s.snapToGeometry);
  const unitRef = useViewportStore((s) => s.unitRef);
  const viewMode = useViewportStore((s) => s.viewMode);
  const setCanvasSize = useViewportStore((s) => s.setCanvasSize);
  const resetView = useViewportStore((s) => s.resetView);

  const cursor = useEditorStore((s) => s.cursor);
  const activeTool = useEditorStore((s) => s.activeTool);
  const eraserSize = useViewportStore((s) => s.eraserSize);
  const glyph = useActiveGlyph();
  const advanceWidth = glyph?.advanceWidth;

  // Metric guides + em square track the ACTIVE glyph's advance width (editable in
  // the glyph sidebar); the rest of the metrics stay global defaults.
  const metrics = useMemo(
    () => ({ ...DEFAULT_METRICS, advanceWidth: advanceWidth ?? DEFAULT_METRICS.advanceWidth }),
    [advanceWidth],
  );

  const ctxMenu = useContextMenu();

  usePanZoom(containerRef);
  useToolController(containerRef);

  // Keep canvasSize current; fit-to-view exactly once, when the surface first
  // has real dimensions. Subsequent resizes preserve the user's pan/zoom.
  const didFit = useRef(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setCanvasSize({ width, height });
      if (!didFit.current && width > 0 && height > 0) {
        didFit.current = true;
        resetView();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [setCanvasSize, resetView]);

  const viewport: Viewport = { zoom, pan };
  const snapped = grid.snap || snapToGeometry ? cursor?.snapped ?? null : null;
  const final = viewMode === "final"; // hide editing chrome, dim the metric frame

  return (
    <div className="canvas-viewport">
      <div
        ref={containerRef}
        className="canvas-surface"
        role="application"
        aria-label="Glyph drawing canvas"
        tabIndex={0}
        style={{ cursor: getTool(activeTool).cursor }}
        onContextMenu={(e) => {
          e.preventDefault();
          const items: ContextMenuItem[] = commandMenuItems(CANVAS_MENU);
          // "Move to layer ▸" — appears when the node selection implies whole paths.
          if (glyph && canMovePaths()) {
            const refs = selectedContourRefs();
            const allOnLayer = (layerId: string) => refs.every((r) => r.layerId === layerId);
            const layerItems: ContextMenuItem[] = glyph.layers
              .slice()
              .reverse() // top-to-bottom, matching the Layers panel
              .map((l) => ({
                label: l.name,
                disabled: l.locked || allOnLayer(l.id),
                onSelect: () => moveSelectedPathsToLayer(l.id),
              }));
            layerItems.push({ label: "New layer", onSelect: () => moveSelectedPathsToNewLayer() });
            items.push({ label: "Move to layer", submenu: layerItems });
          }
          ctxMenu.open(e.clientX, e.clientY, items);
        }}
      >
        <svg
          className="canvas-svg"
          width={canvasSize.width}
          height={canvasSize.height}
          viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
          role="presentation"
        >
          {/* World space: font units, Y-up via the matrix from transform.ts. */}
          <g transform={worldMatrix(viewport)}>
            {grid.visible && !final && (
              <Grid viewport={viewport} size={canvasSize} gridSize={grid.size} />
            )}
            {/* Final preview keeps the metric frame as a DIMMED reference. */}
            <g className={final ? "metrics-faint" : undefined}>
              <EmSquare metrics={metrics} />
              <MetricGuides metrics={metrics} />
            </g>
            {!final && <OnionSkin />}
            <GlyphView />
            {!final && <PreviewLayer />}
          </g>

          {/* Screen space: upright, constant-size labels and editing chrome. */}
          <g className="overlay">
            <g className={final ? "metrics-faint" : undefined}>
              <MetricLabels viewport={viewport} />
            </g>
            {!final && (
              <>
                {snapped && (
                  <SnapIndicator point={snapped} viewport={viewport} />
                )}
                <EditOverlay viewport={viewport} />
                <LassoOverlay viewport={viewport} />
                <MarqueeOverlay viewport={viewport} />
                <TransformBox viewport={viewport} />
                {activeTool === "eraser" && cursor && (
                  <EraserCursor point={cursor.raw} size={eraserSize} viewport={viewport} />
                )}
                {unitRef && <UnitReference viewport={viewport} canvasSize={canvasSize} />}
              </>
            )}
          </g>
        </svg>

        <CoordinateReadout
          raw={cursor?.raw ?? null}
          snapped={snapped}
          snapOn={grid.snap}
        />
      </div>

      <Toolbar />
      <AlignPanel />
      <div className="hud-right">
        <ToolPanel />
        <FillPanel />
        <StrokePanel />
      </div>
      <LayersPanel />
      <ContextMenu menu={ctxMenu.menu} onClose={ctxMenu.close} />
    </div>
  );
}
