import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * A right-click context menu, positioned at screen coordinates and rendered into
 * a portal so it escapes any clipping/transform of its origin. Items are plain
 * actions (label + onSelect + disabled) — the canvas builds them from the command
 * registry (`commandMenuItems`), the Layers panel builds layer-targeted ones
 * inline. An item may carry a `submenu` that opens a nested list on hover (e.g.
 * "Move to layer ▸"). Closes on item activation, outside pointer-down, or Escape.
 */

export interface ContextMenuItem {
  label: string;
  /** Action to run on activation. Omitted for a pure submenu parent. */
  onSelect?: () => void;
  disabled?: boolean;
  /** When present, the item opens this nested list on hover instead of acting. */
  submenu?: ContextMenuItem[];
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

/** Open/close state for a context menu, owned by the component that hosts it. */
export function useContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const open = useCallback(
    (x: number, y: number, items: ContextMenuItem[]) => setMenu({ x, y, items }),
    [],
  );
  const close = useCallback(() => setMenu(null), []);
  return { menu, open, close };
}

interface Props {
  menu: ContextMenuState | null;
  onClose: () => void;
}

/** One flat list of items; a submenu item renders its children to the side on hover.
 *  `maxHeight` (top-level only) caps the list and scrolls it when it would overflow. */
function MenuList({
  items,
  onClose,
  maxHeight,
}: {
  items: ContextMenuItem[];
  onClose: () => void;
  maxHeight?: number | undefined;
}) {
  const [open, setOpen] = useState<number | null>(null);
  // The open submenu's screen anchor (the parent row's rect). The flyout is PORTALED to
  // body at fixed coords so it escapes this list's vertical scroll container — otherwise
  // an absolutely-positioned `left:100%` flyout just triggers a horizontal scrollbar.
  const [anchor, setAnchor] = useState<{ left: number; right: number; top: number } | null>(null);

  return (
    <div
      className="context-menu"
      role="menu"
      // overflow-x is set explicitly so a lone overflow-y:auto can't compute to overflow-x:auto.
      style={maxHeight != null ? { maxHeight, overflowY: "auto", overflowX: "hidden" } : undefined}
    >
      {items.map((item, i) => {
        const hasSub = !!item.submenu && item.submenu.length > 0;
        const pad = 8;
        const flyoutTop = anchor ? Math.min(anchor.top, window.innerHeight - 120) : 0;
        const flipLeft = anchor ? anchor.right + 220 > window.innerWidth : false;
        return (
          <div
            key={i}
            className="menu-item-wrap"
            onMouseEnter={(e) => {
              if (!hasSub) {
                setOpen(null);
                return;
              }
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setAnchor({ left: r.left, right: r.right, top: r.top });
              setOpen(i);
            }}
          >
            <button
              type="button"
              role="menuitem"
              className={hasSub ? "menu-item menu-item-parent" : "menu-item"}
              disabled={item.disabled ?? false}
              onClick={() => {
                if (hasSub) return; // parent only opens its submenu
                item.onSelect?.();
                onClose();
              }}
            >
              <span>{item.label}</span>
              {hasSub && <span className="menu-item-arrow">▸</span>}
            </button>
            {hasSub &&
              open === i &&
              anchor &&
              createPortal(
                <div
                  className="context-menu-submenu"
                  style={{
                    position: "fixed",
                    top: flyoutTop,
                    ...(flipLeft
                      ? { right: window.innerWidth - anchor.left }
                      : { left: anchor.right }),
                  }}
                  // Keep the flyout open while the cursor is over it (it's outside the
                  // parent wrap, so re-assert this list's open index on enter).
                  onMouseEnter={() => setOpen(i)}
                >
                  <MenuList
                    items={item.submenu!}
                    onClose={onClose}
                    maxHeight={window.innerHeight - flyoutTop - pad}
                  />
                </div>,
                document.body,
              )}
          </div>
        );
      })}
    </div>
  );
}

export function ContextMenu({ menu, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Clamp into the viewport (shift up/left if the click was near an edge) and cap the
  // height so a tall menu scrolls instead of running off-screen.
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    if (!menu || !ref.current) {
      setPos(null);
      return;
    }
    const pad = 8;
    const { width, height } = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(pad, Math.min(menu.x, vw - width - pad));
    const top = Math.max(pad, Math.min(menu.y, vh - height - pad));
    setPos({ left, top, maxHeight: vh - top - pad });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      // Don't close on a click inside ANY context-menu surface — the root OR a portaled
      // submenu (which lives in its own <body> subtree, so `ref.contains` misses it; that
      // made submenu items close the menu before their onClick could run).
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".context-menu-root, .context-menu-submenu")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  return createPortal(
    <div
      ref={ref}
      className="context-menu-root"
      style={{ left: pos?.left ?? menu.x, top: pos?.top ?? menu.y }}
    >
      <MenuList items={menu.items} onClose={onClose} maxHeight={pos?.maxHeight} />
    </div>,
    document.body,
  );
}
