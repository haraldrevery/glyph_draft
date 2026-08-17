import { useViewportStore, type GuideMetrics } from "../../state/viewportStore";
import { useOnionStore } from "../../state/onionStore";
import { Toggle } from "../../components/controls/Toggle";
import { Slider } from "../../components/controls/Slider";
import { NumberInput } from "../../components/controls/NumberInput";

/**
 * The View menu body — the former floating ControlPanel, relocated into the
 * top-bar "View" dropdown (the panel was removed). Holds view/grid/onion controls
 * plus the (visual-only) typography guide positions. The menubar keeps the dropdown
 * open while you interact with these controls (clicks inside the bar don't close it).
 */

const GRID_SLIDER_MIN = 5;
const GRID_SLIDER_MAX = 200;

const GUIDE_FIELDS: { key: keyof GuideMetrics; label: string }[] = [
  { key: "ascender", label: "Ascender" },
  { key: "capHeight", label: "Cap height" },
  { key: "xHeight", label: "x-height" },
  { key: "descender", label: "Descender" },
];

export function ViewMenu() {
  const grid = useViewportStore((s) => s.grid);
  const setGridSize = useViewportStore((s) => s.setGridSize);
  const toggleGrid = useViewportStore((s) => s.toggleGrid);
  const toggleSnap = useViewportStore((s) => s.toggleSnap);
  const snapToGeometry = useViewportStore((s) => s.snapToGeometry);
  const toggleSnapToGeometry = useViewportStore((s) => s.toggleSnapToGeometry);
  const resetView = useViewportStore((s) => s.resetView);
  const unitRef = useViewportStore((s) => s.unitRef);
  const toggleUnitRef = useViewportStore((s) => s.toggleUnitRef);
  const viewMode = useViewportStore((s) => s.viewMode);
  const toggleOutlineMode = useViewportStore((s) => s.toggleOutlineMode);
  const toggleFinalPreview = useViewportStore((s) => s.toggleFinalPreview);
  const previewPaths = useViewportStore((s) => s.previewPaths);
  const togglePreviewPaths = useViewportStore((s) => s.togglePreviewPaths);
  const guides = useViewportStore((s) => s.guides);
  const setGuide = useViewportStore((s) => s.setGuide);
  const resetGuides = useViewportStore((s) => s.resetGuides);

  const onionEnabled = useOnionStore((s) => s.enabled);
  const onionOpacity = useOnionStore((s) => s.opacity);
  const toggleOnion = useOnionStore((s) => s.toggle);
  const setOnionOpacity = useOnionStore((s) => s.setOpacity);
  const onionRenderSvg = useOnionStore((s) => s.renderSvg);
  const toggleOnionRenderSvg = useOnionStore((s) => s.toggleRenderSvg);

  return (
    <div className="view-menu">
      <div className="control-group">
        <span className="control-group-title">View</span>
        <button type="button" className="btn" onClick={resetView}>
          Reset view
        </button>
        <Toggle
          label="Outline mode"
          checked={viewMode === "outline"}
          onChange={toggleOutlineMode}
        />
        <Toggle
          label="Final preview"
          checked={viewMode === "final"}
          onChange={toggleFinalPreview}
        />
        {viewMode === "final" && (
          <Toggle label="Show path lines" checked={previewPaths} onChange={togglePreviewPaths} />
        )}
        <Toggle
          label="Coordinate reference (1 u)"
          checked={unitRef}
          onChange={toggleUnitRef}
        />
      </div>

      <div className="control-divider" aria-hidden="true" />

      <div className="control-group">
        <span className="control-group-title">Grid</span>
        <Toggle label="Show grid" checked={grid.visible} onChange={toggleGrid} />
        <Toggle label="Snap to grid" checked={grid.snap} onChange={toggleSnap} />
        <Toggle label="Snap to point" checked={snapToGeometry} onChange={toggleSnapToGeometry} />
        <Slider
          label={`Density · ${grid.size} u`}
          value={grid.size}
          min={GRID_SLIDER_MIN}
          max={GRID_SLIDER_MAX}
          step={5}
          onChange={setGridSize}
        />
        <NumberInput label="Exact size" value={grid.size} min={1} max={1000} step={1} onChange={setGridSize} />
      </div>

      <div className="control-divider" aria-hidden="true" />

      <div className="control-group">
        <span className="control-group-title">Reference</span>
        <Toggle label="Onion skin" checked={onionEnabled} onChange={toggleOnion} />
        <Toggle
          label="Ghost: rendered output"
          checked={onionRenderSvg}
          onChange={toggleOnionRenderSvg}
        />
        <Slider
          label={`Ghost opacity · ${Math.round(onionOpacity * 100)}%`}
          value={Math.round(onionOpacity * 100)}
          min={5}
          max={80}
          step={5}
          onChange={(v) => setOnionOpacity(v / 100)}
        />
      </div>

      <div className="control-divider" aria-hidden="true" />

      <div className="control-group">
        <span className="control-group-title">Typography guides</span>
        {GUIDE_FIELDS.map((f) => (
          <NumberInput
            key={f.key}
            label={f.label}
            value={guides[f.key]}
            min={0}
            max={2000}
            step={1}
            onChange={(v) => setGuide(f.key, v)}
          />
        ))}
        <button type="button" className="btn" onClick={resetGuides}>
          Reset guides
        </button>
      </div>
    </div>
  );
}
