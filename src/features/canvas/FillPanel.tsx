import { useEffect, useRef, useState } from "react";
import { useDocumentStore } from "../../state/documentStore";
import { usePaletteStore } from "../../state/paletteStore";
import { useColorPaletteStore } from "../../state/colorPaletteStore";
import { Toggle } from "../../components/controls/Toggle";
import { Slider } from "../../components/controls/Slider";
import { Knob } from "../../components/controls/Knob";
import { CollapseButton } from "../../components/controls/CollapseButton";
import { usePanelDrag } from "./usePanelDrag";
import { useEditTargets } from "./useEditTargets";
import { DEFAULT_GRADIENT, type GradientFill, type Paint } from "../../types/geometry";

/** Fixed Fill-palette inks (black/white + a small spectrum) shown above recent colours. */
const PRESET_INKS = ["#000000", "#ffffff", "#e53935", "#fb8c00", "#fdd835", "#43a047", "#1e88e5", "#8e24aa"];

/**
 * The per-path Fill (colour) editor (floating HUD), split out of the Stroke panel
 * so colour is its own movable panel and future colour features (gradients, swatch
 * libraries, multiple fills) grow here without touching the stroke editor.
 *
 * It edits the `paint` of the TARGET paths — the contours owning a selected anchor,
 * or (if nothing is selected) every contour in the active layer — through the
 * undoable `setContourPaint` action. Default = opaque black ink = no `paint` stored,
 * so colour stays purely opt-in (see Invariant 4).
 */
