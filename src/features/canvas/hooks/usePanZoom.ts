import { useEffect, useRef } from "react";
import { useViewportStore } from "../../../state/viewportStore";
import { useEditorStore } from "../../../state/editorStore";

/** Multiplier per unit of wheel delta; exp keeps zoom smooth and reversible. */
const ZOOM_SENSITIVITY = 1.0015;

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT" ||
      el.isContentEditable)
  );
}

/**
 * Attaches Illustrator-style navigation to the canvas element:
 *   - Ctrl/Cmd + wheel  -> zoom to cursor (browsers also report trackpad pinch
 *                          as wheel + ctrlKey, so pinch-zoom works for free)
 *   - wheel             -> pan (Shift swaps axes for vertical-only mice)
 *   - Space + drag      -> hand-tool pan
 *   - Middle-mouse drag -> pan
 *
 * The wheel listener is registered natively with { passive: false } so it can
 * call preventDefault() and stop the page from scrolling/zooming. Store actions
 * are read via getState() to avoid re-subscribing the effect on every change.
 */
export function usePanZoom(ref: React.RefObject<HTMLElement>) {
  const panning = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const localCursor = (e: { clientX: number; clientY: number }) => {
      const rect = el.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const store = useViewportStore.getState();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.pow(ZOOM_SENSITIVITY, -e.deltaY);
        store.zoomAtCursor(factor, localCursor(e));
      } else {
        const dx = e.shiftKey ? -e.deltaY : -e.deltaX;
        const dy = e.shiftKey ? -e.deltaX : -e.deltaY;
        store.panBy(dx, dy);
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      const wantsPan =
        e.button === 1 || (e.button === 0 && useEditorStore.getState().spaceDown);
      if (!wantsPan) return;
      e.preventDefault();
      panning.current = true;
      last.current = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
      el.classList.add("is-panning");
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!panning.current) return;
      const dx = e.clientX - last.current.x;
      const dy = e.clientY - last.current.y;
      last.current = { x: e.clientX, y: e.clientY };
      useViewportStore.getState().panBy(dx, dy);
    };

    const endPan = (e: PointerEvent) => {
      if (!panning.current) return;
      panning.current = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
      el.classList.remove("is-panning");
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const editor = useEditorStore.getState();
      if (e.code === "Space" && !editor.spaceDown && !isEditable(e.target)) {
        editor.setSpaceDown(true);
        el.classList.add("space-held");
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        useEditorStore.getState().setSpaceDown(false);
        el.classList.remove("space-held");
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", endPan);
    el.addEventListener("pointercancel", endPan);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", endPan);
      el.removeEventListener("pointercancel", endPan);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [ref]);
}
