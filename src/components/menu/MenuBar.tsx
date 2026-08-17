import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * A lightweight, composition-based menubar. <MenuBar> owns the single "which
 * top-level menu is open" id; <Menu> registers itself and reads that id to know
 * whether to render its dropdown. This keeps the standard menubar feel — one
 * menu open at a time, hovering a sibling switches when one is already open —
 * without any external dependency. Adding a menu later is just another <Menu>
 * child; nothing here needs to change.
 */

interface MenuBarContextValue {
  openId: string | null;
  setOpenId: (id: string | null) => void;
  /** True once any menu is open — used so hover switches between top-level menus. */
  hasOpen: boolean;
}

const MenuBarContext = createContext<MenuBarContextValue | null>(null);

export function useMenuBar(): MenuBarContextValue {
  const ctx = useContext(MenuBarContext);
  if (!ctx) throw new Error("Menu components must be rendered inside <MenuBar>");
  return ctx;
}

interface MenuBarProps {
  children: ReactNode;
  "aria-label"?: string;
}

export function MenuBar({ children, "aria-label": ariaLabel }: MenuBarProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Click-outside and Escape both close the open menu. Only bound while open.
  useEffect(() => {
    if (openId === null) return;

    const onPointerDown = (e: PointerEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpenId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openId]);

  const set = useCallback((id: string | null) => setOpenId(id), []);

  return (
    <MenuBarContext.Provider
      value={{ openId, setOpenId: set, hasOpen: openId !== null }}
    >
      <div ref={barRef} className="menubar" role="menubar" aria-label={ariaLabel}>
        {children}
      </div>
    </MenuBarContext.Provider>
  );
}
