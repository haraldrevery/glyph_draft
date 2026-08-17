import { useEffect, useRef, useState } from "react";
import { useDocumentStore } from "../../state/documentStore";
import { Toggle } from "../../components/controls/Toggle";
import { Slider } from "../../components/controls/Slider";
import { NumberInput } from "../../components/controls/NumberInput";
import { CollapseButton } from "../../components/controls/CollapseButton";
import { usePanelDrag } from "./usePanelDrag";
import { useEditTargets } from "./useEditTargets";
import { BRUSH_PRESETS } from "./brushPresets";
import { GraphEditor } from "./GraphEditor";
import { useStrokePresetStore } from "../../state/strokePresetStore";
import { importSvg, normalizePattern } from "../import/svgImport";
import {
  DEFAULT_STROKE,
  DEFAULT_SERIF,
  DEFAULT_DROP,
  DEFAULT_RECT,
  DEFAULT_CONTRAST,
  DEFAULT_HALFTONE,
  DEFAULT_DASH,
  type CornerType,
  type DashStyle,
  type DropStyle,
  type HalftoneShape,
  type HalftoneStyle,
  type RectCapStyle,
  type SerifStyle,
  type StrokeCap,
  type StrokeJoin,
  type StrokeProfile,
  type StrokeStyle,
} from "../../types/geometry";

/** Flat default profiles seeded when a profile is first enabled. */
const FLAT_WIDTH: StrokeProfile = { points: [{ x: 0, y: 1 }, { x: 1, y: 1 }] };
const FLAT_ANGLE: StrokeProfile = { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] };

/**
 * The non-destructive stroke editor (floating HUD). It edits the `stroke` of the
 * TARGET paths — the contours owning a selected anchor, or (if nothing is
 * selected) every contour in the active layer — through the undoable
 * `setContourStroke` action. The centerline stays editable; the outline is
 * derived live by buildFillGroups, so changes show immediately.
 *
 * Beyond uniform width it offers a broad-nib (calligraphic) angle, per-end serif
 * feet, and a built-in brush preset picker. The two ends are independent, with a
 * Swap that exchanges both caps and serifs.
 */
const CAPS: StrokeCap[] = ["butt", "round", "rectangle", "serif", "drop"];
const JOINS: StrokeJoin[] = ["miter", "round", "bevel"];

