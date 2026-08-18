import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import type { LayerGroup } from "../../types/document";

/**
 * A GROUP (folder) row in the Layers panel.
 *
 * Deliberately a sibling of `LayerRow` rather than a mode of it: a group has no
 * contours, no editing colour and no boolean-pair badge, so folding it into LayerRow
 * would mean threading "is this real?" through every control. It reuses the same
 * `.layer-row` classes so selection/active cues look identical.
 */
interface Props {
  group: LayerGroup;
  active: boolean;
  selected: boolean;
  depth: number;
  onSelect: (mods: { additive: boolean; range: boolean }) => void;
  onToggleCollapsed: () => void;
  onToggleVisible: () => void;
  onToggleLock: () => void;
  onRename: (name: string) => void;
  onContextMenu: (e: MouseEvent) => void;
  /** Drag-and-drop wiring from `useRowDrag` (pointer handlers + row id attributes). */
  dragProps?: Record<string, unknown>;
  /** Extra classes for the drag state (being dragged / drop indicator). */
  dragClass?: string;
}

function Triangle({ open }: { open: boolean }) {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
      <path
        d={open ? "M1 2.5 L7 2.5 L4 6.5 Z" : "M2.5 1 L6.5 4 L2.5 7 Z"}
        fill="currentColor"
      />
    </svg>
  );
}

export function GroupRow({
  group,
  active,
  selected,
  depth,
  onSelect,
  onToggleCollapsed,
  onToggleVisible,
  onToggleLock,
  onRename,
  onContextMenu,
  dragProps,
  dragClass = "",
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(group.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = (): void => {
    const name = draft.trim();
    if (name && name !== group.name) onRename(name);
    setEditing(false);
  };

  const expanded = !group.collapsed;
  const cls =
    "layer-row layer-row-group" +
    (selected ? " layer-row-selected" : "") +
    (active ? " layer-row-active" : "") +
    (dragClass ? ` ${dragClass}` : "");

  return (
    <div
      className={cls}
      style={depth ? { paddingLeft: `calc(var(--space-2) + ${depth} * 12px)` } : undefined}
      {...dragProps}
      onMouseDown={(e) => {
        if (e.button === 0) onSelect({ additive: e.ctrlKey || e.metaKey, range: e.shiftKey });
      }}
      onContextMenu={onContextMenu}
    >
      <button
        type="button"
        className="layer-disclosure"
        title={expanded ? "Collapse group" : "Expand group"}
        aria-expanded={expanded}
        // Like the eye/lock buttons: don't let the toggle also select the row.
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onToggleCollapsed}
      >
        <Triangle open={expanded} />
      </button>
      <button
        type="button"
        className={group.visible ? "layer-icon" : "layer-icon layer-icon-off"}
        title={group.visible ? "Hide group" : "Show group"}
        aria-pressed={!group.visible}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onToggleVisible}
      >
        {group.visible ? "◉" : "◌"}
      </button>
      <button
        type="button"
        className={group.locked ? "layer-icon layer-icon-on" : "layer-icon"}
        title={group.locked ? "Unlock group" : "Lock group"}
        aria-pressed={group.locked}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onToggleLock}
      >
        {group.locked ? "🔒" : "🔓"}
      </button>
      {editing ? (
        <input
          ref={inputRef}
          className="layer-name-input"
          value={draft}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(group.name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <span
          className="layer-name layer-name-group"
          title={group.name}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={() => {
            setDraft(group.name);
            setEditing(true);
          }}
        >
          {group.name}
        </span>
      )}
      {group.renderAsOne && (
        <span className="layer-group-badge" title="Rendered as one layer">
          ◼
        </span>
      )}
    </div>
  );
}
