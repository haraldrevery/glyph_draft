import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Toggle } from "../../components/controls/Toggle";
import { ContextMenu, useContextMenu } from "../../components/menu/ContextMenu";
import { evalProfile } from "../../engine/geometry/profile";
import type { ProfilePoint } from "../../types/geometry";

/**
 * The stroke-PROFILE graph editor: the user shapes a smooth curve over the length
 * of the path (X = 0 at the start node → 1 at the end node), Y = a value (a width
 * multiplier or a nib angle). Control points: DRAG to move, click empty space to
 * ADD, DOUBLE-TAP a node to reset it to the vertical center (100 % / 0°), RIGHT-CLICK
 * a node for a menu (Delete — interior only — or Set exact value…), RIGHT-CLICK the
 * background to Reset the whole profile. The smooth curve is the exact `evalProfile`
 * the engine renders, so what you draw is what you get.
 *
 * A point DRAG previews in local state and commits once on pointer-up (one undo
 * step); other edits commit immediately. `loop` keeps the two endpoints' Y equal so
 * the profile wraps seamlessly (closed paths); reset / set-value mirror it too.
 *
 * Values are STORED as the engine units (a 0–2 multiplier for width, degrees for
 * angle) but shown/typed in display units via `unit` + `displayScale`.
 */

interface Props {
  points: ProfilePoint[];
  loop: boolean;
  yMin: number;
  yMax: number;
  /** The reference line drawn across the graph (1 for width = 100 %, 0 for angle). */
  baseline: number;
  /** Display unit suffix ("%", "°") and stored→display scale (100 for width, 1 for °). */
  unit: string;
  displayScale: number;
  onChange: (points: ProfilePoint[]) => void;
  onLoopChange: (loop: boolean) => void;
}

