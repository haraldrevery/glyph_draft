import type { ReactNode } from "react";
import { useEditorStore, type ToolId } from "../../state/editorStore";
import { TOOLS } from "../tools";

/**
 * The tool palette. It is entirely data-driven from the tool registry — each
 * registered tool becomes a button with its icon, label, and shortcut — so
 * adding a tool never touches this file beyond the icon map below. Active state
 * and switching go through the editor store; the icon set is kept here (a view
 * concern) rather than on the tool definitions (logic), so the two evolve
 * independently.
 */

const ICONS: Record<ToolId, ReactNode> = {
  select: (
    <path d="M3 2l9 5.5-4.2 0.8 2.4 4.3-1.7 0.9-2.3-4.3L3 12z" />
  ),
  lasso: (
    <path d="M3 7c0-2.5 2.5-4 5-4s5 1.5 5 4-2.5 4-5 4c-1 0-2 .3-2 1.2 0 .8.7 1.3.7 1.3" />
  ),
  pen: (
    <>
      <path d="M11.5 2.5l2 2-6.5 6.5-2.8 0.8 0.8-2.8z" />
      <path d="M4 12.5l-1.5 1.5" />
    </>
  ),
  freepen: <path d="M2 10c1.4-3 2.8-3 4.2 0s2.8 3 4.2 0 2.8-3 4.2 0" />,
  scissors: (
    <>
      <circle cx="4" cy="5" r="1.8" />
      <circle cx="4" cy="11" r="1.8" />
      <path d="M5.4 5.8L13.5 11M5.4 10.2L13.5 5" />
    </>
  ),
  knife: (
    <>
      <path d="M3 13l8-8 2.5 2.5-7 7z" />
      <path d="M3 13l-0.5 0.5" />
    </>
  ),
  eraser: (
    <>
      <path d="M4.5 11l5-5 4 4-2.5 2.5H7z" />
      <path d="M7 13.5h6.5" />
    </>
  ),
  rectangle: <rect x="2.5" y="3.5" width="11" height="9" rx="0.5" />,
  ellipse: <ellipse cx="8" cy="8" rx="5.5" ry="4.5" />,
  line: <path d="M3 13L13 3" />,
  polygon: <path d="M8 2l5.2 3.8-2 6.2H4.8l-2-6.2z" />,
  triangle: <path d="M8 3l5.5 10h-11z" />,
};

export function Toolbar() {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setTool = useEditorStore((s) => s.setTool);

  return (
    <div className="toolbar" role="toolbar" aria-label="Drawing tools" aria-orientation="vertical">
      {TOOLS.map((tool) => {
        const active = tool.id === activeTool;
        return (
          <button
            key={tool.id}
            type="button"
            className={active ? "tool-button tool-button-active" : "tool-button"}
            aria-pressed={active}
            title={`${tool.label} (${tool.shortcut.toUpperCase()})`}
            onClick={() => setTool(tool.id)}
          >
            <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
              {ICONS[tool.id]}
            </svg>
            <span className="tool-shortcut" aria-hidden="true">
              {tool.shortcut.toUpperCase()}
            </span>
          </button>
        );
      })}
    </div>
  );
}
