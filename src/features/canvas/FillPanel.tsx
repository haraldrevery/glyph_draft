import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { coalesceNextEdit } from "../../state/history";
import { useDocumentStore } from "../../state/documentStore";
import { usePaletteStore } from "../../state/paletteStore";
import { useColorPaletteStore } from "../../state/colorPaletteStore";
import { Toggle } from "../../components/controls/Toggle";
import { Slider } from "../../components/controls/Slider";
import { Knob } from "../../components/controls/Knob";
import { CollapseButton } from "../../components/controls/CollapseButton";
import { usePanelDrag } from "./usePanelDrag";
import { useEditTargets } from "./useEditTargets";
import type { GradientFill } from "../../types/geometry";
import type { PaintPatch } from "../../engine/paint/paint";

/** Fixed Fill-palette inks (black/white + a small spectrum) shown above recent colours. */
const PRESET_INKS = ["#000000", "#ffffff", "#e53935", "#fb8c00", "#fdd835", "#43a047", "#1e88e5", "#8e24aa"];

/**
 * The per-path Fill (colour) editor (floating HUD), split out of the Stroke panel
 * so colour is its own movable panel and future colour features (gradients, swatch
 * libraries, multiple fills) grow here without touching the stroke editor.
 *
 * It edits the `paint` of the TARGET paths — the contours owning a selected anchor,
 * or (if nothing is selected) every contour in the active layer — through the
 * undoable, per-contour `patchContourPaint` action. Default = opaque black ink = no
 * `paint` stored, so colour stays purely opt-in (see Invariant 4).
 */
