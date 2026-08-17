import type { Contour } from "../../types/geometry";
import { createId } from "../../utils/id";
import {
  almostEqual,
  flattenContour,
  insideNonzero,
  lerp,
  ptKey,
  quantize,
  ringSignedArea,
  segmentIntersection,
  simplifyClosed,
  type Pt,
} from "./polygon";
import { correctWinding } from "./winding";

/**
 * Boolean clipping by planar arrangement, parameterised on a region predicate
 * (inA, inB) → keep. The pipeline:
 *   1. normalize each operand's winding so nonzero inside-tests are valid even
 *      with overlapping pieces or holes;
 *   2. flatten everything to segments and split them at every mutual crossing;
 *   3. for each sub-segment, sample the predicate just off each side — an edge
 *      is on the result boundary iff the two sides disagree — and orient it so
 *      the kept region lies on its left;
 *   4. stitch the kept directed edges into closed rings;
 *   5. simplify, drop slivers, and re-normalize winding.
 *
 * Operands are flattened, so results are high-resolution polygons (curves
 * become dense polylines) — the deliberate trade-off of a Paper-free engine.
 * The operation is a single undo step, so the original curve contours are
 * always recoverable, and swapping in Paper.js (same interface) restores exact
 * curve booleans.
 */

type Predicate = (inA: boolean, inB: boolean) => boolean;

interface Seg {
  a: Pt;
  b: Pt;
}

const SIMPLIFY_TOL = 0.6; // font units
const AREA_MIN = 1.0; // drop slivers below this absolute area
const SAMPLE_OFFSET = 0.05; // how far off an edge to sample the predicate
const T_EPS = 1e-7;

function buildSegments(polys: Pt[][]): Seg[] {
  const segs: Seg[] = [];
  for (const poly of polys) {
    const n = poly.length;
    for (let i = 0; i < n; i += 1) {
      const a = quantize(poly[i]!);
      const b = quantize(poly[(i + 1) % n]!);
      if (!almostEqual(a, b)) segs.push({ a, b });
    }
  }
  return segs;
}

/** Split every segment at its crossings with all others (O(n²); fine here). */
function splitSegments(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i < segs.length; i += 1) {
    const s = segs[i]!;
    const ts: number[] = [0, 1];
    for (let j = 0; j < segs.length; j += 1) {
      if (i === j) continue;
      const o = segs[j]!;
      const hit = segmentIntersection(s.a, s.b, o.a, o.b);
      if (hit && hit.t > T_EPS && hit.t < 1 - T_EPS) ts.push(hit.t);
    }
    ts.sort((x, y) => x - y);
    let prev = Number.NEGATIVE_INFINITY;
    const uniq: number[] = [];
    for (const t of ts) {
      if (t - prev > T_EPS) {
        uniq.push(t);
        prev = t;
      }
    }
    for (let k = 0; k < uniq.length - 1; k += 1) {
      const a = quantize(lerp(s.a, s.b, uniq[k]!));
      const b = quantize(lerp(s.a, s.b, uniq[k + 1]!));
      if (!almostEqual(a, b)) out.push({ a, b });
    }
  }
  return out;
}

function classify(
  subSegs: Seg[],
  aPolys: Pt[][],
  bPolys: Pt[][],
  predicate: Predicate,
): Seg[] {
  const directed: Seg[] = [];
  for (const s of subSegs) {
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const mx = (s.a.x + s.b.x) / 2;
    const my = (s.a.y + s.b.y) / 2;
    const nx = -dy / len; // unit left normal
    const ny = dx / len;
    const left: Pt = { x: mx + nx * SAMPLE_OFFSET, y: my + ny * SAMPLE_OFFSET };
    const right: Pt = { x: mx - nx * SAMPLE_OFFSET, y: my - ny * SAMPLE_OFFSET };
    const li = predicate(insideNonzero(left, aPolys), insideNonzero(left, bPolys));
    const ri = predicate(insideNonzero(right, aPolys), insideNonzero(right, bPolys));
    if (li === ri) continue; // not a boundary edge
    if (li) directed.push({ a: s.a, b: s.b }); // interior on the left → keep
    else directed.push({ a: s.b, b: s.a }); // flip so interior is on the left
  }
  return directed;
}

/** Walk kept edges into closed rings, turning to keep the interior on the left. */
function stitch(directed: Seg[]): Pt[][] {
  const byStart = new Map<string, number[]>();
  directed.forEach((e, idx) => {
    const k = ptKey(e.a);
    const list = byStart.get(k);
    if (list) list.push(idx);
    else byStart.set(k, [idx]);
  });

  const used = new Array<boolean>(directed.length).fill(false);
  const rings: Pt[][] = [];

  for (let start = 0; start < directed.length; start += 1) {
    if (used[start]) continue;
    const ring: Pt[] = [];
    let curr = start;
    let guard = 0;
    while (curr >= 0 && !used[curr] && guard <= directed.length + 4) {
      guard += 1;
      used[curr] = true;
      const e = directed[curr]!;
      ring.push(e.a);
      const cands = byStart.get(ptKey(e.b)) ?? [];
      const inDir = Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x);
      let next = -1;
      let best = Number.POSITIVE_INFINITY;
      for (const c of cands) {
        if (used[c]) continue;
        const ce = directed[c]!;
        const outDir = Math.atan2(ce.b.y - ce.a.y, ce.b.x - ce.a.x);
        let turn = inDir - outDir;
        turn = ((turn % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        if (turn < best) {
          best = turn;
          next = c;
        }
      }
      if (next === start) break;
      curr = next;
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

function ringToContour(ring: Pt[]): Contour {
  return {
    id: createId("ct"),
    closed: true,
    points: ring.map((p) => ({
      id: createId("pt"),
      type: "corner" as const,
      x: p.x,
      y: p.y,
    })),
  };
}

export function clip(a: Contour[], b: Contour[], predicate: Predicate): Contour[] {
  const aPolys = correctWinding(a).map(flattenContour);
  const bPolys = correctWinding(b).map(flattenContour);
  if (aPolys.length === 0 && bPolys.length === 0) return [];

  const segs = buildSegments([...aPolys, ...bPolys]);
  const directed = classify(splitSegments(segs), aPolys, bPolys, predicate);
  const rings = stitch(directed);

  const contours = rings
    .map((r) => simplifyClosed(r, SIMPLIFY_TOL))
    .filter((r) => r.length >= 3 && Math.abs(ringSignedArea(r)) >= AREA_MIN)
    .map(ringToContour);

  return correctWinding(contours);
}
