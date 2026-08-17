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
}

export function MenuItem({ label, onSelect, disabled = false, checked }: MenuItemProps) {
  const { close } = useMenu();

  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      className="menu-item"
      disabled={disabled}
      onClick={() => {
        onSelect();
        close();
      }}
    >
      {checked !== undefined && (
        <span className="menu-check" aria-hidden="true">{checked ? "✓" : ""}</span>
      )}
      {label}
    </button>
  );
}
