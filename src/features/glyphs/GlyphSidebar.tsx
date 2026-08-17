import { useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  useActiveGlyph,
  useActiveGlyphId,
  useDocumentStore,
  useGlyphList,
} from "../../state/documentStore";
import { useEditorStore } from "../../state/editorStore";
import { useViewportStore } from "../../state/viewportStore";
import { useOnionStore } from "../../state/onionStore";
import { glyphLabel, parseGlyphInput } from "../../state/glyphHelpers";
import { NumberInput } from "../../components/controls/NumberInput";
import { ContextMenu, useContextMenu } from "../../components/menu";
import type { Glyph } from "../../types/document";
import { GlyphCell } from "./GlyphCell";

/** Dragging the resize handle left of this width (px) collapses the sidebar. */
const COLLAPSE_AT = 110;

/**
 * The glyph navigator: one cell per glyph (the document is one-glyph-per-file,
 * so this is the document switcher), sorted by code point. New glyphs are added
 * by typing a character or a "U+XXXX" tag; adding a code point that already
 * exists just selects it (a font has one glyph per code point). Delete removes
 * the active glyph, keeping at least one. The ghost toggle on each cell feeds
 * onion-skinning. Reads reactive state via hooks; fires actions via getState().
 */
export function GlyphSidebar() {
  const glyphs = useGlyphList();
  const activeGlyphId = useActiveGlyphId();
  const activeGlyph = useActiveGlyph();
  const referenceIds = useOnionStore((s) => s.referenceIds);
  const [text, setText] = useState("");
  const ctxMenu = useContextMenu();
  const [confirmDelete, setConfirmDelete] = useState<Glyph | null>(null);
  const sidebarWidth = useViewportStore((s) => s.sidebarWidth);
  const collapsed = useViewportStore((s) => s.sidebarCollapsed);
  const asideRef = useRef<HTMLElement>(null);
  const dragging = useRef(false);

  // Drag the right-edge handle to resize; drag the cursor left of COLLAPSE_AT to
  // collapse (the re-open grip reuses the same drag, so it can be dragged back out).
  const onHandleDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
  };
  const onHandleMove = (e: ReactPointerEvent) => {
    if (!dragging.current) return;
    const left = asideRef.current?.getBoundingClientRect().left ?? 0;
    const w = e.clientX - left;
    const vp = useViewportStore.getState();
    if (w < COLLAPSE_AT) vp.setSidebarCollapsed(true);
    else vp.setSidebarWidth(w); // setSidebarWidth also un-collapses
  };
  const onHandleUp = (e: ReactPointerEvent) => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const references = new Set(referenceIds);
  const codepoint = parseGlyphInput(text);
  const canAdd = codepoint !== null;

  const removeGlyph = (id: string) => {
    useDocumentStore.getState().deleteGlyph(id);
    useEditorStore.getState().resetEphemeral();
  };

  const onCellContextMenu = (e: MouseEvent, glyph: Glyph) => {
    e.preventDefault();
    ctxMenu.open(e.clientX, e.clientY, [
      {
        label: "Delete glyph",
        disabled: glyphs.length <= 1, // never remove the last glyph
        onSelect: () => setConfirmDelete(glyph),
      },
    ]);
  };

  const add = () => {
    if (codepoint === null) return;
    useDocumentStore.getState().addGlyph(codepoint);
    useEditorStore.getState().resetEphemeral();
    setText("");
  };

  // Switching glyphs is switching documents: drop any selection/pen/draft so the
  // new glyph opens clean (stale anchor refs would belong to the old glyph).
  const activateGlyph = (id: string) => {
    useDocumentStore.getState().setActiveGlyph(id);
    useEditorStore.getState().resetEphemeral();
  };

  if (collapsed) {
    return (
      <aside ref={asideRef} className="glyph-sidebar glyph-sidebar-collapsed" aria-label="Glyphs (collapsed)">
        <button
          type="button"
          className="sidebar-reopen"
          title="Show glyphs — click or drag out"
          aria-label="Show glyphs sidebar"
          onClick={() => useViewportStore.getState().setSidebarCollapsed(false)}
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
        >
          <span className="sidebar-reopen-grip" aria-hidden="true" />
        </button>
      </aside>
    );
  }

  return (
    <aside ref={asideRef} className="glyph-sidebar" aria-label="Glyphs" style={{ width: sidebarWidth }}>
      <div className="sidebar-header">
        <span className="panel-title">Glyphs</span>
        <span className="panel-count">{glyphs.length}</span>
      </div>

      <div className="glyph-grid" role="list">
        {glyphs.map((glyph) => (
          <GlyphCell
            key={glyph.id}
            glyph={glyph}
            active={glyph.id === activeGlyphId}
            isReference={references.has(glyph.id)}
            onActivate={() => activateGlyph(glyph.id)}
            onToggleReference={() => useOnionStore.getState().toggleReference(glyph.id)}
            onContextMenu={(e) => onCellContextMenu(e, glyph)}
          />
        ))}
      </div>

      {activeGlyph && (
        <div className="glyph-props">
          <NumberInput
            label="Advance width"
            value={activeGlyph.advanceWidth}
            min={0}
            max={5000}
            step={10}
            onChange={(w) => useDocumentStore.getState().setAdvanceWidth(w)}
          />
        </div>
      )}

      <div className="sidebar-footer">
        <input
          className="glyph-add-input"
          value={text}
          placeholder="A or U+0041"
          aria-label="New glyph character or code point"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button
          type="button"
          className="icon-btn"
          title="Add glyph"
          disabled={!canAdd}
          onClick={add}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path d="M8 3.5v9M3.5 8h9" />
          </svg>
        </button>
        <button
          type="button"
          className="icon-btn icon-btn-danger"
          title="Delete active glyph"
          disabled={glyphs.length <= 1}
          onClick={() => activeGlyphId && removeGlyph(activeGlyphId)}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path d="M4 5h8M6.5 5V3.5h3V5M5 5l.5 8h5l.5-8" />
          </svg>
        </button>
      </div>

      <ContextMenu menu={ctxMenu.menu} onClose={ctxMenu.close} />

      {confirmDelete && (
        <div className="modal-overlay" role="presentation" onMouseDown={() => setConfirmDelete(null)}>
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Delete glyph"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p className="confirm-message">
              Delete glyph “{glyphLabel(confirmDelete.codepoint)}”? This can be undone.
            </p>
            <div className="confirm-actions">
              <button type="button" className="btn" onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  removeGlyph(confirmDelete.id);
                  setConfirmDelete(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className="sidebar-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize glyphs sidebar"
        title="Drag to resize · drag left to collapse"
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
      />
    </aside>
  );
}
