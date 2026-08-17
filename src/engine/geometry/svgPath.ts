import type { AnchorPoint } from "../../types/geometry";
import type { Vec2 } from "../../types/viewport";
import { createId } from "../../utils/id";

/**
 * Pure SVG path-`d` parser → our `AnchorPoint` contours (cubic beziers, handles in
 * ABSOLUTE coords). No DOM, no transforms, no Y-flip (the caller applies those).
 * Supports the full command set: M/L/H/V/C/S/Q/T/A/Z and their relative (lowercase)
 * forms; quadratics (Q/T) are exact-converted to cubics and arcs (A) are split into
 * ≤90° cubic segments. One subpath per moveto; `closed` is set by Z.
 */

export interface ParsedSubpath {
  points: AnchorPoint[];
  closed: boolean;
}

const TOKEN = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?)/g;

type Token = { cmd: string } | { num: number };

function tokenize(d: string): Token[] {
  const out: Token[] = [];
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(d))) {
    if (m[1]) out.push({ cmd: m[1] });
    else if (m[2]) out.push({ num: parseFloat(m[2]) });
  }
  return out;
}

function anchor(p: Vec2, handleIn?: Vec2, handleOut?: Vec2): AnchorPoint {
  const a: AnchorPoint = {
    id: createId("pt"),
    type: handleIn || handleOut ? "smooth" : "corner",
    x: p.x,
    y: p.y,
  };
  if (handleIn) a.handleIn = handleIn;
  if (handleOut) a.handleOut = handleOut;
  return a;
}

/** Quadratic (P0, Qc, P1) → cubic control points (exact). */
function quadToCubicControls(p0: Vec2, qc: Vec2, p1: Vec2): { c1: Vec2; c2: Vec2 } {
  return {
    c1: { x: p0.x + (2 / 3) * (qc.x - p0.x), y: p0.y + (2 / 3) * (qc.y - p0.y) },
    c2: { x: p1.x + (2 / 3) * (qc.x - p1.x), y: p1.y + (2 / 3) * (qc.y - p1.y) },
  };
}

/** Endpoint-parameterized SVG arc → a list of cubic segments {c1,c2,end}. */
function arcToCubics(
  p0: Vec2,
  rxIn: number,
  ryIn: number,
  xRotDeg: number,
  largeArc: boolean,
  sweep: boolean,
  p1: Vec2,
): { c1: Vec2; c2: Vec2; end: Vec2 }[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || (p0.x === p1.x && p0.y === p1.y)) {
    return [{ c1: p0, c2: p1, end: p1 }]; // degenerate → straight (as a cubic)
  }
  const phi = (xRotDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  // Step 1: transform to the ellipse's coordinate frame.
  const dx = (p0.x - p1.x) / 2;
  const dy = (p0.y - p1.y) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;
  // Correct out-of-range radii.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  // Step 2: center.
  const sign = largeArc === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * (rx * y1p)) / ry;
  const cyp = (co * -(ry * x1p)) / rx;
  const cx = cosP * cxp - sinP * cyp + (p0.x + p1.x) / 2;
  const cy = sinP * cxp + cosP * cyp + (p0.y + p1.y) / 2;
  // Step 3: start angle + sweep angle.
  const ang = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    if (len === 0) return 0; // degenerate vector → no angle (guards acos(NaN))
    let a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
  // Step 4: split into ≤90° segments and emit cubics.
  const segs = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
  const delta = dTheta / segs;
  const t = (4 / 3) * Math.tan(delta / 4);
  const out: { c1: Vec2; c2: Vec2; end: Vec2 }[] = [];
  const onEllipse = (a: number): Vec2 => ({
    x: cx + rx * Math.cos(a) * cosP - ry * Math.sin(a) * sinP,
    y: cy + rx * Math.cos(a) * sinP + ry * Math.sin(a) * cosP,
  });
  const deriv = (a: number): Vec2 => ({
    x: -rx * Math.sin(a) * cosP - ry * Math.cos(a) * sinP,
    y: -rx * Math.sin(a) * sinP + ry * Math.cos(a) * cosP,
  });
  let a0 = theta1;
  let pt0 = onEllipse(a0);
  for (let i = 0; i < segs; i += 1) {
    const a1 = a0 + delta;
    const pt1 = i === segs - 1 ? p1 : onEllipse(a1);
    const d0 = deriv(a0);
    const d1 = deriv(a1);
    out.push({
      c1: { x: pt0.x + t * d0.x, y: pt0.y + t * d0.y },
      c2: { x: pt1.x - t * d1.x, y: pt1.y - t * d1.y },
      end: pt1,
    });
    a0 = a1;
    pt0 = pt1;
  }
  return out;
}

