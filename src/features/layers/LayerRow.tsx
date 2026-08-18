import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import type { Layer, PairOp } from "../../types/document";

/**
 * One row in the Layers panel. The whole row activates the layer; the eye and
 * lock are independent toggles; a double-click on the name opens an inline
 * rename (Enter/blur commits, Esc cancels). When the layer belongs to a boolean
 * pair, a badge shows the operation and its role (A = upper operand, B = lower);
 * clicking the badge clears the pair. Kept presentational — all state changes are
 * delegated up to the panel via callbacks.
 */

export const OP_SYMBOL: Record<PairOp, string> = {
  union: "∪",
  subtract: "−",
  intersect: "∩",
  exclude: "⊕",
  blend: "≈",
};

export const OP_LABEL: Record<PairOp, string> = {
  union: "Union",
  subtract: "Subtract",
  intersect: "Intersect",
  exclude: "Exclude",
  blend: "Blend",
};

/**
 * A stable, distinct color per boolean pair, hashed from the pair id so both
 * paired layers' badges share it and it never changes between renders. Only the
 * hue varies (fixed saturation/lightness) so it stays legible in either theme.
 */
export function pairColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 70%, 60%)`;
}

interface Props {
  layer: Layer;
  active: boolean;
  selected: boolean;
  /** This layer owns a currently-selected node — a faint tint cue (weaker than
   *  active/selected) so the user sees which layers an edit will touch. */
  involved?: boolean;
  /** The layer's editing color (auto palette) — shown as a swatch and used for its
   *  paths/nodes on the canvas. */
  color: string;
  /** Present when this layer is in a boolean pair. Role A = upper, B = lower;
   *  `color` is shared by both layers of the pair so they read as a set. */
  pair?: { op: PairOp; role: "A" | "B"; color: string };
  /** Selection click: `additive` = Ctrl/Cmd (toggle one), `range` = Shift (select
   *  all layers between the active layer and this one). */
  onSelect: (mods: { additive: boolean; range: boolean }) => void;
  onToggleVisible: () => void;
  onToggleLock: () => void;
  onClearPair: () => void;
  onRename: (name: string) => void;
  onContextMenu: (e: MouseEvent) => void;
  /** Nesting depth inside layer groups; 0 = top level. Indents the row. */
  depth?: number;
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8z" />
      <circle cx="8" cy="8" r="2" />
      {!open && <line x1="2.5" y1="13.5" x2="13.5" y2="2.5" />}
    </svg>
  );
}

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="6" rx="1" />
      {locked ? (
        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
      ) : (
        <path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-0.8" />
      )}
    </svg>
  );
}

export function LayerRow({
  layer,
  active,
  selected,
  involved = false,
  color,
  pair,
  onSelect,
  onToggleVisible,
  onToggleLock,
  onClearPair,
  onRename,
  onContextMenu,
  depth = 0,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(layer.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft !== layer.name) onRename(draft);
    else setDraft(layer.name);
  };

  const cls =
    "layer-row" +
    (involved ? " layer-row-involved" : "") +
    (selected ? " layer-row-selected" : "") +
    (active ? " layer-row-active" : "");

  return (
    <div
      className={cls}
      // Indent with PADDING, not margin: the active/selected cue is an inset
      // box-shadow bar at the row's left edge, which must stay flush with the panel.
      style={depth ? { paddingLeft: `calc(var(--space-2) + ${depth} * 12px)` } : undefined}
      onMouseDown={(e) => {
        // Left button only — a right-click must not collapse a multi-selection
        // (the context menu preserves it; see LayersPanel.onContextMenu).
        if (e.button === 0) onSelect({ additive: e.ctrlKey || e.metaKey, range: e.shiftKey });
      }}
      onContextMenu={onContextMenu}
    >
      <span
        className="layer-swatch"
        style={{ background: color }}
        title="Layer color (canvas paths & nodes)"
        aria-hidden="true"
      />
      <button
        type="button"
        className={layer.visible ? "layer-icon" : "layer-icon layer-icon-off"}
        title={layer.visible ? "Hide layer" : "Show layer"}
        aria-pressed={!layer.visible}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onToggleVisible}
      >
        <EyeIcon open={layer.visible} />
      </button>

      <button
        type="button"
        className={layer.locked ? "layer-icon layer-icon-on" : "layer-icon"}
        title={layer.locked ? "Unlock layer" : "Lock layer"}
        aria-pressed={layer.locked}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onToggleLock}
      >
        <LockIcon locked={layer.locked} />
      </button>

      {editing ? (
        <input
          ref={inputRef}
          className="layer-name-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") {
              setDraft(layer.name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <span
          className="layer-name"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setDraft(layer.name);
            setEditing(true);
          }}
        >
          {layer.name}
        </span>
      )}

      {pair && (
        <button
          type="button"
          className="layer-pair-badge"
          style={{ ["--pair-color"]: pair.color } as CSSProperties}
          title={`${OP_LABEL[pair.op]} (operand ${pair.role}) — click to remove`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onClearPair}
        >
          <span className="layer-pair-op">{OP_SYMBOL[pair.op]}</span>
          <span className="layer-pair-role">{pair.role}</span>
        </button>
      )}
    </div>
  );
}
