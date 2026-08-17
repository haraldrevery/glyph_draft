import { useEffect, useState } from "react";
import { NumberInput } from "../../components/controls/NumberInput";
import { Toggle } from "../../components/controls/Toggle";
import { useGlyphList, useActiveGlyph } from "../../state/documentStore";
import { useViewportStore } from "../../state/viewportStore";
import { exportFileName, glyphLabel } from "../../state/glyphHelpers";
import { DEFAULT_METRICS } from "../../constants/metrics";
import { glyphToSvg } from "./glyphToSvg";
import { createExportService } from "./ExportService";
import { type StyleTransform, REGULAR_STYLE } from "./styleTransform";

/** Synthetic-style presets; the sliders below stay editable for fine-tuning. */
const BOLD: StyleTransform = { stretchPct: 100, skewDeg: 0, extensionUnits: 30 };
const ITALIC: StyleTransform = { stretchPct: 100, skewDeg: 12, extensionUnits: 0 };

const eqStyle = (a: StyleTransform, b: StyleTransform) =>
  a.stretchPct === b.stretchPct && a.skewDeg === b.skewDeg && a.extensionUnits === b.extensionUnits;

/** A short tag for the output archive/folder name, so each style imports cleanly. */
function styleTag(s: StyleTransform): string {
  if (s.skewDeg !== 0) return "italic";
  if (s.extensionUnits > 0 || s.stretchPct > 100) return "bold";
  if (s.extensionUnits < 0) return "light";
  return "";
}

/**
 * The Phase 6 export modal: pick the universal scale %, then export EVERY glyph
 * as a `u_xxxx.svg` via the platform ExportService (zip download on web, folder
 * write on desktop). The SVG for each glyph is built by glyphToSvg, which reuses
 * buildFillGroups so exports match the canvas (Invariant 5).
 *
 * Controlled by its caller (open/onClose) so it can be triggered from the File
 * menu rather than owning its own trigger button.
 */

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

export function ExportModal({ open, onClose }: ExportModalProps) {
  const glyphs = useGlyphList();
  const activeGlyph = useActiveGlyph();
  const mergeHalftones = useViewportStore((s) => s.mergeHalftones);
  const [scalePct, setScalePct] = useState(100);
  const [scope, setScope] = useState<"all" | "active">("all");
  const [style, setStyle] = useState<StyleTransform>(REGULAR_STYLE);
  const [silhouette, setSilhouette] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const close = () => {
    setStatus({ kind: "idle" });
    onClose();
  };

  // Esc closes the modal (capture phase so it doesn't also reach the canvas behind it).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setStatus({ kind: "idle" });
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  const runExport = async () => {
    setStatus({ kind: "busy" });
    try {
      const service = await createExportService();
      let result;
      if (scope === "active") {
        if (!activeGlyph) {
          setStatus({ kind: "idle" });
          return;
        }
        result = await service.exportSingle({
          name: exportFileName(activeGlyph.codepoint),
          content: glyphToSvg(activeGlyph, DEFAULT_METRICS, scalePct, style, mergeHalftones, silhouette),
        });
      } else {
        const files = glyphs.map((g) => ({
          name: exportFileName(g.codepoint),
          content: glyphToSvg(g, DEFAULT_METRICS, scalePct, style, mergeHalftones, silhouette),
        }));
        const tag = [styleTag(style), silhouette ? "silhouette" : ""].filter(Boolean).join("-");
        result = await service.exportGlyphs(files, {
          archiveName: `glyphs${tag ? `-${tag}` : ""}.svg.zip`,
        });
      }
      if (result.cancelled) {
        setStatus({ kind: "idle" });
        return;
      }
      const where = result.destination ? ` → ${result.destination}` : "";
      setStatus({
        kind: "done",
        message: `Exported ${result.count} glyph${result.count === 1 ? "" : "s"}${where}`,
      });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Export failed",
      });
    }
  };

  if (!open) return null;

  return (
    <div className="export-overlay" role="presentation" onClick={close}>
      <div
        className="export-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Export glyphs"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="export-modal-title">Export glyphs</h2>

        <div className="export-scope" role="group" aria-label="Export scope">
          <button
            type="button"
            className={`btn export-scope-btn${scope === "all" ? " is-active" : ""}`}
            aria-pressed={scope === "all"}
            onClick={() => setScope("all")}
          >
            All glyphs
          </button>
          <button
            type="button"
            className={`btn export-scope-btn${scope === "active" ? " is-active" : ""}`}
            aria-pressed={scope === "active"}
            disabled={!activeGlyph}
            onClick={() => setScope("active")}
          >
            Active glyph
          </button>
        </div>

        <p className="export-modal-sub">
          {scope === "active"
            ? activeGlyph
              ? `“${glyphLabel(activeGlyph.codepoint)}” → one ${exportFileName(activeGlyph.codepoint)}.`
              : "No active glyph."
            : `${glyphs.length} glyph${glyphs.length === 1 ? "" : "s"} → individual u_xxxx.svg files.`}
        </p>

        <NumberInput
          label="Universal scale %"
          value={scalePct}
          min={1}
          max={1000}
          step={1}
          onChange={setScalePct}
        />

        <Toggle label="Silhouette — solid black" checked={silhouette} onChange={setSilhouette} />
        <p className="export-modal-sub">
          Flattens every glyph to solid black (counters/holes preserved) — ignores fill colours,
          gradients, and opacity. Ideal for FontForge import.
        </p>

        <div className="export-scope" role="group" aria-label="Synthetic style">
          {([["Regular", REGULAR_STYLE], ["Bold", BOLD], ["Italic", ITALIC]] as const).map(
            ([label, preset]) => (
              <button
                key={label}
                type="button"
                className={`btn export-scope-btn${eqStyle(style, preset) ? " is-active" : ""}`}
                aria-pressed={eqStyle(style, preset)}
                onClick={() => setStyle(preset)}
              >
                {label}
              </button>
            ),
          )}
        </div>
        <p className="export-modal-sub">
          Synthetic style (export-only — your source stays single-weight). Bold = horizontal
          weight; Italic = skew. Tune below.
        </p>
        <NumberInput
          label="Stretch %"
          value={style.stretchPct}
          min={50}
          max={200}
          step={1}
          onChange={(stretchPct) => setStyle((s) => ({ ...s, stretchPct }))}
        />
        <NumberInput
          label="Skew °"
          value={style.skewDeg}
          min={-30}
          max={30}
          step={1}
          onChange={(skewDeg) => setStyle((s) => ({ ...s, skewDeg }))}
        />
        <NumberInput
          label="Outline extension (units, − thins)"
          value={style.extensionUnits}
          min={-60}
          max={120}
          step={1}
          onChange={(extensionUnits) => setStyle((s) => ({ ...s, extensionUnits }))}
        />

        {status.kind === "done" && (
          <p className="export-status export-status-ok">{status.message}</p>
        )}
        {status.kind === "error" && (
          <p className="export-status export-status-err">{status.message}</p>
        )}

        <div className="export-actions">
          <button type="button" className="btn" onClick={close}>
            {status.kind === "done" ? "Close" : "Cancel"}
          </button>
          <button
            type="button"
            className="btn export-confirm"
            disabled={
              status.kind === "busy" ||
              (scope === "active" ? !activeGlyph : glyphs.length === 0)
            }
            onClick={() => void runExport()}
          >
            {status.kind === "busy" ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}