export function StrokePanel() {
  const setContourStroke = useDocumentStore((s) => s.setContourStroke);
  const patchContourStroke = useDocumentStore((s) => s.patchContourStroke);
  const removeStrokeKeys = useDocumentStore((s) => s.removeStrokeKeys);
  const setContourCorner = useDocumentStore((s) => s.setContourCorner);
  const userPresets = useStrokePresetStore((s) => s.presets);
  const upsertPreset = useStrokePresetStore((s) => s.upsertPreset);
  const updatePreset = useStrokePresetStore((s) => s.updatePreset);
  const removePreset = useStrokePresetStore((s) => s.removePreset);
  const [collapsed, setCollapsed] = useState(false);
  const [savingName, setSavingName] = useState<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  // Two-click confirm for the destructive preset Delete (settings aren't undoable),
  // matching the FillPanel palette delete. Reset when the selected preset changes.
  const [confirmDeletePreset, setConfirmDeletePreset] = useState(false);
  useEffect(() => setConfirmDeletePreset(false), [selectedPresetId]);
  const { ref, style, dragProps, resizeProps } = usePanelDrag("stroke");

  const { targets, targetIds } = useEditTargets();
  const hasStroke = targets.some((c) => c.stroke);
  const current: StrokeStyle = targets.find((c) => c.stroke)?.stroke ?? DEFAULT_STROKE;
  // Multi-selection: edits apply to all targets; flag the "Stroke outline" toggle as mixed
  // when some targets are stroked and some aren't (shape fields show a representative value).
  const multi = targets.length > 1;
  const mixedHasStroke = new Set(targets.map((c) => !!c.stroke)).size > 1;

  // Remember the last applied stroke + profiles + nib + fill colour so toggling them off
  // then on RESTORES the previous settings instead of resetting (once removed, `current`
  // falls back to the default/flat, so the value can't be read back from the store).
  const lastStroke = useRef<StrokeStyle>(DEFAULT_STROKE);
  const lastWidthProfile = useRef<StrokeProfile | null>(null);
  const lastAngleProfile = useRef<StrokeProfile | null>(null);
  const lastNib = useRef<{ angle: number; contrast: number }>({ angle: 30, contrast: DEFAULT_CONTRAST });

  // Path-corner style for the target paths (none = sharp corners = no field stored).
  const currentCorner = targets.find((c) => c.corner)?.corner;
  const cornerType = currentCorner?.type ?? "none";
  const cornerRadius = currentCorner?.radius ?? 20;

  useEffect(() => {
    if (hasStroke) lastStroke.current = current;
    if (current.widthProfile) lastWidthProfile.current = current.widthProfile;
    if (current.angleProfile) lastAngleProfile.current = current.angleProfile;
    if (current.angle != null) lastNib.current = { angle: current.angle, contrast: current.contrast ?? DEFAULT_CONTRAST };
  });

  const setStroke = (next: StrokeStyle) => setContourStroke(targetIds, next);
  // Shape edits PATCH each target's own stroke (preserving its colour/gradient + other
  // differing fields) — the Stroke panel never rewrites colour. `setStroke` (whole replace)
  // is reserved for the enable toggle and preset apply.
  const apply = (patch: Partial<StrokeStyle>) => patchContourStroke(targetIds, patch);
  const remove = (...keys: (keyof StrokeStyle)[]) => removeStrokeKeys(targetIds, keys);
  // Halftone (experimental model) params — edit through the model + halftone fields.
  const ht: HalftoneStyle = current.halftone ?? DEFAULT_HALFTONE;
  const targetClosed = targets.some((c) => c.closed);
  const applyHalftone = (patch: Partial<HalftoneStyle>) =>
    apply({ model: "halftone", halftone: { ...ht, ...patch } });
  // Dash (experimental model) params — edit through the model + dash fields.
  const dsh: DashStyle = current.dash ?? DEFAULT_DASH;
  const applyDash = (patch: Partial<DashStyle>) =>
    apply({ model: "dash", dash: { ...dsh, ...patch } });
  // Import an SVG and use its outline as the halftone element (normalized to a unit box).
  const importHalftonePattern = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".svg,image/svg+xml";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      void file.text().then((text) => {
        const pattern = normalizePattern(importSvg(text));
        if (pattern.length === 0) return; // nothing importable
        applyHalftone({ shape: "svg", pattern });
      });
    });
    document.body.appendChild(input);
    input.click();
  };
  // Import an SVG and tile it along the line (normalized to a unit box, like the halftone one).
  const importDashPattern = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".svg,image/svg+xml";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      void file.text().then((text) => {
        const pattern = normalizePattern(importSvg(text));
        if (pattern.length === 0) return; // nothing importable
        applyDash({ shape: "svg", pattern });
      });
    });
    document.body.appendChild(input);
    input.click();
  };

  const isNib = current.angle != null;
  const selectedPreset = selectedPresetId
    ? userPresets.find((p) => p.id === selectedPresetId) ?? null
    : null;

  return (
    <div ref={ref} style={style} className="panel stroke-panel" role="region" aria-label="Stroke">
      <div className="panel-resize" {...resizeProps} />
      <div className="panel-bar panel-drag" {...dragProps}>
        <span className="panel-title">Stroke</span>
        <CollapseButton
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          label="Stroke"
        />
      </div>

      {collapsed ? null : targets.length === 0 ? (
        <div className="panel-content">
          <p className="stroke-hint">Draw or select a path to add a stroke.</p>
        </div>
      ) : (
        <div className="panel-content">
          {multi && (
            <p className="panel-multi-note">{targets.length} paths selected — edits apply to all.</p>
          )}
          <label className="stroke-select">
            <span className="stroke-select-label">Brush</span>
            <select
              className="stroke-select-field"
              value={selectedPreset ? selectedPreset.id : ""}
              onChange={(e) => {
                const id = e.target.value;
                const all = [...BRUSH_PRESETS, ...userPresets];
                const preset = all.find((b) => b.id === id);
                if (preset) setStroke({ ...preset.style });
                // Track only USER presets (for inline rename/update/delete).
                setSelectedPresetId(userPresets.some((p) => p.id === id) ? id : null);
              }}
            >
              <option value="">Apply preset…</option>
              <optgroup label="Built-in">
                {BRUSH_PRESETS.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </optgroup>
              {userPresets.length > 0 && (
                <optgroup label="My presets">
                  {userPresets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>

          {/* Manage the selected user preset inline: rename, overwrite style, delete. */}
          {selectedPreset && (
            <div className="stroke-preset-manage">
              <input
                className="stroke-preset-name"
                type="text"
                aria-label="Preset name"
                value={selectedPreset.label}
                onChange={(e) => updatePreset(selectedPreset.id, { label: e.target.value })}
              />
              <button
                type="button"
                className="btn stroke-save-preset"
                title="Overwrite this preset with the current stroke settings"
                onClick={() => updatePreset(selectedPreset.id, { style: { ...current } })}
              >
                Update
              </button>
              <button
                type="button"
                className={`btn stroke-save-preset${confirmDeletePreset ? " is-confirming" : ""}`}
                title="Delete this preset"
                onClick={() => {
                  if (confirmDeletePreset) {
                    removePreset(selectedPreset.id);
                    setSelectedPresetId(null);
                    setConfirmDeletePreset(false);
                  } else {
                    setConfirmDeletePreset(true);
                  }
                }}
                onBlur={() => setConfirmDeletePreset(false)}
              >
                {confirmDeletePreset ? "Delete?" : "Delete"}
              </button>
            </div>
          )}

          {savingName === null ? (
            <button
              type="button"
              className="btn stroke-save-preset"
              title="Save the current stroke as a reusable preset"
              onClick={() => setSavingName("My stroke")}
            >
              Save as preset…
            </button>
          ) : (
            <form
              className="stroke-save-form"
              onSubmit={(e) => {
                e.preventDefault();
                const label = savingName.trim();
                if (label) setSelectedPresetId(upsertPreset(label, current));
                setSavingName(null);
              }}
            >
              <input
                className="stroke-preset-name"
                type="text"
                autoFocus
                aria-label="Preset name"
                value={savingName}
                onChange={(e) => setSavingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSavingName(null);
                }}
              />
              <button type="submit" className="btn stroke-save-preset" disabled={!savingName.trim()}>
                Save
              </button>
              <button type="button" className="btn stroke-save-preset" onClick={() => setSavingName(null)}>
                Cancel
              </button>
            </form>
          )}

          <div className="stroke-section">
            <span className="stroke-section-title">Corners</span>
            <label className="stroke-select">
              <span className="stroke-select-label">Type</span>
              <select
                className="stroke-select-field"
                value={cornerType}
                onChange={(e) => {
                  const t = e.target.value as CornerType | "none";
                  setContourCorner(targetIds, t === "none" ? null : { type: t, radius: cornerRadius });
                }}
              >
                <option value="none">None (sharp)</option>
                <option value="round">Round</option>
                <option value="chamfer">Chamfer</option>
                <option value="invertedRound">Inverted round</option>
              </select>
            </label>
            {currentCorner && (
              <Slider
                label={`Radius · ${cornerRadius} u`}
                value={cornerRadius}
                min={1}
                max={300}
                step={1}
                onChange={(radius) => setContourCorner(targetIds, { type: currentCorner.type, radius })}
              />
            )}
          </div>

          <Toggle
            label="Stroke outline"
            checked={hasStroke}
            mixed={mixedHasStroke}
            onChange={(on) =>
              setContourStroke(targetIds, on ? (hasStroke ? current : lastStroke.current) : null)
            }
          />

          {hasStroke && (
            <>
              <div className="stroke-section">
                <span className="stroke-section-title">Outline</span>
              <Slider
                label={`Width · ${current.width} u`}
                value={current.width}
                min={1}
                max={300}
                step={1}
                onChange={(width) => apply({ width })}
              />
              <NumberInput
                label="Exact width"
                value={current.width}
                min={1}
                max={1000}
                step={1}
                onChange={(width) => apply({ width })}
              />

              <label className="stroke-select">
                <span className="stroke-select-label">Model</span>
                <select
                  className="stroke-select-field"
                  value={current.model ?? "offset"}
                  onChange={(e) => {
                    const m = e.target.value as "offset" | "brush" | "halftone" | "dash";
                    if (m === "offset") remove("model");
                    else apply({ model: m });
                  }}
                >
                  <option value="offset">Solid (offset)</option>
                  <option value="brush">Drawn (brush)</option>
                  <option value="halftone">Halftone (experimental)</option>
                  <option value="dash">Dash / dot (experimental)</option>
                </select>
              </label>

              {current.model === "halftone" && (
                <div className="stroke-section">
                  <span className="stroke-section-title">Halftone</span>
                  {targetClosed && (
                    <p className="stroke-hint">Closed path → fills the interior; Width = fade depth.</p>
                  )}
                  <label className="stroke-select">
                    <span className="stroke-select-label">Shape</span>
                    <select
                      className="stroke-select-field"
                      value={ht.shape}
                      onChange={(e) => applyHalftone({ shape: e.target.value as HalftoneShape })}
                    >
                      <option value="circle">Circle</option>
                      <option value="square">Square</option>
                      <option value="diamond">Diamond</option>
                      <option value="triangle">Triangle</option>
                      <option value="line">Line</option>
                      <option value="svg">Custom SVG…</option>
                    </select>
                  </label>
                  {ht.shape === "svg" && (
                    <button type="button" className="btn" onClick={importHalftonePattern}>
                      {ht.pattern && ht.pattern.length > 0 ? "Replace pattern SVG… ✓" : "Import pattern SVG…"}
                    </button>
                  )}
                  <Slider label={`Cell · ${ht.cell} u`} value={ht.cell} min={4} max={120} step={1} onChange={(cell) => applyHalftone({ cell })} />
                  <Slider label={`Dot size · ${ht.size} u`} value={ht.size} min={1} max={120} step={1} onChange={(size) => applyHalftone({ size })} />
                  <Slider
                    label={`Contrast · ${Math.round((ht.contrast ?? 0.5) * 100)}%`}
                    value={Math.round((ht.contrast ?? 0.5) * 100)}
                    min={0}
                    max={100}
                    step={5}
                    onChange={(v) => applyHalftone({ contrast: v / 100 })}
                  />
                  <Slider label={`Angle · ${ht.angle}°`} value={ht.angle} min={0} max={180} step={1} onChange={(angle) => applyHalftone({ angle })} />
                </div>
              )}

              {current.model === "dash" && (
                <div className="stroke-section">
                  <span className="stroke-section-title">Dash / dot</span>
                  <label className="stroke-select">
                    <span className="stroke-select-label">Shape</span>
                    <select
                      className="stroke-select-field"
                      value={dsh.shape}
                      onChange={(e) => applyDash({ shape: e.target.value as DashStyle["shape"] })}
                    >
                      <option value="dash">Dash (blocks)</option>
                      <option value="dot">Dot (circles)</option>
                      <option value="svg">Custom SVG…</option>
                    </select>
                  </label>
                  {dsh.shape === "svg" && (
                    <button type="button" className="btn" onClick={importDashPattern}>
                      {dsh.pattern && dsh.pattern.length > 0 ? "Replace SVG… ✓" : "Import SVG…"}
                    </button>
                  )}
                  {dsh.shape === "dash" ? (
                    <Slider label={`Dash · ${dsh.dash} u`} value={dsh.dash} min={1} max={200} step={1} onChange={(dash) => applyDash({ dash })} />
                  ) : (
                    <Slider
                      label={`${dsh.shape === "svg" ? "Size" : "Dot size"} · ${dsh.size ?? current.width} u`}
                      value={dsh.size ?? current.width}
                      min={1}
                      max={200}
                      step={1}
                      onChange={(size) => applyDash({ size })}
                    />
                  )}
                  <Slider label={`Gap · ${dsh.gap} u`} value={dsh.gap} min={0} max={200} step={1} onChange={(gap) => applyDash({ gap })} />
                  {dsh.shape !== "dot" && (
                    <>
                      <Toggle
                        label={dsh.shape === "dash" ? "Follow path (off = ⟂ ticks)" : "Follow path angle"}
                        checked={dsh.align !== false}
                        onChange={(on) => applyDash({ align: on })}
                      />
                      {dsh.align === false && (
                        <Slider label={`Angle · ${dsh.angle ?? 0}°`} value={dsh.angle ?? 0} min={0} max={360} step={1} onChange={(angle) => applyDash({ angle })} />
                      )}
                    </>
                  )}
                  <Toggle
                    label="Size profile"
                    checked={dsh.sizeProfile != null}
                    onChange={(on) => applyDash({ sizeProfile: on ? (dsh.sizeProfile ?? FLAT_WIDTH) : null })}
                  />
                  {dsh.sizeProfile && (
                    <GraphEditor
                      points={dsh.sizeProfile.points}
                      loop={dsh.sizeProfile.loop ?? false}
                      yMin={0}
                      yMax={2}
                      baseline={1}
                      unit="%"
                      displayScale={100}
                      onChange={(points) => applyDash({ sizeProfile: { ...dsh.sizeProfile, points } })}
                      onLoopChange={(loop) => applyDash({ sizeProfile: { ...dsh.sizeProfile!, loop } })}
                    />
                  )}
                </div>
              )}

              <Toggle
                label="Broad nib (angle)"
                checked={isNib}
                onChange={(on) =>
                  on
                    ? apply({ angle: lastNib.current.angle, contrast: lastNib.current.contrast })
                    : remove("angle", "contrast")
                }
              />
              {isNib && (
                <>
                  <Slider
                    label={`Nib angle · ${current.angle ?? 0}°`}
                    value={current.angle ?? 0}
                    min={0}
                    max={180}
                    step={1}
                    onChange={(angle) => apply({ angle })}
                  />
                  <Slider
                    label={`Contrast · ${Math.round((current.contrast ?? DEFAULT_CONTRAST) * 100)}%`}
                    value={Math.round((current.contrast ?? DEFAULT_CONTRAST) * 100)}
                    min={0}
                    max={100}
                    step={1}
                    onChange={(v) => apply({ contrast: v / 100 })}
                  />
                </>
              )}

              <Toggle
                label="Width profile"
                checked={current.widthProfile != null}
                onChange={(on) =>
                  on
                    ? apply({ widthProfile: lastWidthProfile.current ?? FLAT_WIDTH })
                    : remove("widthProfile")
                }
              />
              {current.widthProfile && (
                <GraphEditor
                  points={current.widthProfile.points}
                  loop={current.widthProfile.loop ?? false}
                  yMin={0}
                  yMax={2}
                  baseline={1}
                  unit="%"
                  displayScale={100}
                  onChange={(points) => apply({ widthProfile: { ...current.widthProfile, points } })}
                  onLoopChange={(loop) => apply({ widthProfile: { ...current.widthProfile!, loop } })}
                />
              )}

              <Toggle
                label="Nib angle profile"
                checked={current.angleProfile != null}
                onChange={(on) =>
                  on
                    ? apply({ angleProfile: lastAngleProfile.current ?? FLAT_ANGLE })
                    : remove("angleProfile")
                }
              />
              {current.angleProfile && (
                <GraphEditor
                  points={current.angleProfile.points}
                  loop={current.angleProfile.loop ?? false}
                  yMin={-180}
                  yMax={180}
                  baseline={0}
                  unit="°"
                  displayScale={1}
                  onChange={(points) => apply({ angleProfile: { ...current.angleProfile, points } })}
                  onLoopChange={(loop) => apply({ angleProfile: { ...current.angleProfile!, loop } })}
                />
              )}
              </div>

              <div className="stroke-section stroke-section-alt">
                <span className="stroke-section-title">Caps &amp; ends</span>
              <EndControls
                label="Start"
                cap={current.startCap}
                serif={current.startSerif ?? DEFAULT_SERIF}
                drop={current.startDrop ?? DEFAULT_DROP}
                rect={current.startRect ?? DEFAULT_RECT}
                onCap={(startCap) => apply({ startCap })}
                onSerif={(startSerif) => apply({ startSerif })}
                onDrop={(startDrop) => apply({ startDrop })}
                onRect={(startRect) => apply({ startRect })}
                roundAtNode={current.startRoundAtNode ?? false}
                onRoundAtNode={(startRoundAtNode) => apply({ startRoundAtNode })}
              />
              <EndControls
                label="End"
                cap={current.endCap}
                serif={current.endSerif ?? DEFAULT_SERIF}
                drop={current.endDrop ?? DEFAULT_DROP}
                rect={current.endRect ?? DEFAULT_RECT}
                onCap={(endCap) => apply({ endCap })}
                onSerif={(endSerif) => apply({ endSerif })}
                onDrop={(endDrop) => apply({ endDrop })}
                onRect={(endRect) => apply({ endRect })}
                roundAtNode={current.endRoundAtNode ?? false}
                onRoundAtNode={(endRoundAtNode) => apply({ endRoundAtNode })}
              />

              <button
                type="button"
                className="btn stroke-swap"
                title="Swap the start and end treatments"
                onClick={() =>
                  apply({
                    startCap: current.endCap,
                    endCap: current.startCap,
                    startSerif: current.endSerif ?? null,
                    endSerif: current.startSerif ?? null,
                    startDrop: current.endDrop ?? null,
                    endDrop: current.startDrop ?? null,
                    startRect: current.endRect ?? null,
                    endRect: current.startRect ?? null,
                    startRoundAtNode: current.endRoundAtNode ?? false,
                    endRoundAtNode: current.startRoundAtNode ?? false,
                  })
                }
              >
                Swap ends
              </button>

              <label className="stroke-select">
                <span className="stroke-select-label">Join</span>
                <select
                  className="stroke-select-field"
                  value={current.join}
                  onChange={(e) => apply({ join: e.target.value as StrokeJoin })}
                >
                  {JOINS.map((j) => (
                    <option key={j} value={j}>
                      {j}
                    </option>
                  ))}
                </select>
              </label>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One terminal's controls: a cap dropdown and, for the shaped caps, inline
 * sliders — serif shows foot/reach/extend; drop shows the bulb size and oval ratio.
 */
function EndControls({
  label,
  cap,
  serif,
  drop,
  rect,
  roundAtNode,
  onCap,
  onSerif,
  onDrop,
  onRect,
  onRoundAtNode,
}: {
  label: string;
  cap: StrokeCap;
  serif: SerifStyle;
  drop: DropStyle;
  rect: RectCapStyle;
  roundAtNode: boolean;
  onCap: (cap: StrokeCap) => void;
  onSerif: (serif: SerifStyle) => void;
  onDrop: (drop: DropStyle) => void;
  onRect: (rect: RectCapStyle) => void;
  onRoundAtNode: (v: boolean) => void;
}) {
  // Remember the last serif/rect foot angle so toggling "Angle to X axis" off then on
  // restores it instead of resetting to 0. Per-end (this component renders per end).
  const lastSerifAngle = useRef(0);
  const lastRectAngle = useRef(0);
  useEffect(() => {
    if (serif.angle != null) lastSerifAngle.current = serif.angle;
    if (rect.angle != null) lastRectAngle.current = rect.angle;
  });

  return (
    <div className="stroke-serif">
      <label className="stroke-select">
        <span className="stroke-select-label">{label} cap</span>
        <select
          className="stroke-select-field"
          value={cap}
          onChange={(e) => onCap(e.target.value as StrokeCap)}
        >
          {CAPS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      {cap === "round" && (
        <Toggle label="Far edge at node" checked={roundAtNode} onChange={onRoundAtNode} />
      )}
      {cap === "serif" && (
        <>
          <label className="stroke-select">
            <span className="stroke-select-label">Algorithm</span>
            <select
              className="stroke-select-field"
              value={serif.variant ?? "a"}
              onChange={(e) => onSerif({ ...serif, variant: e.target.value as "a" | "b" })}
            >
              <option value="a">A · Bracket</option>
              <option value="b">B · Wedge</option>
            </select>
          </label>
          <Slider
            label={`Foot · ${serif.length} u`}
            value={serif.length}
            min={1}
            max={300}
            step={1}
            onChange={(length) => onSerif({ ...serif, length })}
          />
          <Slider
            label={`Reach · ${serif.depth} u`}
            value={serif.depth}
            min={0.1}
            max={300}
            step={0.1}
            onChange={(depth) => onSerif({ ...serif, depth })}
          />
          <Slider
            label={`Box · ${serif.project ?? 0} u`}
            value={serif.project ?? 0}
            min={0}
            max={300}
            step={1}
            onChange={(project) => onSerif({ ...serif, project })}
          />
          <Toggle
            label="Far edge at node"
            checked={(serif.anchor ?? "outward") === "node"}
            onChange={(on) => onSerif({ ...serif, anchor: on ? "node" : "outward" })}
          />
          {/* The world/handle angle only applies to serif A; B is tangent-only. */}
          {serif.variant !== "b" && (
            <>
              <Toggle
                label="Angle to X axis"
                checked={serif.angle != null}
                onChange={(on) => {
                  if (on) onSerif({ ...serif, angle: lastSerifAngle.current });
                  else {
                    const { angle: _drop, ...rest } = serif;
                    onSerif(rest);
                  }
                }}
              />
              {serif.angle != null && (
                <Slider
                  label={`Angle · ${serif.angle}°`}
                  value={serif.angle}
                  min={0}
                  max={180}
                  step={1}
                  onChange={(angle) => onSerif({ ...serif, angle })}
                />
              )}
            </>
          )}
          <Slider
            label={`Shift · ${Math.round((serif.bias ?? 0) * 100)}%`}
            value={Math.round((serif.bias ?? 0) * 100)}
            min={-100}
            max={100}
            step={5}
            onChange={(v) => onSerif({ ...serif, bias: v / 100 })}
          />
          <Slider
            label={`${serif.variant === "b" ? "Flare" : "Bracket"} · ${Math.round((serif.bracket ?? 0) * 100)}%`}
            value={Math.round((serif.bracket ?? 0) * 100)}
            min={0}
            max={100}
            step={5}
            onChange={(v) => onSerif({ ...serif, bracket: v / 100 })}
          />
        </>
      )}
      {cap === "drop" && (
        <>
          <label className="stroke-select">
            <span className="stroke-select-label">Algorithm</span>
            <select
              className="stroke-select-field"
              value={drop.variant ?? "a"}
              onChange={(e) => onDrop({ ...drop, variant: e.target.value as "a" | "b" })}
            >
              <option value="a">A · Round</option>
              <option value="b">B · Teardrop</option>
            </select>
          </label>
          <Slider
            label={`Ink size · ${drop.size} u`}
            value={drop.size}
            min={1}
            max={300}
            step={1}
            onChange={(size) => onDrop({ ...drop, size })}
          />
          <Slider
            label={`Reach · ${Math.round(drop.ratio * 100)}%`}
            value={Math.round(drop.ratio * 100)}
            min={20}
            max={400}
            step={5}
            onChange={(v) => onDrop({ ...drop, ratio: v / 100 })}
          />
          <Slider
            label={`Lean · ${Math.round((drop.smear ?? 0) * 100)}%`}
            value={Math.round((drop.smear ?? 0) * 100)}
            min={-100}
            max={100}
            step={5}
            onChange={(v) => onDrop({ ...drop, smear: v / 100 })}
          />
          {drop.variant === "b" && (
            <Slider
              label={`Neck · ${Math.round((drop.neck ?? 0.55) * 100)}%`}
              value={Math.round((drop.neck ?? 0.55) * 100)}
              min={10}
              max={100}
              step={5}
              onChange={(v) => onDrop({ ...drop, neck: v / 100 })}
            />
          )}
        </>
      )}
      {cap === "rectangle" && (
        <>
          <label className="stroke-select">
            <span className="stroke-select-label">Algorithm</span>
            <select
              className="stroke-select-field"
              value={rect.variant ?? "a"}
              onChange={(e) => onRect({ ...rect, variant: e.target.value as "a" | "b" })}
            >
              <option value="a">A · Slab</option>
              <option value="b">B · Flare</option>
            </select>
          </label>
          <Slider
            label={`Depth · ${rect.size} u`}
            value={rect.size}
            min={0}
            max={300}
            step={1}
            onChange={(size) => onRect({ ...rect, size })}
          />
          <Slider
            label={`Width · ${Math.round(rect.ratio * 100)}%`}
            value={Math.round(rect.ratio * 100)}
            min={20}
            max={400}
            step={5}
            onChange={(v) => onRect({ ...rect, ratio: v / 100 })}
          />
          {rect.variant === "b" && (
            <Slider
              label={`Reach · ${rect.reach ?? Math.round(rect.size * 0.6)} u`}
              value={rect.reach ?? Math.round(rect.size * 0.6)}
              min={1}
              max={300}
              step={1}
              onChange={(reach) => onRect({ ...rect, reach })}
            />
          )}
          <Toggle
            label="Angle to X axis"
            checked={rect.angle != null}
            onChange={(on) => {
              if (on) onRect({ ...rect, angle: lastRectAngle.current });
              else {
                const { angle: _drop, ...rest } = rect;
                onRect(rest);
              }
            }}
          />
          {rect.angle != null && (
            <Slider
              label={`Angle · ${rect.angle}°`}
              value={rect.angle}
              min={0}
              max={180}
              step={1}
              onChange={(angle) => onRect({ ...rect, angle })}
            />
          )}
          <Slider
            label={`Corner · ${Math.round((rect.radius ?? 0) * 100)}%`}
            value={Math.round((rect.radius ?? 0) * 100)}
            min={0}
            max={100}
            step={5}
            onChange={(v) => onRect({ ...rect, radius: v / 100 })}
          />
          <Toggle
            label="Project past node"
            checked={(rect.anchor ?? "node") === "outward"}
            onChange={(on) => onRect({ ...rect, anchor: on ? "outward" : "node" })}
          />
        </>
      )}
    </div>
  );
}
