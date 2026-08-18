import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useEditorStore } from "../../../state/editorStore";
import { useActiveGlyph, useDocumentStore } from "../../../state/documentStore";
import { useViewportStore } from "../../../state/viewportStore";
import { screenToWorld, worldToScreen } from "../../../engine/viewport/transform";
import {
  scaleAbout,
  rotateAbout,
  translate,
  transformSelected,
  apply,
  IDENTITY,
  type Matrix,
} from "../../../engine/geometry/affine";
import { isEditable } from "../../../utils/dom";
import type { Contour } from "../../../types/geometry";
import type { Vec2, Viewport } from "../../../types/viewport";
import { resolvedLayers } from "../../layers/layerTree";

/**
 * The transform box (Ctrl+T): a bounding box over the current node selection with
 * scale handles (8), a rotate handle, and a draggable border for move. It applies a
 * pure affine (`engine/geometry/affine.ts`) to the selected anchors across layers,
 * previewing through `liveContours` and committing once on release via
 * `replaceContoursEverywhere` — one undo step. Stays open until Esc/Enter; the tool
 * controller stands down while it's active, so the handles own the pointer.
 */

type ScaleKind = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type HandleKind = ScaleKind | "rotate" | "move" | "pivot";

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const SCALE_HANDLES: ScaleKind[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const OPPOSITE: Record<ScaleKind, ScaleKind> = {
  nw: "se", ne: "sw", se: "nw", sw: "ne", n: "s", s: "n", e: "w", w: "e",
};
const AFFECTS_X = new Set<ScaleKind>(["nw", "ne", "se", "sw", "e", "w"]);
const AFFECTS_Y = new Set<ScaleKind>(["nw", "ne", "se", "sw", "n", "s"]);
/** CSS cursor per handle (purely cosmetic). */
const CURSOR: Record<ScaleKind, string> = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
};

/** A named point of the box, in world coords (Y-up: "n" = top = maxY). */
function pointOf(kind: ScaleKind | "center", b: BBox): Vec2 {
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  switch (kind) {
    case "nw": return { x: b.minX, y: b.maxY };
    case "ne": return { x: b.maxX, y: b.maxY };
    case "sw": return { x: b.minX, y: b.minY };
    case "se": return { x: b.maxX, y: b.minY };
    case "n": return { x: cx, y: b.maxY };
    case "s": return { x: cx, y: b.minY };
    case "e": return { x: b.maxX, y: cy };
    case "w": return { x: b.minX, y: cy };
    case "center": return { x: cx, y: cy };
  }
}

function safeDiv(n: number, d: number): number {
  return d === 0 ? 1 : n / d;
}

const ROTATE_OFFSET_PX = 26;

interface Drag {
  kind: HandleKind;
  start: Vec2; // world
  bbox: BBox; // committed box at drag start — the stable pivot/center frame
  pivot: Vec2; // the rotation pivot captured at drag start (marked point, else box center)
  origin: Contour[];
  ids: Set<string>;
  rect: DOMRect; // the SVG's client rect at drag start (client→screen)
  teardown: () => void;
}

/** Current viewport from the store — read fresh so a mid-drag zoom/pan stays exact. */
function liveViewport(): Viewport {
  const s = useViewportStore.getState();
  return { zoom: s.zoom, pan: s.pan };
}

/** AABB over a set of world positions. */
function bboxOf(points: Iterable<Vec2>): BBox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

