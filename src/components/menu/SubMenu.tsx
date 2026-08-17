import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A nested submenu inside a <Menu> dropdown: a parent row that opens its children
 * in a flyout to the side on hover. Children are normal menu content (e.g. a few
 * <MenuItem checked> options). The parent <Menu> still owns open/close, so a
 * MenuItem inside closes the whole dropdown after acting, as usual.
 *
 * Closing is on a short GRACE DELAY so moving the cursor diagonally from the parent
 * row onto the flyout (crossing the tiny gap) doesn't dismiss it before you arrive.
 */
const CLOSE_DELAY_MS = 180;

interface SubMenuProps {
  label: string;
  children: ReactNode;
}

export function SubMenu({ label, children }: SubMenuProps) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const openNow = () => {
    cancelClose();
    setOpen(true);
  };
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };
  useEffect(() => cancelClose, []);

  return (
    <div
      className="menu-subitem"
      onPointerEnter={openNow}
      onPointerLeave={closeSoon}
    >
      <button
        type="button"
        className="menu-item menu-item-parent"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span>{label}</span>
        <span className="menu-item-arrow" aria-hidden="true">▸</span>
      </button>
      {open && (
        <div className="menu-flyout" role="menu" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}