export function FillPanel() {
  const setContourPaint = useDocumentStore((s) => s.setContourPaint);
  const setContourFilled = useDocumentStore((s) => s.setContourFilled);
  const setStrokeColor = useDocumentStore((s) => s.setStrokeColor);
  const setStrokeGradient = useDocumentStore((s) => s.setStrokeGradient);
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
  const setStrokeGrad = (patch: Partial<GradientFill> | null) => {
    if (patch === null) {
      setStrokeGradient(targetIds, null);
      return;
    }
    setStrokeGradient(targetIds, { ...(strokeGradient ?? DEFAULT_GRADIENT), ...patch });
  };

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

  // Commit a fully-formed paint: a plain opaque-black paint (and no gradient) IS the
  // default ink, so we store NOTHING — the no-paint (unchanged) render/export path
  // stays in effect. A gradient is never "default", so it's always preserved.
  const commitPaint = (next: Paint) => {
    const isDefault =
      (next.fill === undefined || next.fill === "#000000") &&
      (next.opacity === undefined || next.opacity === 1) &&
      next.gradient === undefined;
    setContourPaint(targetIds, isDefault ? null : next);
  };
  const applyPaint = (patch: Partial<Paint>) => {
    commitPaint({ ...(currentPaint ?? {}), ...patch });
    // Remember any concrete colour the user applies (ignores "none"/opacity-only edits).
    if (patch.fill && patch.fill !== "none") pushRecentColor(patch.fill);
  };

  // Fill on/off (independent of stroke). Off = no interior; on = paint the interior.
  // Turning on also clears any legacy Transparent (`fill:"none"`) so a colour shows.
  const setFillOn = (on: boolean) => {
    setContourFilled(targetIds, on);
    if (on && paintTransparent) applyPaint({ fill: lastFill.current });
  };

  // Gradient: edit `paint.gradient` fields; `null` removes it (delete, not undefined, so
  // exactOptionalPropertyTypes stays satisfied and the paint can collapse to default).
  const gradient = currentPaint?.gradient;
  const setGradient = (patch: Partial<GradientFill> | null) => {
    const base = currentPaint ?? {};
    if (patch === null) {
      const next: Paint = { ...base };
      delete next.gradient;
      commitPaint(next);
    } else {
      commitPaint({ ...base, gradient: { ...(gradient ?? DEFAULT_GRADIENT), ...patch } });
    }
  };

  // Hex entry: a local draft so partial typing doesn't fight the live colour; commit a
  // valid #rrggbb on Enter/blur.
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const commitHex = (v: string) => {
    const c = (v.startsWith("#") ? v : `#${v}`).toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(c)) applyPaint({ fill: c });
    setHexDraft(null);
  };

  // Saved colour palettes (a consistent theme): pick one, apply its swatches, and
  // manage it inline (add the current colour, rename, delete) — the StrokePanel preset
  // pattern. Persisted via the settings file (colorPaletteStore), not the document.
  const activePalette = palettes.find((p) => p.id === activePaletteId) ?? null;
  const addToPalette = () => {
    if (!activePalette || paintTransparent) return;
    const c = paintColor.toLowerCase();
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
          <p className="stroke-hint">Select a path to set its colour.</p>
        </div>
      ) : (
        <div className="panel-content">
          {multi && (
            <p className="panel-multi-note">{targets.length} paths selected — edits apply to all.</p>
          )}
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
            {!filledState ? null : (
              <>
            <label className="stroke-fill-row">
              <span>Color</span>
              <div className="fill-color-entry">
                <input
                  type="color"
                  className={`stroke-fill-swatch${mixedFillColor ? " is-mixed" : ""}`}
                  value={paintColor}
                  onChange={(e) => applyPaint({ fill: e.target.value })}
                />
                {mixedFillColor && <span className="swatch-mixed">Mixed</span>}
                <input
                  type="text"
                  className="fill-hex-input"
                  spellCheck={false}
                  aria-label="Hex color"
                  value={hexDraft ?? paintColor}
                  onChange={(e) => setHexDraft(e.target.value)}
                  onBlur={(e) => commitHex(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitHex((e.target as HTMLInputElement).value);
                  }}
                />
              </div>
            </label>

            <div className="fill-swatch-grid" role="group" aria-label="Preset colors">
              {PRESET_INKS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  className={`fill-swatch${!paintTransparent && hex === paintColor.toLowerCase() ? " is-active" : ""}`}
                  style={{ background: hex }}
                  title={hex}
                  aria-label={hex}
                  onClick={() => applyPaint({ fill: hex })}
                />
              ))}
            </div>
            {recentColors.length > 0 && (
              <div className="fill-swatch-grid fill-swatch-recent" role="group" aria-label="Recent colors">
                {recentColors.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    className={`fill-swatch${!paintTransparent && hex === paintColor.toLowerCase() ? " is-active" : ""}`}
                    style={{ background: hex }}
                    title={hex}
                    aria-label={hex}
                    onClick={() => applyPaint({ fill: hex })}
                  />
                ))}
              </div>
            )}

            {/* Saved palettes are just another colour source: pick a set, then click its
                swatches like Presets/Recent. Managing the set lives in the separate row
                at the bottom of this section so it can't be mistaken for a colour action. */}
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
            {activePalette && (
              <>
                {activePalette.colors.length > 0 && (
                  <div className="fill-swatch-grid" role="group" aria-label="Palette colors">
                    {activePalette.colors.map((hex, i) => (
                      <button
                        key={`${hex}-${i}`}
                        type="button"
                        className={`fill-swatch${!paintTransparent && hex.toLowerCase() === paintColor.toLowerCase() ? " is-active" : ""}`}
                        style={{ background: hex }}
                        title={`${hex} — Alt-click to remove`}
                        aria-label={hex}
                        onClick={(e) => (e.altKey ? removeFromPalette(hex) : applyPaint({ fill: hex }))}
                      />
                    ))}
                  </div>
                )}
                <div className="fill-palette-add">
                  <button
                    type="button"
                    className="btn stroke-save-preset"
                    title="Add the current fill colour to this palette"
                    disabled={paintTransparent}
                    onClick={addToPalette}
                  >
                    + Add colour
                  </button>
                  {activePalette.colors.length > 0 && (
                    <span className="fill-palette-hint">Alt-click a swatch to remove it</span>
                  )}
                </div>
              </>
            )}

            <Slider
              label={`Opacity · ${Math.round(paintOpacity * 100)}%`}
              value={Math.round(paintOpacity * 100)}
              min={0}
              max={100}
              step={5}
              onChange={(v) => applyPaint({ opacity: v / 100 })}
            />

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
                  title="Create a new colour palette"
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
                      const seed = !paintTransparent ? [paintColor.toLowerCase()] : [];
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
                      onChange={(e) => setGradient({ to: e.target.value })}
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
                <label className="stroke-fill-row">
                  <span>Colour</span>
                  <input
                    type="color"
                    className={`stroke-fill-swatch${mixedStrokeColor ? " is-mixed" : ""}`}
                    aria-label="Stroke colour"
                    value={strokeColor}
                    onChange={(e) => setStrokeColor(targetIds, e.target.value)}
                  />
                  {mixedStrokeColor && <span className="swatch-mixed">Mixed</span>}
                </label>
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
                          onChange={(e) => setStrokeGrad({ to: e.target.value })}
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
              <p className="stroke-hint">Add a stroke in the Stroke panel to set its colour.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
