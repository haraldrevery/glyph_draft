import { createContext, useContext, useId, type ReactNode } from "react";
import { useMenuBar } from "./MenuBar";

/**
 * One top-level menubar entry: a trigger button plus its dropdown panel. The
 * panel renders only when this menu is the open one (tracked by <MenuBar>).
 * Clicking the trigger toggles it; once any menu is open, hovering this trigger
 * switches to it. Children are arbitrary — action rows (<MenuItem>) or controls
 * like a <Toggle> dropped straight in.
 */

interface MenuContextValue {
  close: () => void;
}

const MenuContext = createContext<MenuContextValue | null>(null);

/** Lets descendants (e.g. MenuItem) close the menu after activating. */
export function useMenu(): MenuContextValue {
  const ctx = useContext(MenuContext);
  if (!ctx) throw new Error("useMenu must be used inside <Menu>");
  return ctx;
}

interface MenuProps {
  label: string;
  children: ReactNode;
}

export function Menu({ label, children }: MenuProps) {
  const id = useId();
  const { openId, setOpenId, hasOpen } = useMenuBar();
  const isOpen = openId === id;

  const close = () => setOpenId(null);

  return (
    <div className="menu">
      <button
        type="button"
        className={`menu-trigger${isOpen ? " is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setOpenId(isOpen ? null : id)}
        onPointerEnter={() => {
          if (hasOpen) setOpenId(id);
        }}
      >
        {label}
      </button>

      {isOpen && (
        <MenuContext.Provider value={{ close }}>
          <div className="menu-dropdown" role="menu" aria-label={label}>
            {children}
          </div>
        </MenuContext.Provider>
      )}
    </div>
  );
}