export function FillPanel() {
  const patchContourPaint = useDocumentStore((s) => s.patchContourPaint);
  const setContourFilled = useDocumentStore((s) => s.setContourFilled);
  const setStrokeColor = useDocumentStore((s) => s.setStrokeColor);
  const patchStrokeGradient = useDocumentStore((s) => s.patchStrokeGradient);
  const recentColors = usePaletteStore((s) => s.recentColors);
  const pushRecentColor = usePaletteStore((s) => s.pushRecentColor);
  const palettes = useColorPaletteStore((s) => s.palettes);
  const upsertPalette = useColorPaletteStore((s) => s.upsertPalette);
  const updatePalette = useColorPaletteStore((s) => s.updatePalette);
  const removePalette = useColorPaletteStore((s) => s.removePalette);
  const [collapsed, setCollapsed] = useState(false);
  const [activePaletteId, setActivePaletteId] = useState<string | null>(null);
  const [newPaletteName, setNewPaletteName] = useState<string | null>(null);
  // Two-click confirm for the destructive "Delete palette" (no modal): first click arms,
  // second deletes. Reset on palette switch so a stale armed state can't delete the wrong one.
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setConfirmDelete(false), [activePaletteId]);
  const { ref, style, dragProps, resizeProps } = usePanelDrag("fill");

  const { targets, targetIds } = useEditTargets();

  // Whether the interior is filled — INDEPENDENT of stroke now (a path can have both).
  // Mirrors renderContours' legacy default when `filled` isn't set explicitly.
  const isFilledNow = (c: (typeof targets)[number]) =>
    c.filled ?? (c.closed && !c.stroke && c.paint?.fill !== "none");
  const filledState = targets.length > 0 && targets.some(isFilledNow);
  const hasOpenTarget = targets.some((c) => !c.closed);
  const hasStrokedTarget = targets.some((c) => !!c.stroke);

  // Multi-selection "mixed" detection: a control is mixed when its targets disagree.
  // Edits still apply to ALL targets — this only fixes the misleading single-value display.
  const multi = targets.length > 1;
  const distinct = <T,>(xs: T[]) => new Set(xs).size > 1;
  const lc = (s?: string) => (s ?? "").toLowerCase();
  const strokeTargets = targets.filter((c) => c.stroke);
  const mixedFilled = distinct(targets.map(isFilledNow));
  const mixedFillColor = distinct(targets.filter(isFilledNow).map((c) => lc(c.paint?.fill ?? "#000000")));
  const mixedFillGradient = distinct(targets.map((c) => !!c.paint?.gradient));
  const mixedStrokeColor = distinct(strokeTargets.map((c) => lc(c.stroke?.color ?? c.paint?.fill ?? "#000000")));
  const mixedStrokeGradient = distinct(strokeTargets.map((c) => !!c.stroke?.gradient));
  // The outline colour shown in the Stroke section: the stroke's own `color`, else
  // (legacy) the contour's fill paint, else black — so an existing stroked path shows its
  // real colour. Applied only to stroked contours (setStrokeColor guards that).
  const strokeColor =
    targets.find((c) => c.stroke?.color)?.stroke?.color ??
    targets.find((c) => c.stroke && c.paint?.fill && c.paint.fill !== "none")?.paint?.fill ??
    "#000000";
  const strokeGradient = targets.find((c) => c.stroke?.gradient)?.stroke?.gradient;
  // Per contour: each path's own outline gradient gets just this field (see applyPaint).
  const setStrokeGrad = (patch: Partial<GradientFill> | null) => patchStrokeGradient(targetIds, patch);

  // Fill paint for the target paths (default = black ink = no paint stored).
  const currentPaint = targets.find((c) => c.paint)?.paint;
  const paintTransparent = currentPaint?.fill === "none";
  const lastFill = useRef("#000000");
  // The swatch shows the live colour, or — when transparent — the colour we'll restore.
  const paintColor =
    currentPaint?.fill && currentPaint.fill !== "none"
      ? currentPaint.fill
      : paintTransparent
        ? lastFill.current
        : "#000000";
  const paintOpacity = currentPaint?.opacity ?? 1;

  useEffect(() => {
    // Remember the last NON-transparent fill colour (default ink counts as black) so
    // toggling Transparent off restores it instead of resetting to black.
    if (!currentPaint) lastFill.current = "#000000";
    else if (currentPaint.fill && currentPaint.fill !== "none") lastFill.current = currentPaint.fill;
  });

  // Edits are PATCHES applied to each target path's own paint (store: patchContourPaint
  // → engine/paint `patchPaint`), never "the first path's paint written to all": dragging
  // Opacity over a red and a blue path keeps one red and one blue. Opaque black with no
  // gradient is the default ink and is stored as no paint at all.
  const applyPaint = (patch: PaintPatch) => patchContourPaint(targetIds, patch);

  // Fill on/off (independent of stroke). Off = no interior; on = paint the interior.
  // Turning on also clears any legacy Transparent (`fill:"none"`) so a colour shows.
  const setFillOn = (on: boolean) => {
    setContourFilled(targetIds, on);
    if (on && paintTransparent) applyPaint({ fill: lastFill.current });
  };

  // Gradient: edit `paint.gradient` fields; `null` removes it (delete, not undefined, so
  // exactOptionalPropertyTypes stays satisfied and the paint can collapse to default).
  const gradient = currentPaint?.gradient;
  const setGradient = (patch: Partial<GradientFill> | null) => patchContourPaint(targetIds, { gradient: patch });

  // Saved colour palettes (a consistent theme): pick one, apply its swatches, and
  // manage it inline (add a colour, rename, delete) — the StrokePanel preset pattern.
  // Persisted via the settings file (colorPaletteStore), not the document. The palette is
  // a colour SOURCE for both Fill and Stroke, so its picker sits above both sections (it
  // used to live inside Fill, hidden whenever a path had no interior — i.e. unreachable
  // for the default stroke-only workflow).
  const activePalette = palettes.find((p) => p.id === activePaletteId) ?? null;
  const addToPalette = (hex: string) => {
    if (!activePalette) return;
    const c = hex.toLowerCase();
    if (activePalette.colors.some((x) => x.toLowerCase() === c)) return; // dedupe
    updatePalette(activePalette.id, { colors: [...activePalette.colors, c] });
  };
  const removeFromPalette = (hex: string) => {
    if (!activePalette) return;
    updatePalette(activePalette.id, { colors: activePalette.colors.filter((x) => x !== hex) });
  };

  return (
    <div ref={ref} style={style} className="panel fill-panel" role="region" aria-label="Color">
      <div className="panel-resize" {...resizeProps} />
      <div className="panel-bar panel-drag" {...dragProps}>
        <span className="panel-title">Color</span>
        <CollapseButton
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          label="Color"
        />
      </div>

      {collapsed ? null : targets.length === 0 ? (
        <div className="panel-content">
          <p className="stroke-hint">Select a path to set its color.</p>
        </div>
      ) : (
        <div className="panel-content">
          {multi && (
            <p className="panel-multi-note">{targets.length} paths selected — edits apply to all.</p>
          )}
          <label className="stroke-select">
            <span className="stroke-select-label">Palette</span>
            <select
              className="stroke-select-field"
              value={activePaletteId ?? ""}
              onChange={(e) => setActivePaletteId(e.target.value || null)}
            >
              <option value="">— none —</option>
              {palettes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <div className="stroke-section">
            <span className="stroke-section-title">Fill</span>
            <Toggle
              label="Fill interior"
              checked={filledState}
              onChange={setFillOn}
              mixed={mixedFilled}
            />
            {hasOpenTarget && (
              <p className="stroke-hint">Open paths can’t be filled — close the path first.</p>
            )}
            {filledState && (
              <>
                <ColorPicker
                  ariaLabel="Fill color"
                  gesture="fill-color"
                  value={paintColor}
                  mixed={mixedFillColor}
                  showActive={!paintTransparent}
                  recent={recentColors}
                  palette={activePalette?.colors ?? null}
                  onPick={(fill) => applyPaint({ fill })}
                  onCommit={pushRecentColor}
                  onAddToPalette={paintTransparent ? null : () => addToPalette(paintColor)}
                  onRemoveFromPalette={removeFromPalette}
                />
                <Slider
                  label={`Opacity · ${Math.round(paintOpacity * 100)}%`}
                  value={Math.round(paintOpacity * 100)}
                  min={0}
                  max={100}
                  step={5}
                  onChange={(v) => applyPaint({ opacity: v / 100 })}
                />
              </>
            )}
          </div>

          {filledState && (
          <div className="stroke-section">
            <Toggle
              label="Gradient"
              checked={!!gradient}
              onChange={(on) => setGradient(on ? {} : null)}
              mixed={mixedFillGradient}
            />
            {gradient && (
              <>
                <Knob
                  label={`Angle · ${Math.round(gradient.angle)}°`}
                  value={gradient.angle}
                  onChange={(angle) => setGradient({ angle })}
                />
                <label className="stroke-fill-row">
                  <span>To</span>
                  <div className="fill-color-entry">
                    <input
                      type="color"
                      className="stroke-fill-swatch"
                      aria-label="Gradient end color"
                      value={gradient.to}
                      onChange={(e) => {
                        coalesceNextEdit("fill-gradient-to");
                        setGradient({ to: e.target.value });
                      }}
                    />
                  </div>
                </label>
                <Slider
                  label={`To opacity · ${Math.round((gradient.toOpacity ?? 1) * 100)}%`}
                  value={Math.round((gradient.toOpacity ?? 1) * 100)}
                  min={0}
                  max={100}
                  step={5}
                  onChange={(v) => setGradient({ toOpacity: v / 100 })}
                />
                <Slider
                  label={`Blend · ${Math.round(gradient.midpoint * 100)}%`}
                  value={Math.round(gradient.midpoint * 100)}
                  min={0}
                  max={100}
                  step={1}
                  onChange={(v) => setGradient({ midpoint: v / 100 })}
                />
                <Slider
                  label={`Fade · ${Math.round(gradient.fade * 100)}%`}
                  value={Math.round(gradient.fade * 100)}
                  min={0}
                  max={100}
                  step={1}
                  onChange={(v) => setGradient({ fade: v / 100 })}
                />
              </>
            )}
          </div>
          )}

          <div className="stroke-section">
            <span className="stroke-section-title">Stroke</span>
            {hasStrokedTarget ? (
              <>
                <ColorPicker
                  ariaLabel="Stroke color"
                  gesture="stroke-color"
                  value={strokeColor}
                  mixed={mixedStrokeColor}
                  showActive
                  recent={recentColors}
                  palette={activePalette?.colors ?? null}
                  onPick={(color) => setStrokeColor(targetIds, color)}
                  onCommit={pushRecentColor}
                  onAddToPalette={() => addToPalette(strokeColor)}
                  onRemoveFromPalette={removeFromPalette}
                />
                <Toggle
                  label="Gradient"
                  checked={!!strokeGradient}
                  onChange={(on) => setStrokeGrad(on ? {} : null)}
                  mixed={mixedStrokeGradient}
                />
                {strokeGradient && (
                  <>
                    <Toggle
                      label="Along path"
                      checked={!!strokeGradient.alongPath}
                      onChange={(on) => setStrokeGrad({ alongPath: on })}
                    />
                    {!strokeGradient.alongPath && (
                      <Knob
                        label={`Angle · ${Math.round(strokeGradient.angle)}°`}
                        value={strokeGradient.angle}
                        onChange={(angle) => setStrokeGrad({ angle })}
                      />
                    )}
                    <label className="stroke-fill-row">
                      <span>To</span>
                      <div className="fill-color-entry">
                        <input
                          type="color"
                          className="stroke-fill-swatch"
                          aria-label="Stroke gradient end color"
                          value={strokeGradient.to}
                          onChange={(e) => {
                            coalesceNextEdit("stroke-gradient-to");
                            setStrokeGrad({ to: e.target.value });
                          }}
                        />
                      </div>
                    </label>
                    <Slider
                      label={`To opacity · ${Math.round((strokeGradient.toOpacity ?? 1) * 100)}%`}
                      value={Math.round((strokeGradient.toOpacity ?? 1) * 100)}
                      min={0}
                      max={100}
                      step={5}
                      onChange={(v) => setStrokeGrad({ toOpacity: v / 100 })}
                    />
                    <Slider
                      label={`Blend · ${Math.round(strokeGradient.midpoint * 100)}%`}
                      value={Math.round(strokeGradient.midpoint * 100)}
                      min={0}
                      max={100}
                      step={1}
                      onChange={(v) => setStrokeGrad({ midpoint: v / 100 })}
                    />
                    <Slider
                      label={`Fade · ${Math.round(strokeGradient.fade * 100)}%`}
                      value={Math.round(strokeGradient.fade * 100)}
                      min={0}
                      max={100}
                      step={1}
                      onChange={(v) => setStrokeGrad({ fade: v / 100 })}
                    />
                  </>
                )}
              </>
            ) : (
              <p className="stroke-hint">Add a stroke in the Stroke panel to set its color.</p>
            )}
          </div>

          {/* Manage palettes — administrative, separated from the colour-picking above so
              "Delete palette" can never be read as deleting a colour (two-click confirm). */}
          <div className="fill-palette-manage">
            {activePalette && (
              <>
                <span className="stroke-select-label">Manage palette</span>
                <div className="stroke-preset-manage">
                  <input
                    className="stroke-preset-name"
                    type="text"
                    aria-label="Palette name"
                    value={activePalette.label}
                    onChange={(e) => updatePalette(activePalette.id, { label: e.target.value })}
                  />
                  <button
                    type="button"
                    className={`btn stroke-save-preset${confirmDelete ? " is-confirming" : ""}`}
                    title="Delete this entire palette"
                    onClick={() => {
                      if (confirmDelete) {
                        removePalette(activePalette.id);
                        setActivePaletteId(null);
                        setConfirmDelete(false);
                      } else {
                        setConfirmDelete(true);
                      }
                    }}
                    onBlur={() => setConfirmDelete(false)}
                  >
                    {confirmDelete ? "Delete palette?" : "Delete palette"}
                  </button>
                </div>
              </>
            )}
            {newPaletteName === null ? (
              <button
                type="button"
                className="btn stroke-save-preset"
                title="Create a new color palette"
                onClick={() => setNewPaletteName("My palette")}
              >
                New palette…
              </button>
            ) : (
              <form
                className="stroke-save-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const label = newPaletteName.trim();
                  if (label) {
                    // Seed with the colour in view: the fill's, else the stroke's.
                    const seedColor = filledState && !paintTransparent ? paintColor : hasStrokedTarget ? strokeColor : null;
                    const seed = seedColor ? [seedColor.toLowerCase()] : [];
                    setActivePaletteId(upsertPalette(label, seed));
                  }
                  setNewPaletteName(null);
                }}
              >
                <input
                  className="stroke-preset-name"
                  type="text"
                  autoFocus
                  aria-label="New palette name"
                  value={newPaletteName}
                  onChange={(e) => setNewPaletteName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setNewPaletteName(null);
                  }}
                />
                <button type="submit" className="btn stroke-save-preset" disabled={!newPaletteName.trim()}>
                  Create
                </button>
                <button type="button" className="btn stroke-save-preset" onClick={() => setNewPaletteName(null)}>
                  Cancel
                </button>
              </form>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

interface ColorPickerProps {
  ariaLabel: string;
  /** Undo-coalescing tag for the native picker's continuous input (one drag = one step). */
  gesture: string;
  value: string;
  mixed: boolean;
  /** Highlight the swatch matching `value` (off while the fill is the legacy "none"). */
  showActive: boolean;
  recent: string[];
  /** The active saved palette's colours, or null when no palette is selected. */
  palette: string[] | null;
  /** Apply a colour (live — called for every native-picker input event too). */
  onPick: (hex: string) => void;
  /** A colour was CHOSEN (swatch, hex entry, or the picker's final value) — for Recent. */
  onCommit: (hex: string) => void;
  /** Add the current colour to the palette; null hides the "+" tile. */
  onAddToPalette: (() => void) | null;
  onRemoveFromPalette: (hex: string) => void;
}

/**
 * One colour control — native swatch + hex entry + preset / recent / palette swatches —
 * shared by the Fill and Stroke sections so both offer the same tools (the stroke colour
 * used to get a bare swatch only). Recent colours record CHOSEN colours only: dragging
 * the native picker no longer floods the 8-slot Recent row with every intermediate shade.
 */
function ColorPicker({
  ariaLabel,
  gesture,
  value,
  mixed,
  showActive,
  recent,
  palette,
  onPick,
  onCommit,
  onAddToPalette,
  onRemoveFromPalette,
}: ColorPickerProps) {
  // Hex entry: a local draft so partial typing doesn't fight the live colour; commit a
  // valid #rrggbb on Enter/blur.
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const choose = (hex: string) => {
    onPick(hex);
    onCommit(hex);
  };
  const commitHex = (v: string) => {
    const c = (v.startsWith("#") ? v : `#${v}`).toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(c)) choose(c);
    setHexDraft(null);
  };
  const isActive = (hex: string) => showActive && hex.toLowerCase() === value.toLowerCase();
  const swatch = (hex: string, key: string, onClick: (e: ReactMouseEvent) => void, title = hex) => (
    <button
      key={key}
      type="button"
      className={`fill-swatch${isActive(hex) ? " is-active" : ""}`}
      style={{ background: hex }}
      title={title}
      aria-label={hex}
      onClick={onClick}
    />
  );

  return (
    <>
      <label className="stroke-fill-row">
        <span>Color</span>
        <div className="fill-color-entry">
          <input
            type="color"
            className={`stroke-fill-swatch${mixed ? " is-mixed" : ""}`}
            aria-label={ariaLabel}
            value={value}
            onChange={(e) => {
              coalesceNextEdit(gesture);
              onPick(e.target.value);
            }}
            onBlur={(e) => onCommit(e.target.value)}
          />
          {mixed && <span className="swatch-mixed">Mixed</span>}
          <input
            type="text"
            className="fill-hex-input"
            spellCheck={false}
            aria-label={`${ariaLabel} (hex)`}
            value={hexDraft ?? value}
            onChange={(e) => setHexDraft(e.target.value)}
            onBlur={(e) => commitHex(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitHex((e.target as HTMLInputElement).value);
            }}
          />
        </div>
      </label>
      <div className="fill-swatch-grid" role="group" aria-label="Preset colors">
        {PRESET_INKS.map((hex) => swatch(hex, hex, () => choose(hex)))}
      </div>
      {recent.length > 0 && (
        <div className="fill-swatch-grid fill-swatch-recent" role="group" aria-label="Recent colors">
          {recent.map((hex) => swatch(hex, hex, () => choose(hex)))}
        </div>
      )}
      {palette && (
        <div className="fill-swatch-grid" role="group" aria-label="Palette colors">
          {palette.map((hex, i) =>
            swatch(hex, `${hex}-${i}`, (e) => (e.altKey ? onRemoveFromPalette(hex) : choose(hex)), `${hex} — Alt-click to remove`),
          )}
          {onAddToPalette && (
            <button
              type="button"
              className="fill-swatch fill-swatch-add"
              title="Add the current color to this palette"
              aria-label="Add the current color to this palette"
              onClick={onAddToPalette}
            >
              +
            </button>
          )}
        </div>
      )}
    </>
  );
}
