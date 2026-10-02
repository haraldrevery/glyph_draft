import { useMenu } from "./Menu";

/**
 * A clickable action row inside a <Menu> dropdown. Runs onSelect, then closes
 * the menu. For stateful controls (toggles, sliders) drop the control component
 * directly into <Menu> instead — this is only for fire-and-close actions.
 */

interface MenuItemProps {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Show a ✓ to mark the active option (e.g. the current theme). Omit for plain actions. */
  checked?: boolean;
  /** The bound keyboard shortcut, shown right-aligned (e.g. "Ctrl Z"). */
  shortcut?: string;
}

export function MenuItem({ label, onSelect, disabled = false, checked, shortcut }: MenuItemProps) {
  const { close } = useMenu();

  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      className={shortcut ? "menu-item menu-item-keyed" : "menu-item"}
      disabled={disabled}
      onClick={() => {
        onSelect();
        close();
      }}
    >
      {checked !== undefined && (
        <span className="menu-check" aria-hidden="true">{checked ? "✓" : ""}</span>
      )}
      {shortcut ? <span>{label}</span> : label}
      {shortcut && <span className="menu-shortcut">{shortcut}</span>}
    </button>
  );
}