const W0 = 220; // initial viewBox width before the element is measured
const H = 110;
const PAD = 10;
const EPS = 1e-3;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function GraphEditor({
  points,
  loop,
  yMin,
  yMax,
  baseline,
  unit,
  displayScale,
  onChange,
  onLoopChange,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [draft, setDraft] = useState<ProfilePoint[] | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  // The viewBox width tracks the element's measured pixel width, so the graph maps
  // 1:1 to pixels — no horizontal stretch when the panel is resized off the default.
  const [vw, setVw] = useState(W0);
  const lastDown = useRef<{ idx: number; t: number }>({ idx: -1, t: 0 });
  const { menu, open, close } = useContextMenu();
  const pts = draft ?? points;

  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setVw(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const isEndpoint = (i: number) => i === 0 || i === points.length - 1;

  const toSvg = (p: ProfilePoint) => ({
    x: PAD + p.x * (vw - 2 * PAD),
    y: H - PAD - ((p.y - yMin) / (yMax - yMin)) * (H - 2 * PAD),
  });
  const fromSvg = (sx: number, sy: number): ProfilePoint => ({
    x: clamp((sx - PAD) / (vw - 2 * PAD), 0, 1),
    y: clamp(yMin + (1 - (sy - PAD) / (H - 2 * PAD)) * (yMax - yMin), yMin, yMax),
  });
  const localCoords = (e: ReactPointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      sx: ((e.clientX - rect.left) / rect.width) * vw,
      sy: ((e.clientY - rect.top) / rect.height) * H,
    };
  };

  /** Set point `i`'s Y (mirroring the other endpoint when looping) and commit. */
  const setPointY = (i: number, y: number) => {
    const value = clamp(y, yMin, yMax);
    const arr = points.map((p) => ({ ...p }));
    arr[i] = { ...arr[i]!, y: value };
    if (loop && isEndpoint(i)) {
      arr[0] = { ...arr[0]!, y: value };
      arr[arr.length - 1] = { ...arr[arr.length - 1]!, y: value };
    }
    onChange(arr);
  };

  const removeAt = (i: number) => {
    if (isEndpoint(i)) return; // the two endpoints always stay
    onChange(points.filter((_, j) => j !== i));
  };

  const startDrag = (i: number) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return; // primary button only (right-click → context menu)
    e.stopPropagation();
    e.preventDefault();
    // Double-tap a node → reset it to the vertical center (100 % / 0°). Detected here
    // (not via the DOM `dblclick`, which fights pointer-capture / preventDefault).
    const now = e.timeStamp || Date.now();
    if (lastDown.current.idx === i && now - lastDown.current.t < 350) {
      lastDown.current = { idx: -1, t: 0 };
      setPointY(i, (yMin + yMax) / 2);
      return;
    }
    lastDown.current = { idx: i, t: now };
    svgRef.current?.setPointerCapture(e.pointerId);
    setDraft(points.map((p) => ({ ...p })));
    setDragIdx(i);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (dragIdx == null || !draft) return;
    const { sx, sy } = localCoords(e);
    const np = fromSvg(sx, sy);
    const last = draft.length - 1;
    const isEnd = dragIdx === 0 || dragIdx === last;
    const x = isEnd
      ? draft[dragIdx]!.x
      : clamp(np.x, draft[dragIdx - 1]!.x + EPS, draft[dragIdx + 1]!.x - EPS);
    const arr = draft.map((p) => ({ ...p }));
    arr[dragIdx] = { x, y: np.y };
    if (loop && isEnd) {
      arr[0] = { ...arr[0]!, y: np.y };
      arr[last] = { ...arr[last]!, y: np.y };
    }
    setDraft(arr);
  };

  const endDrag = () => {
    // Commit only a real move, so a plain click (or the first tap of a double-tap)
    // doesn't spam a no-op undo step or re-render between the two taps.
    if (draft && draft.some((p, i) => !points[i] || p.x !== points[i]!.x || p.y !== points[i]!.y)) {
      onChange(draft);
    }
    setDraft(null);
    setDragIdx(null);
  };

  const addPoint = (e: ReactPointerEvent) => {
    if (e.button !== 0 || dragIdx != null) return;
    const { sx, sy } = localCoords(e);
    const np = fromSvg(sx, sy);
    const arr = points.map((p) => ({ ...p }));
    let idx = arr.findIndex((p) => p.x > np.x);
    if (idx <= 0) idx = 1; // never before/at the first endpoint
    arr.splice(idx, 0, np);
    onChange(arr);
  };

  const openMenu = (i: number) => (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    open(e.clientX, e.clientY, [
      {
        label: "Set exact value…",
        onSelect: () => {
          setEditText(String(Math.round(points[i]!.y * displayScale)));
          setEditIdx(i);
        },
      },
      { label: "Delete node", onSelect: () => removeAt(i), disabled: isEndpoint(i) },
    ]);
  };

  const commitEdit = () => {
    if (editIdx == null) return;
    const parsed = Number(editText);
    if (!Number.isNaN(parsed) && editText.trim() !== "") setPointY(editIdx, parsed / displayScale);
    setEditIdx(null);
  };

  // Reset the whole profile to a flat baseline (100 % / 0°) — the graph's right-click.
  const resetProfile = (e: ReactMouseEvent) => {
    e.preventDefault();
    open(e.clientX, e.clientY, [
      {
        label: "Reset profile",
        onSelect: () => onChange([{ x: 0, y: baseline }, { x: 1, y: baseline }]),
      },
    ]);
  };

  // The smooth curve = the exact engine evaluation. Sample a dense grid PLUS every
  // control point's x, so the drawn polyline passes exactly through each node.
  const profile = { points: pts, loop };
  const xs = Array.from(new Set([...Array.from({ length: 81 }, (_, k) => k / 80), ...pts.map((p) => p.x)])).sort(
    (a, b) => a - b,
  );
  const curve = xs
    .map((t, i) => {
      const s = toSvg({ x: t, y: evalProfile(profile, t) });
      return `${i === 0 ? "M" : "L"}${s.x.toFixed(1)},${s.y.toFixed(1)}`;
    })
    .join(" ");
  const baseY = toSvg({ x: 0, y: baseline }).y;
  const fmt = (y: number) => `${Math.round(y * displayScale)}${unit}`;

  return (
    <div className="graph-editor">
      <svg
        ref={svgRef}
        className="graph-svg"
        viewBox={`0 0 ${vw} ${H}`}
        preserveAspectRatio="none"
        onPointerDown={addPoint}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onContextMenu={resetProfile}
      >
        <rect className="graph-bg" x={0} y={0} width={vw} height={H} rx={4} />
        <line className="graph-baseline" x1={PAD} y1={baseY} x2={vw - PAD} y2={baseY} />
        <path className="graph-curve" d={curve} />
        {pts.map((p, i) => {
          const s = toSvg(p);
          return (
            <circle
              key={i}
              className="graph-pt"
              cx={s.x}
              cy={s.y}
              r={4.5}
              onPointerDown={startDrag(i)}
              onContextMenu={openMenu(i)}
            />
          );
        })}
      </svg>

      {editIdx != null && (
        <div className="graph-edit-row">
          <span className="graph-readout">Value</span>
          <input
            className="number-input-field"
            type="number"
            autoFocus
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") setEditIdx(null);
            }}
          />
          <span className="graph-readout">{unit}</span>
        </div>
      )}

      <div className="graph-row">
        <Toggle label="Loop (seamless)" checked={loop} onChange={onLoopChange} />
        <span className="graph-readout">
          {fmt(yMax)} … {fmt(yMin)}
        </span>
      </div>

      <ContextMenu menu={menu} onClose={close} />
    </div>
  );
}
