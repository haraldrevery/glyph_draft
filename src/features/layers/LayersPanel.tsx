import { useState } from "react";
import {
  useActiveGlyph,
  useActiveLayerId,
  useSelectedLayerIds,
  useBooleanPairs,
  pairForLayer,
  useDocumentStore,
} from "../../state/documentStore";
import type { BooleanOp, Layer, LayerGroup, PairOp } from "../../types/document";
import { CollapseButton } from "../../components/controls/CollapseButton";
import { NumberInput } from "../../components/controls/NumberInput";
import { usePanelDrag } from "../canvas/usePanelDrag";
import {
  ContextMenu,
  useContextMenu,
  type ContextMenuItem,
} from "../../components/menu";
import { LayerRow, OP_LABEL, OP_SYMBOL, pairColor } from "./LayerRow";
import { GroupRow } from "./GroupRow";
import { groupMembers, visibleRows } from "./layerTree";
import { mergeLayers } from "./mergeLayers";
import { layerColorMap } from "./layerColors";
import { useEditorStore } from "../../state/editorStore";

/**
 * The Layers panel. The stored layer array is bottom-to-top (paint order), so
 * the panel renders it REVERSED — the top of the list is the top of the stack,
 * matching Illustrator. Click selects one layer (and makes it active);
 * Ctrl/Cmd+click toggles layers into a multi-selection. When exactly two layers
 * are selected, the Pathfinder bar appears: pick an operation and the two layers
 * are joined by a live, non-destructive boolean (the UPPER layer is operand A,
 * the LOWER is B; Subtract = A − B). Every document edit is a single undo step.
 */

const OPS: BooleanOp[] = ["union", "subtract", "intersect", "exclude"];
/** The Pathfinder ops shown in the bar: the 4 booleans + the Blend (A→B morph). */
const PATHFINDER_OPS: PairOp[] = [...OPS, "blend"];
/** Default / max in-between steps for a Blend pair (the engine caps higher). */
const DEFAULT_BLEND_STEPS = 4;
const MAX_BLEND_STEPS_UI = 32;