export function TransformBox({ viewport }: { viewport: Viewport }) {
  const transforming = useEditorStore((s) => s.transforming);
  const selection = useEditorStore((s) => s.selection);
  const glyph = useActiveGlyph();
  const live = useEditorStore((s) => s.liveContours);
  const drag = useRef<Drag | null>(null);
  // The rotation pivot (a "marked point"); null = the box center (default). World coords.
  const [pivot, setPivot] = useState<Vec2 | null>(null);
  // Live rotation, set only during a rotate drag, so the displayed box can rotate
  // RIGIDLY (the committed box turned by `angle` about `pivot`) instead of warping
  // as the AABB of the rotating points. null = not rotating (use the AABB box).
  const [rotateView, setRotateView] = useState<{ angle: number; pivot: Vec2; bbox: BBox } | null>(null);
  // The marked point is relative to THIS selection/box, so drop it when the box closes
  // or the selection changes (back to center).
  useEffect(() => {
    if (!transforming) {
      setPivot(null);
      setRotateView(null);
    }
  }, [transforming]);
  useEffect(() => setPivot(null), [selection]);

  // Committed snapshot: the contours to edit (unlocked layers) + each selected
  // anchor's document position. Used to seed a drag and as the box fallback.
  const data = useMemo(() => {
    if (!glyph || selection.length === 0) return null;
    const ids = new Set(selection.map((r) => r.pointId));
    const origin: Contour[] = [];
    const posById = new Map<string, Vec2>();
    for (const layer of resolvedLayers(glyph)) {
      for (const c of layer.contours) {
        let touched = false;
        for (const p of c.points) {
          if (!ids.has(p.id)) continue;
          touched = true;
          posById.set(p.id, { x: p.x, y: p.y });
        }
        if (touched && !layer.locked) origin.push(c);
      }
    }
    if (posById.size === 0) return null;
    return { origin, ids, posById };
  }, [glyph, selection]);

  // Displayed box: tracks the LIVE preview while dragging (so handles stay under the
  // cursor), falling back to committed positions when idle.
  const bbox = useMemo<BBox | null>(() => {
    if (!data) return null;
    const livePos = new Map<string, Vec2>();
    if (live) {
      for (const c of live) {
        for (const p of c.points) if (data.ids.has(p.id)) livePos.set(p.id, { x: p.x, y: p.y });
      }
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of data.ids) {
      const p = livePos.get(id) ?? data.posById.get(id);
      if (!p) continue;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
  }, [data, live]);

  // Esc cancels, Enter commits — both just exit; handled here (capture) so the tool
  // controller's Esc/Enter (which would clear the selection) never fires. Skip while a
  // text field is focused (e.g. a layer rename) so it keeps its own Enter/Esc.
  useEffect(() => {
    if (!transforming) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      if (e.key !== "Escape" && e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
      const editor = useEditorStore.getState();
      if (e.key === "Escape") editor.setLiveContours(null); // drop any in-flight preview
      editor.setTransforming(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [transforming]);

  // Exit cleanly when the box closes (transforming off) or unmounts mid-drag: tear
  // down any live drag listeners and drop a lingering preview.
  useEffect(() => {
    if (transforming) return;
    drag.current?.teardown?.();
    drag.current = null;
    if (useEditorStore.getState().liveContours) useEditorStore.getState().setLiveContours(null);
  }, [transforming]);

  useEffect(
    () => () => {
      drag.current?.teardown?.();
      drag.current = null;
    },
    [],
  );

  // Auto-exit if the selection is emptied while open (e.g. Delete), so the box
  // doesn't silently reappear on the next selection.
  useEffect(() => {
    if (transforming && selection.length === 0) useEditorStore.getState().setTransforming(false);
  }, [transforming, selection]);

  if (!transforming || !data || !bbox) return null;

  const toScreen = (p: Vec2) => worldToScreen(p, viewport);
  const matrixFor = (d: Drag, cur: Vec2, shift: boolean): Matrix => {
    if (d.kind === "move") return translate(cur.x - d.start.x, cur.y - d.start.y);
    if (d.kind === "pivot") return IDENTITY; // pivot drag never transforms (handled in onMove)
    if (d.kind === "rotate") {
      const c = d.pivot; // the marked pivot (else the box center)
      let delta = Math.atan2(cur.y - c.y, cur.x - c.x) - Math.atan2(d.start.y - c.y, d.start.x - c.x);
      if (shift) delta = Math.round(delta / (Math.PI / 12)) * (Math.PI / 12); // 15° snap
      return rotateAbout(delta, c);
    }
    const pivot = pointOf(OPPOSITE[d.kind], d.bbox);
    let sx = AFFECTS_X.has(d.kind) ? safeDiv(cur.x - pivot.x, d.start.x - pivot.x) : 1;
    let sy = AFFECTS_Y.has(d.kind) ? safeDiv(cur.y - pivot.y, d.start.y - pivot.y) : 1;
    if (shift && AFFECTS_X.has(d.kind) && AFFECTS_Y.has(d.kind)) {
      const s = Math.abs(sx) > Math.abs(sy) ? sx : sy; // uniform from the larger axis
      sx = s;
      sy = s;
    }
    return scaleAbout(sx, sy, pivot);
  };

  const begin = (kind: HandleKind) => (e: ReactPointerEvent<SVGElement>) => {
    if (e.button !== 0 || !data) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
    const committed = bboxOf(data.posById.values());
    if (!rect || !committed) return;
    const start = screenToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top }, liveViewport());

    const onMove = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const cur = screenToWorld({ x: ev.clientX - d.rect.left, y: ev.clientY - d.rect.top }, liveViewport());
      // The pivot drag just relocates the marked point — no geometry change/preview.
      if (d.kind === "pivot") {
        setPivot(cur);
        return;
      }
      // Capture the live rotation angle so the box can be drawn rigidly rotated
      // (matrixFor recomputes the same delta for the actual geometry below).
      if (d.kind === "rotate") {
        const c = d.pivot;
        let delta =
          Math.atan2(cur.y - c.y, cur.x - c.x) - Math.atan2(d.start.y - c.y, d.start.x - c.x);
        if (ev.shiftKey) delta = Math.round(delta / (Math.PI / 12)) * (Math.PI / 12);
        setRotateView({ angle: delta, pivot: c, bbox: d.bbox });
      }
      useEditorStore.getState().setLiveContours(
        transformSelected(d.origin, d.ids, matrixFor(d, cur, ev.shiftKey)),
      );
    };
    const onUp = () => {
      // Moving the pivot is not an undo step (no geometry changed); just stop the drag.
      if (drag.current?.kind !== "pivot") {
        const liveNow = useEditorStore.getState().liveContours;
        if (liveNow) useDocumentStore.getState().replaceContoursEverywhere(liveNow);
        useEditorStore.getState().setLiveContours(null);
      }
      setRotateView(null); // back to the AABB box now the rotation is committed
      drag.current?.teardown();
      drag.current = null;
    };
    const teardown = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    drag.current = {
      kind,
      start,
      bbox: committed,
      pivot: pivot ?? pointOf("center", committed),
      origin: data.origin,
      ids: data.ids,
      rect,
      teardown,
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Screen geometry. The four box corners come from the committed box rotated by the
  // live angle while rotating (so the box turns rigidly), else from the live AABB.
  const corner = (k: "nw" | "ne" | "se" | "sw"): Vec2 =>
    rotateView
      ? apply(rotateAbout(rotateView.angle, rotateView.pivot), pointOf(k, rotateView.bbox))
      : pointOf(k, bbox);
  const nw = toScreen(corner("nw"));
  const ne = toScreen(corner("ne"));
  const se = toScreen(corner("se"));
  const sw = toScreen(corner("sw"));
  const midpoint = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  // Edge-midpoint handles, so the 8 scale handles ride the rotated edges too.
  const nMid = midpoint(nw, ne);
  const handlePt: Record<ScaleKind, Vec2> = {
    nw, ne, se, sw,
    n: nMid,
    e: midpoint(ne, se),
    s: midpoint(se, sw),
    w: midpoint(sw, nw),
  };
  // Rotate handle: offset from the top-edge midpoint along the edge's OUTWARD normal,
  // so the stem stays perpendicular to the (possibly rotated) top edge.
  const boxCenter = { x: (nw.x + ne.x + se.x + sw.x) / 4, y: (nw.y + ne.y + se.y + sw.y) / 4 };
  let nx = -(ne.y - nw.y);
  let ny = ne.x - nw.x;
  const nlen = Math.hypot(nx, ny) || 1;
  nx /= nlen;
  ny /= nlen;
  if ((nMid.x - boxCenter.x) * nx + (nMid.y - boxCenter.y) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const rot = { x: nMid.x + nx * ROTATE_OFFSET_PX, y: nMid.y + ny * ROTATE_OFFSET_PX };
  const outline = `${nw.x},${nw.y} ${ne.x},${ne.y} ${se.x},${se.y} ${sw.x},${sw.y}`;
  // The rotation pivot marker (a marked point; defaults to the box center).
  const pivotS = toScreen(pivot ?? pointOf("center", bbox));

  return (
    <g className="transform-box">
      <line className="transform-rotate-stem" x1={nMid.x} y1={nMid.y} x2={rot.x} y2={rot.y} />
      {/* The border is the move affordance (pointer-events on the stroke only). */}
      <polygon
        className="transform-outline"
        points={outline}
        onPointerDown={begin("move")}
        style={{ cursor: "move" }}
      />
      <circle
        className="transform-handle transform-rotate"
        cx={rot.x}
        cy={rot.y}
        r={5}
        onPointerDown={begin("rotate")}
        style={{ cursor: "grab" }}
      />
      {SCALE_HANDLES.map((kind) => {
        const s = handlePt[kind];
        return (
          <rect
            key={kind}
            className="transform-handle"
            x={s.x - 4}
            y={s.y - 4}
            width={8}
            height={8}
            onPointerDown={begin(kind)}
            style={{ cursor: CURSOR[kind] }}
          />
        );
      })}
      {/* The rotation pivot: drag to mark a point to rotate around; double-click resets
          it to the box center. Rendered last so it sits above the handles. */}
      <g
        className="transform-pivot"
        onPointerDown={begin("pivot")}
        onDoubleClick={() => setPivot(null)}
        style={{ cursor: "grab" }}
      >
        <circle className="transform-pivot-ring" cx={pivotS.x} cy={pivotS.y} r={6} />
        <circle className="transform-pivot-dot" cx={pivotS.x} cy={pivotS.y} r={1.5} />
      </g>
    </g>
  );
}