export function parsePathD(d: string): ParsedSubpath[] {
  const toks = tokenize(d);
  const subs: ParsedSubpath[] = [];
  let cur: AnchorPoint[] | null = null;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let prevCtrl: Vec2 | null = null; // for S/T reflection
  let prevCmd = "";

  let i = 0;
  const num = (): number => {
    const t = toks[i];
    if (t && "num" in t) {
      i += 1;
      return t.num;
    }
    return 0;
  };
  const hasNum = (): boolean => {
    const t = toks[i];
    return !!t && "num" in t;
  };
  const last = (): AnchorPoint => cur![cur!.length - 1]!;
  const startSub = (p: Vec2) => {
    if (cur && cur.length > 0) subs.push({ points: cur, closed: false });
    cur = [anchor(p)];
  };
  const lineTo = (p: Vec2) => {
    cur!.push(anchor(p));
    cx = p.x;
    cy = p.y;
  };
  const cubicTo = (c1: Vec2, c2: Vec2, end: Vec2) => {
    last().handleOut = c1;
    last().type = "smooth";
    cur!.push(anchor(end, c2));
    cx = end.x;
    cy = end.y;
    prevCtrl = c2;
  };

  while (i < toks.length) {
    const t = toks[i];
    if (!t || !("cmd" in t)) {
      i += 1;
      continue;
    }
    const cmd = t.cmd;
    i += 1;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();

    if (C === "Z") {
      if (cur && (cur as AnchorPoint[]).length > 0) {
        subs.push({ points: cur, closed: true });
        cur = null;
      }
      cx = sx;
      cy = sy;
      prevCtrl = null;
      prevCmd = "Z";
      continue;
    }

    // The parameter loop: repeat the command for each extra coordinate group.
    let first = true;
    while (hasNum()) {
      switch (C) {
        case "M": {
          const x = num() + (rel ? cx : 0);
          const y = num() + (rel ? cy : 0);
          cx = x;
          cy = y;
          if (first) {
            sx = x;
            sy = y;
            startSub({ x, y });
          } else {
            lineTo({ x, y }); // subsequent pairs after M are implicit L
          }
          prevCtrl = null;
          break;
        }
        case "L": {
          const x = num() + (rel ? cx : 0);
          const y = num() + (rel ? cy : 0);
          lineTo({ x, y });
          prevCtrl = null;
          break;
        }
        case "H": {
          const x = num() + (rel ? cx : 0);
          lineTo({ x, y: cy });
          prevCtrl = null;
          break;
        }
        case "V": {
          const y = num() + (rel ? cy : 0);
          lineTo({ x: cx, y });
          prevCtrl = null;
          break;
        }
        case "C": {
          const c1 = { x: num() + (rel ? cx : 0), y: num() + (rel ? cy : 0) };
          const c2 = { x: num() + (rel ? cx : 0), y: num() + (rel ? cy : 0) };
          const end = { x: num() + (rel ? cx : 0), y: num() + (rel ? cy : 0) };
          cubicTo(c1, c2, end);
          break;
        }
        case "S": {
          const reflect =
            prevCmd === "C" || prevCmd === "S"
              ? { x: 2 * cx - prevCtrl!.x, y: 2 * cy - prevCtrl!.y }
              : { x: cx, y: cy };
          const c2 = { x: num() + (rel ? cx : 0), y: num() + (rel ? cy : 0) };
          const end = { x: num() + (rel ? cx : 0), y: num() + (rel ? cy : 0) };
          cubicTo(reflect, c2, end);
          break;
        }
        case "Q": {
          const qc = { x: num() + (rel ? cx : 0), y: num() + (rel ? cy : 0) };
          const end = { x: num() + (rel ? cx : 0), y: num() + (rel ? cy : 0) };
          const { c1, c2 } = quadToCubicControls({ x: cx, y: cy }, qc, end);
          cubicTo(c1, c2, end);
          prevCtrl = qc; // T reflects the QUADRATIC control
          break;
        }
        case "T": {
          const qc: Vec2 =
            prevCmd === "Q" || prevCmd === "T"
              ? { x: 2 * cx - prevCtrl!.x, y: 2 * cy - prevCtrl!.y }
              : { x: cx, y: cy };
          const end = { x: num() + (rel ? cx : 0), y: num() + (rel ? cy : 0) };
          const { c1, c2 } = quadToCubicControls({ x: cx, y: cy }, qc, end);
          cubicTo(c1, c2, end);
          prevCtrl = qc;
          break;
        }
        case "A": {
          const rx = num();
          const ry = num();
          const rot = num();
          const large = num() !== 0;
          const sweep = num() !== 0;
          const end = { x: num() + (rel ? cx : 0), y: num() + (rel ? cy : 0) };
          for (const seg of arcToCubics({ x: cx, y: cy }, rx, ry, rot, large, sweep, end)) {
            cubicTo(seg.c1, seg.c2, seg.end);
          }
          prevCtrl = null;
          break;
        }
        default:
          i = toks.length; // unknown command → stop safely
      }
      first = false;
    }
    prevCmd = C;
  }

  if (cur && (cur as AnchorPoint[]).length > 0) subs.push({ points: cur, closed: false });
  // Drop subpaths that are a single point (no drawable segment).
  return subs.filter((s) => s.points.length >= 2);
}