export function LayersPanel() {
  const glyph = useActiveGlyph();
  const activeLayerId = useActiveLayerId();
  const selectedLayerIds = useSelectedLayerIds();
  const pairs = useBooleanPairs();
  // Layers that own a selected NODE (a node selection can span layers) — tinted subtly so
  // the user sees which layers an edit will touch, distinct from the Pathfinder selection.
  const selection = useEditorStore((s) => s.selection);
  const involvedLayerIds = new Set(selection.map((r) => r.layerId));
  const [collapsed, setCollapsed] = useState(false);
  const ctxMenu = useContextMenu();
  const { ref, style, dragProps, resizeProps } = usePanelDrag("layers");
  if (!glyph) return null;

  const layers = glyph.layers;
  const rows = visibleRows(glyph);
  const colors = layerColorMap(layers.map((l) => l.id));
  const indexById = new Map(layers.map((l, i) => [l.id, i] as const));
  const activeIndex = layers.findIndex((l) => l.id === activeLayerId);
  const atTop = activeIndex === layers.length - 1;
  const atBottom = activeIndex === 0;
  const canDelete = layers.length > 1;

  const doc = useDocumentStore.getState;

  // Layer-targeted right-click actions (parameterized by the clicked layer, so
  // they don't fit the parameter-free command registry — built inline here).
  const layerMenuItems = (layer: Layer, effectiveIds: string[]): ContextMenuItem[] => [
    { label: "New layer", onSelect: () => doc().addLayer() },
    { label: "Duplicate layer", onSelect: () => doc().duplicateLayer(layer.id) },
    {
      label: layer.visible ? "Hide layer" : "Show layer",
      onSelect: () => doc().setLayerVisible(layer.id, !layer.visible),
    },
    {
      label: layer.locked ? "Unlock layer" : "Lock layer",
      onSelect: () => doc().setLayerLocked(layer.id, !layer.locked),
    },
    {
      label: effectiveIds.length > 1 ? `Group ${effectiveIds.length} layers` : "Group layer",
      onSelect: () => doc().groupLayers(effectiveIds),
    },
    ...(layer.groupId
      ? [
          {
            label: "Ungroup",
            onSelect: () => layer.groupId && doc().ungroupGroup(layer.groupId),
          },
        ]
      : []),
    {
      // Destructively bake the selected layers (strokes + any boolean among them)
      // into one flattened layer. Needs ≥2 selected.
      label: `Merge ${effectiveIds.length} layers`,
      onSelect: () => mergeLayers(effectiveIds),
      disabled: effectiveIds.length < 2,
    },
    {
      label: "Delete layer",
      onSelect: () => doc().deleteLayer(layer.id),
      disabled: !canDelete,
    },
  ];

  // Group-targeted right-click actions.
  const groupMenuItems = (grp: LayerGroup): ContextMenuItem[] => [
    {
      label: grp.collapsed ? "Expand group" : "Collapse group",
      onSelect: () => doc().setGroupCollapsed(grp.id, !grp.collapsed),
    },
    {
      label: grp.visible ? "Hide group" : "Show group",
      onSelect: () => doc().setGroupVisible(grp.id, !grp.visible),
    },
    {
      label: grp.locked ? "Unlock group" : "Lock group",
      onSelect: () => doc().setGroupLocked(grp.id, !grp.locked),
    },
    { label: "Ungroup", onSelect: () => doc().ungroupGroup(grp.id) },
    {
      label: `Merge ${groupMembers(glyph, grp.id).length} layers`,
      onSelect: () => mergeLayers(groupMembers(glyph, grp.id).map((l) => l.id)),
      disabled: groupMembers(glyph, grp.id).length < 2,
    },
  ];

  // Pathfinder operands: exactly two selected layers, ordered upper (A) / lower (B).
  let operands: { upper: string; lower: string; upperName: string; lowerName: string } | null =
    null;
  if (selectedLayerIds.length === 2) {
    const [x, y] = selectedLayerIds;
    const ix = indexById.get(x!) ?? -1;
    const iy = indexById.get(y!) ?? -1;
    if (ix >= 0 && iy >= 0) {
      const upper = ix > iy ? x! : y!;
      const lower = ix > iy ? y! : x!;
      operands = {
        upper,
        lower,
        upperName: layers[indexById.get(upper)!]!.name,
        lowerName: layers[indexById.get(lower)!]!.name,
      };
    }
  }
  // If these two operands are already a Blend pair, surface its step count for editing.
  const activePair = operands ? pairForLayer(pairs, operands.upper) : undefined;
  const blendPair = activePair?.op === "blend" ? activePair : undefined;
  // Cost hint: each STROKED step re-expands its outline (Paper) on every render — heavy
  // live. Plain (unstroked) steps are cheap, so only warn at a very high count.
  const blendStroked =
    !!blendPair &&
    [operands!.upper, operands!.lower].some((id) =>
      (layers[indexById.get(id) ?? -1]?.contours ?? []).some((c) => !!c.stroke),
    );
  const blendCostly =
    !!blendPair && ((blendStroked && (blendPair.steps ?? DEFAULT_BLEND_STEPS) >= 8) || (blendPair.steps ?? DEFAULT_BLEND_STEPS) >= 24);

  return (
    <div ref={ref} style={style} className="layers-panel">
      <div className="panel-resize" {...resizeProps} />
      <div className="panel-header panel-drag" {...dragProps}>
        <span className="panel-title">Layers</span>
        <span className="panel-header-right">
          <span className="panel-count">
            {layers.length}
            {selectedLayerIds.length > 1 ? ` · ${selectedLayerIds.length} selected` : ""}
          </span>
          <CollapseButton
            collapsed={collapsed}
            onToggle={() => setCollapsed((c) => !c)}
            label="Layers"
          />
        </span>
      </div>

      {collapsed ? null : (
        <>

      {operands && (
        <div className="pathfinder-bar">
          <div className="pathfinder-caption">
            A: <strong>{operands.upperName}</strong> − B: <strong>{operands.lowerName}</strong>
          </div>
          <div className="pathfinder-ops">
            {PATHFINDER_OPS.map((op) => (
              <button
                key={op}
                type="button"
                className="pathfinder-op"
                title={
                  op === "blend"
                    ? "Blend (A → B shape morph / echo)"
                    : `${OP_LABEL[op]} (A ${OP_SYMBOL[op]} B)`
                }
                onClick={() =>
                  doc().setBooleanPair(
                    operands!.upper,
                    operands!.lower,
                    op,
                    op === "blend" ? DEFAULT_BLEND_STEPS : undefined,
                  )
                }
              >
                <span className="pathfinder-op-symbol">{OP_SYMBOL[op]}</span>
                <span className="pathfinder-op-label">{OP_LABEL[op]}</span>
              </button>
            ))}
          </div>
          {blendPair && (
            <div className="pathfinder-steps">
              <NumberInput
                label="Blend steps"
                value={blendPair.steps ?? DEFAULT_BLEND_STEPS}
                min={1}
                max={MAX_BLEND_STEPS_UI}
                step={1}
                onChange={(n) =>
                  doc().setBooleanPair(operands!.upper, operands!.lower, "blend", n)
                }
              />
              {blendCostly && (
                <p className="pathfinder-warn">
                  ⚠ {blendStroked ? "Stroked" : "Many"} blend steps re-render each step — a high
                  count can slow live editing.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="layer-list" role="list">
        {/* Rows come from the group tree (top-down, collapse-aware) rather than a raw
            reversed array — `visibleRows` is the one flattening the panel, Shift-range
            selection and the tree helpers all share. */}
        {rows.map((row) => {
          if (row.group) {
            const grp = row.group;
            const memberIds = groupMembers(glyph, grp.id).map((l) => l.id);
            // A group row reads as "selected" when its whole membership is.
            const allSelected =
              memberIds.length > 0 && memberIds.every((id) => selectedLayerIds.includes(id));
            return (
              <GroupRow
                key={grp.id}
                group={grp}
                depth={row.depth}
                active={false}
                selected={allSelected}
                onSelect={({ additive, range }) => {
                  if (range && memberIds[0]) doc().selectLayerRange(memberIds[0]);
                  else doc().selectGroup(grp.id, additive);
                }}
                onToggleCollapsed={() => doc().setGroupCollapsed(grp.id, !grp.collapsed)}
                onToggleVisible={() => doc().setGroupVisible(grp.id, !grp.visible)}
                onToggleLock={() => doc().setGroupLocked(grp.id, !grp.locked)}
                onRename={(name) => doc().renameGroup(grp.id, name)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  ctxMenu.open(e.clientX, e.clientY, groupMenuItems(grp));
                }}
              />
            );
          }
          const layer = row.layer!;
          {
            const pair = pairForLayer(pairs, layer.id);
            let pairProp: { op: PairOp; role: "A" | "B"; color: string } | undefined;
            if (pair) {
              const partnerId = pair.layerIds.find((id) => id !== layer.id)!;
              const role =
                (indexById.get(layer.id) ?? -1) > (indexById.get(partnerId) ?? -1)
                  ? "A"
                  : "B";
              pairProp = { op: pair.op, role, color: pairColor(pair.id) };
            }
            return (
              <LayerRow
                key={layer.id}
                layer={layer}
                active={layer.id === activeLayerId}
                selected={selectedLayerIds.includes(layer.id)}
                involved={involvedLayerIds.has(layer.id)}
                color={colors.get(layer.id)!}
                {...(pairProp ? { pair: pairProp } : {})}
                onSelect={({ additive, range }) =>
                  range
                    ? doc().selectLayerRange(layer.id)
                    : additive
                      ? doc().toggleLayerSelection(layer.id)
                      : doc().setActiveLayer(layer.id)
                }
                onToggleVisible={() => doc().setLayerVisible(layer.id, !layer.visible)}
                onToggleLock={() => doc().setLayerLocked(layer.id, !layer.locked)}
                onClearPair={() => doc().clearBooleanPair(layer.id)}
                onRename={(name) => doc().renameLayer(layer.id, name)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  // Preserve a multi-selection when right-clicking one of its members;
                  // right-clicking an unselected row targets just it.
                  const inSel = selectedLayerIds.includes(layer.id);
                  const effectiveIds = inSel ? selectedLayerIds : [layer.id];
                  if (!inSel) doc().setActiveLayer(layer.id);
                  ctxMenu.open(e.clientX, e.clientY, layerMenuItems(layer, effectiveIds));
                }}
                depth={row.depth}
              />
            );
          }
        })}
      </div>

      <div className="layer-actions">
        <button
          type="button"
          className="icon-btn"
          title="New layer"
          onClick={() => doc().addLayer()}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path d="M8 3.5v9M3.5 8h9" />
          </svg>
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Duplicate layer"
          onClick={() => doc().duplicateLayer()}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1" />
            <path d="M10.5 5.5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1h1.5" />
          </svg>
        </button>
        <span className="layer-actions-spacer" />
        <button
          type="button"
          className="icon-btn"
          title="Move up"
          disabled={atTop || activeIndex < 0}
          onClick={() => activeLayerId && doc().moveLayer(activeLayerId, "up")}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path d="M8 12V4M4.5 7.5L8 4l3.5 3.5" />
          </svg>
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Move down"
          disabled={atBottom || activeIndex < 0}
          onClick={() => activeLayerId && doc().moveLayer(activeLayerId, "down")}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path d="M8 4v8M4.5 8.5L8 12l3.5-3.5" />
          </svg>
        </button>
        <button
          type="button"
          className="icon-btn icon-btn-danger"
          title="Delete layer"
          disabled={!canDelete}
          onClick={() => activeLayerId && doc().deleteLayer(activeLayerId)}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path d="M4 5h8M6.5 5V3.5h3V5M5 5l.5 8h5l.5-8" />
          </svg>
        </button>
      </div>
        </>
      )}
      <ContextMenu menu={ctxMenu.menu} onClose={ctxMenu.close} />
    </div>
  );
}
