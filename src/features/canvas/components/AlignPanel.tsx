import type { ReactNode } from "react";
import { useEditorStore } from "../../../state/editorStore";
import { alignSelectedPaths, canAlign } from "../editActions";
import type { AlignType } from "../../../engine/geometry/align";

/**
 * Illustrator-style Align panel. It floats over the canvas and only appears when 2+
 * paths are selected (via their nodes). Each button aligns/distributes the selected
 * paths' bounding boxes relative to the selection's overall bounds — one undo step.
 * Subscribes to the (ephemeral) node selection so it shows/hides as you select.
 */

const REF = { stroke: "currentColor", strokeWidth: 1, strokeLinecap: "round" as const };

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width={16} height={16} fill="currentColor" aria-hidden="true">
      {children}
    </svg>
  );
}

const ICONS: Record<AlignType, ReactNode> = {
  left: (
    <Icon>
      <line x1={2} y1={2} x2={2} y2={14} {...REF} />
      <rect x={3} y={4} width={8} height={3} />
      <rect x={3} y={9} width={11} height={3} />
    </Icon>
  ),
  centerH: (
    <Icon>
      <line x1={8} y1={2} x2={8} y2={14} {...REF} />
      <rect x={4} y={4} width={8} height={3} />
      <rect x={2.5} y={9} width={11} height={3} />
    </Icon>
  ),
  right: (
    <Icon>
      <line x1={14} y1={2} x2={14} y2={14} {...REF} />
      <rect x={5} y={4} width={8} height={3} />
      <rect x={2} y={9} width={11} height={3} />
    </Icon>
  ),
  top: (
    <Icon>
      <line x1={2} y1={2} x2={14} y2={2} {...REF} />
      <rect x={4} y={3} width={3} height={8} />
      <rect x={9} y={3} width={3} height={11} />
    </Icon>
  ),
  middleV: (
    <Icon>
      <line x1={2} y1={8} x2={14} y2={8} {...REF} />
      <rect x={4} y={4} width={3} height={8} />
      <rect x={9} y={2.5} width={3} height={11} />
    </Icon>
  ),
  bottom: (
    <Icon>
      <line x1={2} y1={14} x2={14} y2={14} {...REF} />
      <rect x={4} y={5} width={3} height={8} />
      <rect x={9} y={2} width={3} height={11} />
    </Icon>
  ),
  distributeH: (
    <Icon>
      <rect x={1.5} y={3} width={3} height={10} />
      <rect x={6.5} y={3} width={3} height={10} />
      <rect x={11.5} y={3} width={3} height={10} />
    </Icon>
  ),
  distributeV: (
    <Icon>
      <rect x={3} y={1.5} width={10} height={3} />
      <rect x={3} y={6.5} width={10} height={3} />
      <rect x={3} y={11.5} width={10} height={3} />
    </Icon>
  ),
};

const GROUPS: { type: AlignType; title: string }[][] = [
  [
    { type: "left", title: "Align left" },
    { type: "centerH", title: "Align horizontal centers" },
    { type: "right", title: "Align right" },
  ],
  [
    { type: "top", title: "Align top" },
    { type: "middleV", title: "Align vertical centers" },
    { type: "bottom", title: "Align bottom" },
  ],
  [
    { type: "distributeH", title: "Distribute horizontally" },
    { type: "distributeV", title: "Distribute vertically" },
  ],
];

export function AlignPanel() {
  // Re-render when the node selection changes; gate on having ≥2 selected paths.
  useEditorStore((s) => s.selection);
  if (!canAlign()) return null;

  return (
    <div className="align-panel" role="toolbar" aria-label="Align paths">
      {GROUPS.map((group, gi) => (
        <div className="align-group" key={gi}>
          {group.map((b) => (
            <button
              key={b.type}
              type="button"
              className="align-btn"
              title={b.title}
              aria-label={b.title}
              onClick={() => alignSelectedPaths(b.type)}
            >
              {ICONS[b.type]}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
