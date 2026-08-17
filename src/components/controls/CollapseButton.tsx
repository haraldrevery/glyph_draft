interface CollapseButtonProps {
  collapsed: boolean;
  onToggle: () => void;
  /** Panel name, for the accessible label ("Collapse Stroke" / "Expand Stroke"). */
  label: string;
}

/**
 * A small chevron button for the upper-right corner of a HUD panel. Rotates to
 * point up when expanded (click to collapse) and down when collapsed. Shared by
 * every collapsible panel so the affordance is identical across the app.
 */
export function CollapseButton({ collapsed, onToggle, label }: CollapseButtonProps) {
  return (
    <button
      type="button"
      className={`collapse-btn${collapsed ? " is-collapsed" : ""}`}
      aria-expanded={!collapsed}
      aria-label={`${collapsed ? "Expand" : "Collapse"} ${label}`}
      title={collapsed ? "Expand" : "Collapse"}
      onClick={onToggle}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M4 10l4-4 4 4" />
      </svg>
    </button>
  );
}
