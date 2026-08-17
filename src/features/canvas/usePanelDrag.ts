import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { usePanelStore, type PanelId } from "../../state/panelStore";

/**
 * Makes a floating HUD panel draggable by its header bar. Returns a `ref` for the
 * panel root, a `style` (fixed position once the panel has been moved, else
 * undefined so it keeps its default CSS spot), and `dragProps` to spread on the
 * header (the drag handle).
 *
 * The drag seeds from the panel's CURRENT on-screen rect, so the first grab never
 * jumps — even though the panel may start life inside a flex stack (View/Stroke)
 * or anchored bottom-right (Layers). Movement is clamped to the canvas area so a
 * panel can't be lost behind the header or off-screen. Clicks on header controls
 * (the collapse chevron, etc.) are ignored so they still work.
 */

/** Inset from the canvas edges the panel must stay within. */
const EDGE = 8;
/** Keep at least this much of the panel's top on-screen (so it's re-grabbable). */
const KEEP_VISIBLE = 36;
/** Smallest width a panel can be dragged down to. */
const MIN_W = 180;

export function usePanelDrag(id: PanelId) {
  const pos = usePanelStore((s) => s.positions[id]);
  const setPosition = usePanelStore((s) => s.setPosition);
  const ref = useRef<HTMLDivElement>(null);

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return; // primary button only
    // Don't hijack clicks on header controls (collapse button, etc.).
    if ((e.target as HTMLElement).closest("button, input, select, a, textarea")) return;
    const el = ref.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const w = rect.width;
    const grabX = e.clientX - rect.left;
    const grabY = e.clientY - rect.top;
    const bounds = el.closest(".canvas-viewport")?.getBoundingClientRect() ?? null;
    e.preventDefault();

    const onMove = (ev: PointerEvent) => {
      let x = ev.clientX - grabX;
      let y = ev.clientY - grabY;
      if (bounds) {
        x = Math.max(bounds.left + EDGE, Math.min(x, bounds.right - w - EDGE));
        y = Math.max(bounds.top + EDGE, Math.min(y, bounds.bottom - KEEP_VISIBLE));
      }
      setPosition(id, { x, y, w });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Resize the width by dragging the LEFT edge (the panels anchor top-right, so
  // widening leftward keeps the right edge put). Seeds from the current rect like
  // the move drag, which also detaches the panel to a fixed position so its width
  // can exceed the flex container.
  const onResizeDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = el.getBoundingClientRect();
    const startRight = (pos?.x ?? rect.left) + (pos?.w ?? rect.width);
    const top = pos?.y ?? rect.top;
    const bounds = el.closest(".canvas-viewport")?.getBoundingClientRect() ?? null;
    const minX = bounds ? bounds.left + EDGE : 0;

    const onMove = (ev: PointerEvent) => {
      const x = Math.max(minX, Math.min(ev.clientX, startRight - MIN_W));
      setPosition(id, { x, y: top, w: startRight - x });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const style: CSSProperties | undefined = pos
    ? {
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width: pos.w,
        right: "auto",
        bottom: "auto",
        margin: 0,
        // Cap the height to the viewport below the panel's top so a tall panel
        // scrolls its content instead of running off-screen (see .panel-content).
        maxHeight: `calc(100vh - ${pos.y + EDGE}px)`,
        zIndex: 40, // float a moved panel above the rest of the HUD
      }
    : undefined;

  return {
    ref,
    style,
    dragProps: { onPointerDown },
    resizeProps: { onPointerDown: onResizeDown },
  };
}
