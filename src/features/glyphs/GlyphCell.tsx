import type { MouseEvent } from "react";
import { formatCodepoint, glyphLabel } from "../../state/glyphHelpers";
import type { Glyph } from "../../types/document";
import { GlyphThumbnail } from "./GlyphThumbnail";

/**
 * One glyph in the sidebar grid. The whole cell activates the glyph; a ghost
 * toggle in the preview corner marks it as an onion-skin reference (hidden on
 * the active cell, which can't reference itself). Presentational — actions are
 * delegated to the sidebar.
 */

interface Props {
  glyph: Glyph;
  active: boolean;
  isReference: boolean;
  onActivate: () => void;
  onToggleReference: () => void;
  onContextMenu: (e: MouseEvent) => void;
}

function GhostIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M3.5 13.5V7a4.5 4.5 0 0 1 9 0v6.5l-1.5-1.1-1.5 1.1-1.5-1.1-1.5 1.1-1.5-1.1z" />
      <circle cx="6.4" cy="7" r="0.7" />
      <circle cx="9.6" cy="7" r="0.7" />
    </svg>
  );
}

export function GlyphCell({
  glyph,
  active,
  isReference,
  onActivate,
  onToggleReference,
  onContextMenu,
}: Props) {
  const label = glyphLabel(glyph.codepoint);
  const cp = formatCodepoint(glyph.codepoint);

  return (
    <div
      className={active ? "glyph-cell glyph-cell-active" : "glyph-cell"}
      role="listitem"
      title={`${label} · ${cp}`}
      onMouseDown={onActivate}
      onContextMenu={onContextMenu}
    >
      <div className="glyph-cell-preview">
        <GlyphThumbnail glyph={glyph} />
        {!active && (
          <button
            type="button"
            className={isReference ? "ghost-toggle ghost-toggle-on" : "ghost-toggle"}
            title={isReference ? "Remove from onion skin" : "Show as onion-skin reference"}
            aria-pressed={isReference}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onToggleReference}
          >
            <GhostIcon />
          </button>
        )}
      </div>
      <div className="glyph-cell-meta">
        <span className="glyph-cell-char">{label}</span>
        <span className="glyph-cell-cp">{cp}</span>
      </div>
    </div>
  );
}
