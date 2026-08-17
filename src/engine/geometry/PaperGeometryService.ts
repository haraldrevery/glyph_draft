import paper from "paper";
import {
  DEFAULT_CONTRAST,
  DEFAULT_SERIF,
  DEFAULT_DROP,
  DEFAULT_RECT,
  DEFAULT_HALFTONE,
  DEFAULT_DASH,
  type AnchorPoint,
  type Contour,
  type DashStyle,
  type HalftoneShape,
  type HalftoneStyle,
  type RectCapStyle,
  type StrokeCap,
  type StrokeJoin,
  type StrokeStyle,
} from "../../types/geometry";
import type { Vec2 } from "../../types/viewport";
import type { GeometryService } from "./GeometryService";
import { correctWinding } from "./winding";
import { evalProfile } from "./profile";
import { createId } from "../../utils/id";

/**
 * The curve-preserving GeometryService, backed by Paper.js. Honours exactly the
 * same plain-Contour-in / plain-Contour-out contract as PolygonGeometryService,
 * so the two are interchangeable behind getGeometryService() — the difference is
 * that Paper computes real bezier booleans, so curves survive (no flattening).
 *
 * Coordinates are passed through verbatim in our Y-up world space. Paper's own
 * notion of "clockwise" assumes Y-down, so we never rely on it: we feed world
 * coordinates in, read world coordinates back, and run our own winding.ts
 * correctWinding() on the output to get the FontForge convention (outer CW,
 * holes CCW) — identical to the polygon engine.
 *
 * A single headless PaperScope is set up once with `insertItems = false`, so
 * created paths never join a scene graph (no canvas/view needed); we only read
 * their segments back out. This keeps the engine free of DOM/render concerns.
 */

const scope = new paper.PaperScope();
scope.setup(new scope.Size(1, 1));
scope.settings.insertItems = false;

const HANDLE_EPS = 1e-6;

/** One Contour → a Paper Path (segments carry handles RELATIVE to the anchor). */
function toPath(contour: Contour): paper.Path {
  const segments = contour.points.map((p) => {
    const point = new scope.Point(p.x, p.y);
    const hIn = p.handleIn
      ? new scope.Point(p.handleIn.x - p.x, p.handleIn.y - p.y)
      : undefined;
    const hOut = p.handleOut
      ? new scope.Point(p.handleOut.x - p.x, p.handleOut.y - p.y)
      : undefined;
    return new scope.Segment(point, hIn, hOut);
  });
  const path = new scope.Path(segments);
  path.closed = contour.closed;
  return path;
}

/**
 * Resolve a set of contours into ONE clean region by uniting them — this is the
 * "full render first" step: a layer with several overlapping sub-shapes becomes
 * a single non-self-intersecting compound before any pair operation runs, which
 * is what keeps complex layers from glitching. Returns null for an empty set.
 */
function resolve(contours: Contour[]): paper.PathItem | null {
  const closed = contours.filter((c) => c.closed && c.points.length >= 2);
  if (closed.length === 0) return null;
  let acc: paper.PathItem = toPath(closed[0]!);
  for (let i = 1; i < closed.length; i += 1) {
    acc = acc.unite(toPath(closed[i]!));
  }
  return acc;
}

/** A Paper Point that is effectively zero-length (no real handle). */
function isZero(pt: paper.Point): boolean {
  return Math.abs(pt.x) < HANDLE_EPS && Math.abs(pt.y) < HANDLE_EPS;
}

/** One Paper Path → a Contour (handles converted back to ABSOLUTE coords). */
function pathToContour(path: paper.Path): Contour {
  const points: AnchorPoint[] = path.segments.map((seg) => {
    const x = seg.point.x;
    const y = seg.point.y;
    const hasIn = !isZero(seg.handleIn);
    const hasOut = !isZero(seg.handleOut);
    const ap: AnchorPoint = {
      id: createId("pt"),
      type: hasIn || hasOut ? "smooth" : "corner",
      x,
      y,
    };
    if (hasIn) {
      const v: Vec2 = { x: x + seg.handleIn.x, y: y + seg.handleIn.y };
      ap.handleIn = v;
    }
    if (hasOut) {
      const v: Vec2 = { x: x + seg.handleOut.x, y: y + seg.handleOut.y };
      ap.handleOut = v;
    }
    return ap;
  });
  return { id: createId("ct"), closed: path.closed, points };
}

/** A boolean result (Path or CompoundPath) → plain Contour[]. */
function fromResult(result: paper.PathItem | null): Contour[] {
  if (!result) return [];
  const paths =
    result instanceof scope.CompoundPath
      ? (result.children as paper.Path[])
      : [result as paper.Path];
  return paths
    .filter((p) => p.segments && p.segments.length >= 2)
    .map(pathToContour);
}

/**
 * Dissolve a self-intersecting path into a genuine solid: union it with a clone
 * of itself. A boolean union fills any region the path covers twice (the
 * figure-eight overlap a stroke ribbon makes on a sharp bend) while leaving
 * never-covered area empty — so a legitimate hole (a closed stroke's frame, empty
 * in both operands) survives, but a spurious self-overlap loop does not. Without
 * this the overlap loop nests inside the outline and correctWinding marks it a
 * hole, so the fill reads as an "exclude" under nonzero. Idempotent on an
 * already-unioned path (e.g. the offsetStroke result).
 */
function solidify(item: paper.PathItem): paper.PathItem {
  return item.unite(item.clone(), { insert: false });
}

/**
 * Paper resolves crossings using its own (Y-down) orientation, so a raw result
 * is not in our FontForge convention. We always re-normalize so outer rings run
 * CW and holes CCW under nonzero fill — matching the polygon engine, whose clip()
 * does the same internally.
 */
function normalize(result: paper.PathItem | null): Contour[] {
  return correctWinding(fromResult(result));
}

export class PaperGeometryService implements GeometryService {
  /**
   * Memoize the (pure, expensive) stroke expansion by INPUT IDENTITY. Contours and
   * stroke styles are immutable in this codebase — an edit replaces the contour
   * object rather than mutating it — so a cached entry is valid exactly while the
   * same contour object is requested with the same stroke object. A changed contour
   * is a new object (cache miss), and the WeakMap auto-evicts the old one. The
   * `stroke ===` check keeps the same-contour / different-stroke case correct (it
   * recomputes), which the unit tests rely on.
   */
  private readonly strokeCache = new WeakMap<Contour, { stroke: StrokeStyle; result: Contour[] }>();

  union(a: Contour[], b: Contour[]): Contour[] {
    const pa = resolve(a);
    const pb = resolve(b);
    if (!pa) return normalize(pb);
    if (!pb) return normalize(pa);
    return normalize(pa.unite(pb));
  }

  subtract(a: Contour[], b: Contour[]): Contour[] {
    const pa = resolve(a);
    if (!pa) return [];
    const pb = resolve(b);
    if (!pb) return normalize(pa);
    return normalize(pa.subtract(pb));
  }

  intersect(a: Contour[], b: Contour[]): Contour[] {
    const pa = resolve(a);
    const pb = resolve(b);
    if (!pa || !pb) return [];
    return normalize(pa.intersect(pb));
  }

  exclude(a: Contour[], b: Contour[]): Contour[] {
    const pa = resolve(a);
    const pb = resolve(b);
    if (!pa) return normalize(pb);
    if (!pb) return normalize(pa);
    return normalize(pa.exclude(pb));
  }

  correctWinding(contours: Contour[]): Contour[] {
    return correctWinding(contours);
  }

  expandStroke(contour: Contour, stroke: StrokeStyle): Contour[] {
    const cached = this.strokeCache.get(contour);
    if (cached && cached.stroke === stroke) return cached.result;
    const result = this.expandStrokeImpl(contour, stroke);
    this.strokeCache.set(contour, { stroke, result });
    return result;
  }

  expandHalftoneGroup(contours: Contour[], stroke: StrokeStyle): Contour[] {
    return halftoneGroup(contours, stroke, stroke.halftone ?? DEFAULT_HALFTONE);
  }

  private expandStrokeImpl(contour: Contour, stroke: StrokeStyle): Contour[] {
    if (contour.points.length < 2 || stroke.width <= 0) return [];
    scope.activate(); // PaperOffset / Path factories use the active scope
    const center = toPath(contour);
    const r = stroke.width / 2;
    const limit = stroke.miterLimit ?? 10;

    // EXPERIMENTAL halftone model: returns the screen-tone fill and NEVER falls through
    // to the offset/brush/serif/drop/profile machinery below (full isolation).
    if (stroke.model === "halftone") {
      return halftoneStroke(center, r, stroke, stroke.halftone ?? DEFAULT_HALFTONE);
    }
    // EXPERIMENTAL dash model: breaks the line into dashes/dots along its length. Like
    // halftone, a fully isolated early return — the offset/brush/serif/profile code below
    // is unreachable for it.
    if (stroke.model === "dash") {
      return dashStroke(center, r, stroke, stroke.dash ?? DEFAULT_DASH);
    }

    // An open path's first anchor carries a dangling handleIn and its last anchor a
    // dangling handleOut (the pen mirrors handles on smooth anchors). No DRAWN segment
    // uses them — the body samples the tangent of the FIRST/LAST curve (handleOut of
    // seg0 / handleIn of segN), which these don't touch — so we read them as the
    // user's on-canvas CAP-ANGLE handle (the axis the flat terminal cuts ⟂ to), then
    // zero them on the sampled path so the body itself is unaffected.
    const fp = contour.points[0];
    const lp = contour.points[contour.points.length - 1];
    const startHandleAxis =
      !contour.closed && fp?.handleIn
        ? new scope.Point(fp.handleIn.x - fp.x, fp.handleIn.y - fp.y)
        : null;
    const endHandleAxis =
      !contour.closed && lp?.handleOut
        ? new scope.Point(lp.handleOut.x - lp.x, lp.handleOut.y - lp.y)
        : null;
    const startAxisDeg =
      startHandleAxis && startHandleAxis.length > HANDLE_EPS ? startHandleAxis.angle : null;
    const endAxisDeg =
      endHandleAxis && endHandleAxis.length > HANDLE_EPS ? endHandleAxis.angle : null;
    if (!contour.closed) {
      center.firstSegment.handleIn = new scope.Point(0, 0);
      center.lastSegment.handleOut = new scope.Point(0, 0);
    }

    const len = center.length;
    const serifStart = !contour.closed && stroke.startCap === "serif";
    const serifEnd = !contour.closed && stroke.endCap === "serif";
    const dropStart = !contour.closed && stroke.startCap === "drop";
    const dropEnd = !contour.closed && stroke.endCap === "drop";

    const contrast = clamp(stroke.contrast ?? DEFAULT_CONTRAST, 0, 1);
    const angle = stroke.angle;
    // Width/angle PROFILES (the graph editor): a present profile drives the stroke
    // through the sampled outline so the thickness / nib angle can vary per position.
    const widthProfile =
      stroke.widthProfile && stroke.widthProfile.points.length >= 2 ? stroke.widthProfile : null;
    const angleProfile =
      stroke.angleProfile && stroke.angleProfile.points.length >= 2 ? stroke.angleProfile : null;

    // Serif flare params: the foot swells the stem over a reach (see halfWidthAt).
    // A DROP is NOT a flare — it keeps the stem thin and merges a teardrop hull
    // onto the terminal (tangent neck → bulb; see dropTip), so it reads as a drop
    // emerging from the stroke rather than an oval stuck on a fat end.
    // A terminal CAP-ANGLE handle supersedes the panel `angle` for that end (only when
    // the panel didn't set one), so dragging the handle on canvas rotates the foot.
    const startSerifBase = stroke.startSerif ?? DEFAULT_SERIF;
    const endSerifBase = stroke.endSerif ?? DEFAULT_SERIF;
    // Serif algorithm: BOTH variants build the foot INTO the sampled width-flare body
    // below (seamless, no union). "a" honors a world/handle foot angle; "b" is
    // TANGENT-ONLY (foot ⟂ the local tangent), which can't hit A's angled-extension
    // kink — so it stays robust on curved/steep stems (the reason B exists).
    const startSerifVar = startSerifBase.variant ?? "a";
    const endSerifVar = endSerifBase.variant ?? "a";
    // The terminal CAP-ANGLE handle feeds variant "a"'s foot angle (only when the panel
    // didn't set one). Variant "b" never takes an angle.
    const startSerifS =
      serifStart && startSerifVar === "a" && startSerifBase.angle == null && startAxisDeg != null
        ? { ...startSerifBase, angle: startAxisDeg }
        : startSerifBase;
    const endSerifS =
      serifEnd && endSerifVar === "a" && endSerifBase.angle == null && endAxisDeg != null
        ? { ...endSerifBase, angle: endAxisDeg }
        : endSerifBase;
    // Effective foot angle: null for "b" (tangent-only), so projStart/footDir below treat
    // a B foot as perpendicular regardless of any stale panel angle.
    const startFootAngle = startSerifVar === "a" ? startSerifS.angle : null;
    const endFootAngle = endSerifVar === "a" ? endSerifS.angle : null;
    const startDropS = stroke.startDrop ?? DEFAULT_DROP;
    const endDropS = stroke.endDrop ?? DEFAULT_DROP;
    const footHalfStart = Math.max(startSerifS.length, r);
    const footHalfEnd = Math.max(endSerifS.length, r);
    const reachStart = clamp(Math.max(startSerifS.depth, footHalfStart), 1, len / 2);
    const reachEnd = clamp(Math.max(endSerifS.depth, footHalfEnd), 1, len / 2);

    // Ink-POOL drop (cursive terminal): the stroke's own outline swells from the stem
    // up to a pool of radius `dropR` over a reach, then a tangent round cap of that
    // radius closes it — so the stem flows seamlessly out of the pool (no bolted-on
    // bulb). `ratio` scales the reach (teardrop length); `smear` leans the pool.
    const dropRStart = Math.max(startDropS.size, r + 1);
    const dropREnd = Math.max(endDropS.size, r + 1);
    const dropReachStart = clamp(dropRStart * Math.max(startDropS.ratio ?? 1, 0.2), 1, len);
    const dropReachEnd = clamp(dropREnd * Math.max(endDropS.ratio ?? 1, 0.2), 1, len);
    const dropLeanStart = clamp(startDropS.smear ?? 0, -1, 1);
    const dropLeanEnd = clamp(endDropS.smear ?? 0, -1, 1);
    // Drop variant "b" — a seamless necked-bulb teardrop built from the body OUTLINE
    // (a centerline extension + a necked width profile, below), vs "a"'s swell + round
    // cap. `neck` = pinch ratio, `ratio` = elongation (extension length), `smear` leans it.
    const startDropVar = startDropS.variant ?? "a";
    const endDropVar = endDropS.variant ?? "a";
    const dropBStart = dropStart && startDropVar === "b";
    const dropBEnd = dropEnd && endDropVar === "b";
    const dropExtStart = dropRStart * clamp(startDropS.ratio ?? 1.5, 0.9, 2.5);
    const dropExtEnd = dropREnd * clamp(endDropS.ratio ?? 1.5, 0.9, 2.5);
    const dropNeckStart = r * clamp(startDropS.neck ?? 0.55, 0.1, 1);
    const dropNeckEnd = r * clamp(endDropS.neck ?? 0.55, 0.1, 1);

    let result: paper.PathItem | null;
    // BRUSH model: a true swept-brush envelope (pen-drawn look, glitch-proof on
    // thick+sharp). The serif FLARE is a body shape the sweep can't carry, so a serif
    // end falls through to the sampled-outline branch (serif implies the offset body).
    const useBrush = stroke.model === "brush" && !serifStart && !serifEnd && !dropStart && !dropEnd;
    if (useBrush) {
      const sNorm = (s: number): number => clamp(len > 0 ? s / len : 0, 0, 1);
      const nibAt = (s: number): number | null =>
        angleProfile ? evalProfile(angleProfile, sNorm(s)) : (angle ?? null);
      const halfBrush = (s: number): number =>
        Math.max(r * (widthProfile ? evalProfile(widthProfile, sNorm(s)) : 1), 1e-3);
      const edgeBrush = (s: number): paper.Point | null => {
        const na = nibAt(s);
        if (na == null) return null; // round brush → perpendicular cross-section
        const rad = (na * Math.PI) / 180;
        return new scope.Point(Math.cos(rad), Math.sin(rad)); // nib edge (world axis)
      };
      // Round brush: the disc is the full brush. Nib: a small contrast minor-axis so a
      // stroke moving parallel to the pen edge stays a thin line rather than vanishing.
      const dotBrush = (s: number): number => {
        const na = nibAt(s);
        return na == null ? halfBrush(s) : contrast * halfBrush(s);
      };
      // A pure ROUND brush (no nib) uses the exact disc envelope (`sweptRound`) — clean
      // straight edges + notch-free rounded corners. A NIB brush keeps the swept pen-edge.
      const isNib = angle != null || angleProfile != null;
      result = isNib
        ? sweptBrush(center, halfBrush, edgeBrush, dotBrush)
        : sweptRound(center, halfBrush);
    } else if (angle != null || serifStart || serifEnd || dropStart || dropEnd || widthProfile || angleProfile) {
      // The serif foot is a constant-width flat foot of length `project` plus a concave
      // bracket flare over `reach`. `anchor:"outward"` (default) extends the sampling
      // path past the terminal so the flat foot projects out; `anchor:"node"` keeps the
      // path as-is and grows the foot INWARD (far edge stays on the node). A world foot
      // `angle` is realized SEAMLESSLY by extending along that axis (so the foot's flat
      // terminal edge — always ⟂ the local tangent — comes out angled), NOT by a slab.
      const anchorStart = startSerifS.anchor ?? "outward";
      const anchorEnd = endSerifS.anchor ?? "outward";
      // An angled foot needs SOME depth to express the angle (the flat edge is the
      // extension's terminal), so force a minimum foot depth of `r` when `angle` is set.
      const projStart = serifStart ? Math.max(startSerifS.project ?? 0, startFootAngle != null ? r : 0) : 0;
      const projEnd = serifEnd ? Math.max(endSerifS.project ?? 0, endFootAngle != null ? r : 0) : 0;
      const out0 = (center.getTangentAt(0) ?? new scope.Point(1, 0)).multiply(-1); // outward at start
      const outN = center.getTangentAt(len) ?? new scope.Point(1, 0); // outward at end
      // Direction the flat foot extends: the outward tangent, or — when a world foot
      // angle is set — that axis (oriented outward), so the flat edge comes out angled.
      const footDir = (axisDeg: number | null | undefined, outward: paper.Point): paper.Point => {
        if (axisDeg == null) return outward;
        const rad = (axisDeg * Math.PI) / 180;
        const a = new scope.Point(Math.cos(rad), Math.sin(rad));
        return a.dot(outward) >= 0 ? a : a.multiply(-1);
      };
      // A drop-B end leans its extension axis by `smear` (so the bulb tilts).
      const leanDir = (out: paper.Point, lean: number): paper.Point =>
        out.add(new scope.Point(-out.y, out.x).multiply(lean * 0.5)).normalize();
      // Per-end centerline extension: serif-A's flat foot, OR a drop-B bulb+tip past the
      // node (so they're part of the body outline — seamless, no unioned cap).
      let extendStart = 0;
      let extDir0 = out0;
      if (serifStart && anchorStart === "outward") {
        extendStart = projStart;
        extDir0 = footDir(startFootAngle, out0); // "b" → null → straight tangent extension
      } else if (dropBStart) {
        extendStart = dropExtStart;
        extDir0 = leanDir(out0, dropLeanStart);
      }
      let extendEnd = 0;
      let extDirN = outN;
      if (serifEnd && anchorEnd === "outward") {
        extendEnd = projEnd;
        extDirN = footDir(endFootAngle, outN); // "b" → null → straight tangent extension
      } else if (dropBEnd) {
        extendEnd = dropExtEnd;
        extDirN = leanDir(outN, dropLeanEnd);
      }

      const sample = new scope.Path({ insert: false });
      if (extendStart > 0) sample.add(center.firstSegment.point.add(extDir0.multiply(extendStart)));
      center.segments.forEach((s) => sample.add(s.clone()));
      if (extendEnd > 0) sample.add(center.lastSegment.point.add(extDirN.multiply(extendEnd)));
      // Inherit closedness — a closed contour has no serif extends, so the sample IS
      // the centerline loop; sampledOutline needs this to build an annulus (not a
      // ribbon). Without it a closed profiled/nib stroke fell into the open branch.
      sample.closed = center.closed;

      const origStart = extendStart; // original start terminal, in sample arc-length
      const origEnd = extendStart + len; // original end terminal

      // Normalized position of a sample arc-length along the ORIGINAL path (the
      // extend/box regions clamp to 0/1), used to read the profiles.
      const norm = (s: number): number => clamp(len > 0 ? (s - origStart) / len : 0, 0, 1);
      // Base half-width: uniform, or the elliptical broad-nib projection (width
      // modulates with path direction; contrast = minor axis). An ANGLE profile
      // supplies a per-position nib angle (overriding the constant `angle`); a WIDTH
      // profile multiplies the result (1 = uniform).
      const baseHalf = (s: number): number => {
        const nibAngle = angleProfile ? evalProfile(angleProfile, norm(s)) : angle;
        let hw: number;
        if (nibAngle == null) hw = r;
        else {
          const delta = ((sample.getTangentAt(s)?.angle ?? 0) - nibAngle) * (Math.PI / 180);
          hw = (stroke.width / 2) * Math.hypot(Math.sin(delta), contrast * Math.cos(delta));
        }
        if (widthProfile) hw *= evalProfile(widthProfile, norm(s));
        return hw;
      };

      // The symmetric foot TARGET half-width at each end (the box + flare), or
      // -Infinity outside the foot's influence. The box spans `project` from the
      // terminal — past it (outward) or up the stem (node).
      const bracketStart = clamp(startSerifS.bracket ?? 0, 0, 1);
      const bracketEnd = clamp(endSerifS.bracket ?? 0, 0, 1);
      // Variant "a" = concave bracket fillet; "b" = a WEDGE (straight→convex sides).
      // Both are sampled width-flares (seamless); only the easing curve differs.
      const footEaseStart = startSerifVar === "b" ? wedgeEase : bracketEase;
      const footEaseEnd = endSerifVar === "b" ? wedgeEase : bracketEase;
      const footStartTarget = (s: number): number => {
        if (!serifStart) return -Infinity;
        const boxEnd = anchorStart === "node" ? origStart + projStart : origStart;
        if (s <= boxEnd) return footHalfStart;
        if (s < boxEnd + reachStart)
          return lerp(footHalfStart, baseHalf(s), footEaseStart((s - boxEnd) / reachStart, bracketStart));
        return -Infinity;
      };
      const footEndTarget = (s: number): number => {
        if (!serifEnd) return -Infinity;
        const boxStart = anchorEnd === "node" ? origEnd - projEnd : origEnd;
        if (s >= boxStart) return footHalfEnd;
        if (s > boxStart - reachEnd)
          return lerp(footHalfEnd, baseHalf(s), footEaseEnd((boxStart - s) / reachEnd, bracketEnd));
        return -Infinity;
      };
      // Foot EXCESS over the stem — what the foot adds, distributed per side.
      const footStartExcess = (s: number): number => Math.max(0, footStartTarget(s) - baseHalf(s));
      const footEndExcess = (s: number): number => Math.max(0, footEndTarget(s) - baseHalf(s));

      // Ink-POOL swell: the half-width eases from the pool radius `dropR` at the terminal
      // up to the stem over `dropReach` (a smooth swell), so the stroke fattens into the
      // pool. A tangent round cap (finishing pass) closes the rounded far edge.
      const dropStartTarget = (s: number): number => {
        if (!dropStart || startDropVar === "b") return -Infinity;
        if (s <= origStart) return dropRStart;
        if (s < origStart + dropReachStart)
          return lerp(dropRStart, baseHalf(s), bracketEase((s - origStart) / dropReachStart, 0));
        return -Infinity;
      };
      const dropEndTarget = (s: number): number => {
        if (!dropEnd || endDropVar === "b") return -Infinity;
        if (s >= origEnd) return dropREnd;
        if (s > origEnd - dropReachEnd)
          return lerp(dropREnd, baseHalf(s), bracketEase((origEnd - s) / dropReachEnd, 0));
        return -Infinity;
      };
      const dropStartExcess = (s: number): number => Math.max(0, dropStartTarget(s) - baseHalf(s));
      const dropEndExcess = (s: number): number => Math.max(0, dropEndTarget(s) - baseHalf(s));

      // Drop variant "b": the full necked half-width along the extended centerline (a
      // seamless OUTLINE, no cap). Stem → a concave neck pinch (to `neckW`) → swell to the
      // bulb radius `R` → a round bulb falling to a soft point at the tip. `dir` = +1 at
      // the end terminal, −1 at the start; returns −Infinity in the plain stem region.
      const neckedHalf = (s: number, sT: number, dir: number, R: number, neckW: number, ext: number): number => {
        const u = dir * (s - sT); // outward distance from the terminal
        const uNeck = -R * 0.35;
        const uBulb = ext - R;
        const blend = R * 0.4;
        if (u <= uNeck - blend) return -Infinity; // stem — use the normal width
        if (u < uNeck) return lerp(baseHalf(s), neckW, bracketEase((u - (uNeck - blend)) / blend, 0));
        if (u < uBulb) return lerp(neckW, R, bracketEase((u - uNeck) / (uBulb - uNeck), 0));
        if (u <= ext) return Math.sqrt(Math.max(0, R * R - (u - uBulb) * (u - uBulb)));
        return 0;
      };
      const dropBHalf = (s: number): number => {
        let w = -Infinity;
        if (dropBStart) w = Math.max(w, neckedHalf(s, origStart, -1, dropRStart, dropNeckStart, dropExtStart));
        if (dropBEnd) w = Math.max(w, neckedHalf(s, origEnd, 1, dropREnd, dropNeckEnd, dropExtEnd));
        return w;
      };

      // Asymmetry splits the foot/pool excess between the two sides; at 0 this reduces
      // EXACTLY to the symmetric base+excess. Serif `bias` = a one-sided beak; drop
      // `smear` = a leaning ink pool. (A world foot `angle` is realized by the angled
      // sample extension above, not here.)
      const biasStart = clamp(startSerifS.bias ?? 0, -1, 1);
      const biasEnd = clamp(endSerifS.bias ?? 0, -1, 1);
      const lGain = (b: number): number => Math.min(1, 1 - b);
      const rGain = (b: number): number => Math.min(1, 1 + b);

      // A drop-B terminal OVERRIDES the width with its necked profile (symmetric — the
      // lean is in the extension axis); elsewhere the normal base+excess sum applies.
      const leftWidthAt = (s: number): number => {
        const db = dropBHalf(s);
        if (db > -Infinity) return Math.max(db, 1e-3);
        return (
          baseHalf(s) +
          footStartExcess(s) * lGain(biasStart) +
          footEndExcess(s) * lGain(biasEnd) +
          dropStartExcess(s) * lGain(dropLeanStart) +
          dropEndExcess(s) * lGain(dropLeanEnd)
        );
      };
      const rightWidthAt = (s: number): number => {
        const db = dropBHalf(s);
        if (db > -Infinity) return Math.max(db, 1e-3);
        return (
          baseHalf(s) +
          footStartExcess(s) * rGain(biasStart) +
          footEndExcess(s) * rGain(biasEnd) +
          dropStartExcess(s) * rGain(dropLeanStart) +
          dropEndExcess(s) * rGain(dropLeanEnd)
        );
      };

      result = sampledOutline(sample, leftWidthAt, rightWidthAt);
    } else {
      // Uniform stroke: SWEEP a round brush — the sampled ribbon (clean butt ends,
      // self-cross dissolved) plus an explicit join unioned at each real corner.
      // Robust where the perpendicular offsetter glitched on thick + sharp strokes.
      result = sweptUniform(center, r, stroke.join, limit);
    }

    if (!result) return [];

    // Dissolve any self-overlap in the swept body so a sharp bend fills solid
    // instead of punching an "exclude" hole. Idempotent for the uniform branch
    // (offsetStroke already unions); the safety net for the open sampled ribbon.
    // A CLOSED sampled annulus is already a clean ring (outer + reversed inner) and
    // uniting it with itself would dissolve the hole — so skip solidify there.
    if (!contour.closed) result = solidify(result);

    // Per-end finishing: drop → close the swollen pool with a TANGENT round cap (the
    // body is already width dropR there, so the disc meets it seamlessly); serif → the
    // bracketed foot is already part of the outline; plain caps → union the cap shape.
    if (!contour.closed) {
      const p0 = center.firstSegment.point;
      const pN = center.lastSegment.point;
      const t0 = center.getTangentAt(0).multiply(-1); // outward at start
      const tN = center.getTangentAt(center.length); // outward at end
      // The stroke's actual outline half-width AT a terminal — `r` for a uniform
      // stroke, the nib projection for a broad nib, scaled by the width profile — so
      // a plain cap radius matches the real (possibly profiled) end width. `tNorm` is
      // 0 at the start terminal, 1 at the end.
      const termHalf = (tangent: paper.Point, tNorm: number): number => {
        const nibAngle = angleProfile ? evalProfile(angleProfile, tNorm) : angle;
        let hw: number;
        if (nibAngle == null) hw = r;
        else {
          const delta = ((tangent.angle ?? 0) - nibAngle) * (Math.PI / 180);
          hw = (stroke.width / 2) * Math.hypot(Math.sin(delta), contrast * Math.cos(delta));
        }
        if (widthProfile) hw *= evalProfile(widthProfile, tNorm);
        return Math.max(hw, 1e-3);
      };
      const hwStart = termHalf(center.getTangentAt(0), 0);
      const hwEnd = termHalf(center.getTangentAt(len), 1);
      // A terminal CAP-ANGLE handle feeds the rectangle cap's axis (when the panel
      // didn't set one), so dragging the handle rotates the box like the serif foot.
      const effRect = (rect: RectCapStyle | null | undefined, axisDeg: number | null) =>
        axisDeg == null ? rect : { ...(rect ?? DEFAULT_RECT), angle: rect?.angle ?? axisDeg };
      // Drop "a": close the swollen pool with a TANGENT round cap (radius dropR = the
      // body half-width there, so it's seamless). Drop "b": the necked bulb is ALREADY in
      // the outline (extension + necked width) — no cap.
      // Serif feet (both variants) are already in the sampled body above — no union here.
      if (dropStart) {
        if (startDropVar !== "b") result = withCap(result, "round", p0, t0, dropRStart, null, false, center, true);
      } else if (!serifStart) result = withCap(result, stroke.startCap, p0, t0, hwStart, effRect(stroke.startRect, startAxisDeg), stroke.startRoundAtNode, center, true);
      if (dropEnd) {
        if (endDropVar !== "b") result = withCap(result, "round", pN, tN, dropREnd, null, false, center, false);
      } else if (!serifEnd) result = withCap(result, stroke.endCap, pN, tN, hwEnd, effRect(stroke.endRect, endAxisDeg), stroke.endRoundAtNode, center, false);

      // A BUTT cap (or a broad-nib flat terminal) with a cap-angle handle is re-cut
      // along that handle: extend the body past the node then slice at the handle
      // plane, so the flat butt tracks the handle direction instead of the tangent.
      const cutBig = center.bounds.width + center.bounds.height + 4 * stroke.width + 100;
      if (stroke.startCap === "butt" && startHandleAxis && startAxisDeg != null)
        result = angledTerminal(result, p0, t0, startHandleAxis, hwStart, cutBig);
      if (stroke.endCap === "butt" && endHandleAxis && endAxisDeg != null)
        result = angledTerminal(result, pN, tN, endHandleAxis, hwEnd, cutBig);
    }

    return normalize(result);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function lerp(a: number, b: number, p: number): number {
  return a + (b - a) * p;
}

/**
 * Serif foot easing as a function of u (0 = at the foot, 1 = up at the stem). At
 * `bracket = 0` this is the legacy smoothstep (an S-flare, no fillet). As `bracket`
 * → 1 it blends toward a CONCAVE quarter-circle: the width hugs the stem for most of
 * the reach (tangent to the stem at u=1) then sweeps out sharply to a near-flat foot
 * at u=0 — the bracket fillet that makes a serif read as a serif, not a blob.
 */
function bracketEase(u: number, bracket: number): number {
  const x = clamp(u, 0, 1);
  const s = x * x * (3 - 2 * x); // smoothstep (legacy)
  const b = clamp(bracket, 0, 1);
  if (b <= 0) return s;
  const arc = Math.sqrt(Math.max(0, 1 - (1 - x) * (1 - x))); // concave fillet
  return lerp(s, arc, b);
}

/**
 * Serif foot easing for variant "b" — a WEDGE (Latin serif), the opposite curvature
 * family from `bracketEase`'s concave bracket. `flare = 0` returns the IDENTITY (a
 * LINEAR width ramp ⇒ straight diagonal sides splaying to the foot); as `flare → 1`
 * it blends toward a convex curve (`u*u` keeps the width nearer the foot half-width
 * across the mid-reach, so the shoulder bulges OUTWARD = a flared wedge). The wedge
 * meets the stem at u=1 with a deliberate ANGLE (not tangent like the bracket) — that
 * crease is the wedge look, and it's still ONE seamless outline (no union, no overlap).
 */
function wedgeEase(u: number, flare: number): number {
  const x = clamp(u, 0, 1);
  return lerp(x, x * x, clamp(flare, 0, 1));
}

/**
 * Build a flattened stroke ribbon by sampling the centerline and offsetting each
 * side INDEPENDENTLY — `leftWidthAt(t)` along +normal, `rightWidthAt(t)` along
 * -normal. The independent sides carry direction-dependent and ASYMMETRIC widths
 * (broad nib, biased/sheared serif feet) the curve-exact offsetter can't do.
 * Returns a self-intersection-cleaned region, or null for a zero-length path.
 */
function sampledOutline(
  center: paper.Path,
  leftWidthAt: (t: number) => number,
  rightWidthAt: (t: number) => number,
): paper.PathItem | null {
  const len = center.length;
  if (len <= 0) return null;
  const steps = Math.min(Math.max(Math.ceil(len / 4), 8), 800);
  const closed = center.closed;
  // For a closed centerline sample [0, len) (the loop closes the gap), so the last
  // vertex isn't a duplicate of the first.
  const count = closed ? steps - 1 : steps;
  const left: paper.Point[] = [];
  const right: paper.Point[] = [];
  for (let i = 0; i <= count; i += 1) {
    const t = (len * i) / steps;
    const pt = center.getPointAt(t) ?? center.lastSegment.point;
    const tan = center.getTangentAt(t) ?? new scope.Point(1, 0);
    const normal = new scope.Point(-tan.y, tan.x);
    const hwL = Math.max(leftWidthAt(t), 1e-3);
    const hwR = Math.max(rightWidthAt(t), 1e-3);
    left.push(pt.add(normal.multiply(hwL)));
    right.push(pt.subtract(normal.multiply(hwR)));
  }

  if (closed) {
    // A closed centerline → an ANNULUS, not a ribbon: the two offset sides are each
    // their own closed loop, assembled as a compound path. Both sides sample the
    // centerline forward, so they wind the SAME way — reverse one so the compound
    // reads as a ring (opposite windings) instead of a solid blob; `correctWinding`
    // then sets outer CW / hole CCW (Invariant 4), as the offsetStroke ring does.
    const a = new scope.Path({ insert: false });
    left.forEach((p) => a.add(p));
    a.closed = true;
    const b = new scope.Path({ insert: false });
    for (let i = right.length - 1; i >= 0; i -= 1) b.add(right[i]!);
    b.closed = true;
    return new scope.CompoundPath({ children: [a, b], insert: false });
  }

  const out = new scope.Path({ insert: false });
  left.forEach((p) => out.add(p));
  for (let i = right.length - 1; i >= 0; i -= 1) out.add(right[i]!);
  out.closed = true;
  // Self-union, NOT a bare resolveCrossings: a sharply-curving ribbon crosses
  // itself, and resolveCrossings would leave the overlap loop nested (→ a hole).
  return solidify(out);
}

/**
 * Build a UNIFORM stroke outline by sweeping a round brush along the path: the
 * sampled ribbon (clean butt ends ⟂ the tangent, inner self-cross dissolved by
 * solidify, closed → annulus) plus a join shape unioned at each real corner —
 * `round` a disc, `miter` the outer triangle to the miter apex (clamped by the
 * miter limit, else a bevel), `bevel` nothing. Boolean unions never self-intersect,
 * so this is robust where the perpendicular offsetter glitched (thick + sharp).
 */
function sweptUniform(
  center: paper.Path,
  r: number,
  join: StrokeJoin,
  miterLimit: number,
): paper.PathItem | null {
  let body = sampledOutline(center, () => r, () => r);
  if (!body) return null;
  // The ribbon already bevels corners; a CLOSED path is the sampled annulus, which is
  // a clean frame on its own (its inner/outer sides make "outer-side" join geometry
  // ambiguous), so only add explicit joins at the interior corners of OPEN paths.
  if (join === "bevel" || center.closed) return body;

  const curves = center.curves;
  for (let k = 0; k < curves.length - 1; k += 1) {
    const cIn = curves[k]!;
    const cOut = curves[k + 1]!;
    const anchor = cIn.point2; // the shared corner anchor
    const tIn = cIn.getTangentAtTime(1); // travel direction into the corner
    const tOut = cOut.getTangentAtTime(0); // travel direction out of it
    const cross = tIn.x * tOut.y - tIn.y * tOut.x;
    if (Math.abs(cross) < 1e-4 && tIn.dot(tOut) > 0) continue; // smooth — no join

    if (join === "round") {
      body = body.unite(new scope.Path.Circle(anchor, r), { insert: false });
      continue;
    }
    // miter: fill the gap on the OUTER side of the turn up to the miter apex.
    const outerN = (t: paper.Point) =>
      cross > 0 ? new scope.Point(t.y, -t.x) : new scope.Point(-t.y, t.x);
    const aIn = anchor.add(outerN(tIn).multiply(r));
    const aOut = anchor.add(outerN(tOut).multiply(r));
    const apex = lineIntersect(aIn, tIn, aOut, tOut);
    if (apex && apex.subtract(anchor).length <= miterLimit * r) {
      const tri = new scope.Path([aIn, apex, aOut]);
      tri.closed = true;
      body = body.unite(tri, { insert: false });
    }
  }
  return body;
}

/** Hard cap on the halftone grid cell count — a tiny cell on a big glyph would
 *  otherwise do thousands of `getNearestPoint` calls and freeze. The effective pitch
 *  is clamped UP so cols×rows can't exceed this. A custom SVG pattern stamps a full
 *  path-clone per cell (heavier), so it gets a lower cap. */
const HALFTONE_MAX_CELLS = 2500;
const HALFTONE_MAX_CELLS_SVG = 800;

/** The imported halftone `pattern` as ONE detached unit-sized Paper compound (centred
 *  at the origin), cached by the contour-array identity so it's built once per pattern. */
const halftonePatternCache = new WeakMap<Contour[], paper.PathItem>();
function halftonePatternPath(contours: Contour[]): paper.PathItem {
  let p = halftonePatternCache.get(contours);
  if (!p) {
    p = new scope.CompoundPath({ children: contours.map((c) => toPath(c)), insert: false });
    halftonePatternCache.set(contours, p);
  }
  return p;
}

/** One detached halftone element of radius `dotR` at `P`, rotated to the screen angle.
 *  `line` is a row-length bar (neighbours abut into continuous, thickness-varying lines). */
function halftoneShape(P: paper.Point, dotR: number, shape: HalftoneShape, angDeg: number, cell: number): paper.Path {
  let path: paper.Path;
  if (shape === "circle") {
    path = new scope.Path.Circle({ center: P, radius: dotR, insert: false });
  } else if (shape === "diamond") {
    path = new scope.Path({
      segments: [[P.x, P.y - dotR], [P.x + dotR, P.y], [P.x, P.y + dotR], [P.x - dotR, P.y]],
      closed: true,
      insert: false,
    });
  } else if (shape === "triangle") {
    // Equilateral triangle inscribed in radius `dotR` (vertices at -90°, 30°, 150°).
    path = new scope.Path({
      segments: [[P.x, P.y - dotR], [P.x + dotR * 0.866, P.y + dotR * 0.5], [P.x - dotR * 0.866, P.y + dotR * 0.5]],
      closed: true,
      insert: false,
    });
  } else if (shape === "line") {
    path = new scope.Path.Rectangle({ point: [P.x - cell / 2, P.y - dotR], size: [cell, 2 * dotR], insert: false });
  } else {
    path = new scope.Path.Rectangle({ point: [P.x - dotR, P.y - dotR], size: [2 * dotR, 2 * dotR], insert: false });
  }
  if (angDeg !== 0 && shape !== "circle") path.rotate(angDeg, P);
  return path;
}

/**
 * EXPERIMENTAL halftone stroke (model: "halftone"). Fills a body with a grid of `shape`
 * elements (rotated by `angle`), each SIZED by its distance — a tonal gradient — then
 * clipped to the body. Returns many small CW solids (the caller applies the contour's
 * paint). Reached ONLY via the early return in expandStrokeImpl, so it touches none of
 * the offset/brush/serif/drop code.
 *  - OPEN contour → the swept ribbon (+ a round-cap disc at a `round`-capped terminal;
 *    butt = flat as before; serif/drop/rect fall back to butt). Size fades centerline→edge.
 *  - CLOSED contour → the path's INTERIOR is filled; size fades from deep inside toward the
 *    boundary (`r = width/2` is the fade depth). (Replaces the old thin-ring result.)
 */
function halftoneStroke(
  center: paper.Path,
  r: number,
  stroke: StrokeStyle,
  style: HalftoneStyle,
): Contour[] {
  if (r <= 0) return [];
  const closed = center.closed;
  let body: paper.PathItem | null;
  if (closed) {
    body = center.clone({ insert: false }) as paper.PathItem; // the interior region
  } else {
    body = sweptUniform(center, r, stroke.join, stroke.miterLimit ?? 10);
    if (body && stroke.startCap === "round") {
      body = body.unite(new scope.Path.Circle({ center: center.firstSegment.point, radius: r, insert: false }), { insert: false });
    }
    if (body && stroke.endCap === "round") {
      body = body.unite(new scope.Path.Circle({ center: center.lastSegment.point, radius: r, insert: false }), { insert: false });
    }
  }
  if (!body) return [];
  const b = body.bounds;
  // A custom SVG pattern stamps a path-clone per cell (heavier) ⇒ a lower cell cap.
  const patternBase =
    style.shape === "svg" && style.pattern && style.pattern.length > 0
      ? halftonePatternPath(style.pattern)
      : null;
  const maxCells = patternBase ? HALFTONE_MAX_CELLS_SVG : HALFTONE_MAX_CELLS;
  // Effective pitch, clamped up so the grid can't explode on a tiny cell.
  let cell = Math.max(style.cell, 1);
  if ((b.width / cell + 1) * (b.height / cell + 1) > maxCells) {
    cell = Math.sqrt((b.width * b.height) / maxCells);
  }
  const maxR = Math.max(style.size, 0) / 2;
  if (maxR < 0.3) return [];
  // Falloff shaping: gamma>1 (contrast>0.5) decays faster; gamma<1 stays full then drops.
  const gamma = Math.pow(4, (clamp(style.contrast ?? 0.5, 0, 1) - 0.5) * 2);
  const angRad = (style.angle * Math.PI) / 180;
  const cos = Math.cos(angRad);
  const sin = Math.sin(angRad);
  const cx = b.center.x;
  const cy = b.center.y;
  const origin = new scope.Point(0, 0);
  // svg shape with no pattern yet ⇒ fall back to a plain circle.
  const fallbackShape: HalftoneShape = style.shape === "svg" ? "circle" : style.shape;
  // The rotated grid must cover the whole box ⇒ sweep ±the half-diagonal in its own frame.
  const reach = Math.hypot(b.width, b.height) / 2 + cell;
  // Flat list of simple sub-paths (a CompoundPath's children must be plain Paths, so an
  // svg-pattern stamp is flattened into its sub-paths here).
  const children: paper.Path[] = [];
  for (let u = -reach; u <= reach; u += cell) {
    for (let v = -reach; v <= reach; v += cell) {
      const P = new scope.Point(cx + u * cos - v * sin, cy + u * sin + v * cos);
      const near = center.getNearestPoint(P);
      if (!near) continue;
      const dist = P.getDistance(near); // distance to centerline (open) / boundary (closed)
      let dotR: number;
      if (closed) {
        if (!body.contains(P)) continue; // only inside the shape
        dotR = maxR * Math.pow(Math.min(dist / r, 1), gamma); // full deep inside → 0 at the edge
      } else {
        if (dist > r) continue; // outside the stroke band
        dotR = maxR * Math.pow(1 - dist / r, gamma); // fade to 0 at the edge
      }
      if (dotR < 0.3) continue;
      if (patternBase) {
        // Stamp the unit pattern: scale to diameter 2·dotR, rotate to the screen angle,
        // move to P (the base is centred at the origin and never mutated).
        const stamp = patternBase.clone({ insert: false }) as paper.CompoundPath;
        stamp.scale(2 * dotR, origin);
        if (style.angle !== 0) stamp.rotate(style.angle, origin);
        stamp.translate(P);
        for (const sp of stamp.children as paper.Path[]) children.push(sp);
      } else {
        children.push(halftoneShape(P, dotR, fallbackShape, style.angle, cell));
      }
    }
  }
  if (children.length === 0) return [];
  const pattern = new scope.CompoundPath({ children, insert: false });
  return normalize(pattern.intersect(body, { insert: false }));
}

/** Hard cap on dash/dot elements (perf guard for a tiny dash on a long path). A custom-SVG
 *  element stamps a full path-clone each, so it gets a lower cap. */
const MAX_DASH_ELEMENTS = 2000;
const MAX_DASH_ELEMENTS_SVG = 600;

/**
 * EXPERIMENTAL dash stroke (model: "dash"). Breaks the centerline into repeated elements
 * along its arc length — `"dash"` blocks, `"dot"` circles, or a custom `"svg"` `pattern` —
 * separated by `gap`. `sizeProfile` scales each element's size by its position along the
 * path. `align` (default) makes elements follow the tangent (dash = ribbon ALONG the path,
 * svg = rotated to it); `align:false` makes a dash a perpendicular TICK (railroad, leaned by
 * `angle`) and an svg sit at a fixed angle. Isolated like `halftoneStroke` (a top-level early
 * return in `expandStroke`); returns CW solids the caller paints. Caps/serifs N/A.
 */
/** Along-path spacing, enlarged so a tiny element can't exceed `maxCount` on a long path. */
function dashPitch(base: number, total: number, maxCount: number): number {
  const pitch = Math.max(0.5, base);
  return total / pitch > maxCount ? total / maxCount : pitch;
}

function dashStroke(center: paper.Path, r: number, stroke: StrokeStyle, style: DashStyle): Contour[] {
  const total = center.length;
  if (total <= 0 || r <= 0) return [];
  const gap = Math.max(0, style.gap);
  const size = Math.max(0.5, style.size ?? stroke.width); // dot diameter / svg box size
  // A custom SVG element (normalized to a unit box); null when "svg" without an import.
  const patternBase =
    style.shape === "svg" && style.pattern && style.pattern.length > 0
      ? halftonePatternPath(style.pattern)
      : null;
  // svg WITHOUT a pattern falls back to a dot so something still shows.
  const mode: "dash" | "dot" | "svg" = style.shape === "svg" ? (patternBase ? "svg" : "dot") : style.shape;

  // Size PROFILE: a multiplier (1 = uniform) read at each element's arc-length position.
  const prof = style.sizeProfile && style.sizeProfile.points.length >= 2 ? style.sizeProfile : null;
  const mulAt = (s: number): number => (prof ? Math.max(0, evalProfile(prof, s / total)) : 1);
  // ORIENTATION: elements follow the path tangent unless `align === false`.
  const align = style.align !== false;
  const baseAngle = style.angle ?? 0;

  const children: paper.Path[] = [];
  const origin = new scope.Point(0, 0);

  if (mode === "dash" && align) {
    // Ribbon ALONG the path; half-width tapers per sample by the size profile.
    const dashLen = Math.max(0.5, style.dash);
    const pitch = dashPitch(dashLen + gap, total, MAX_DASH_ELEMENTS);
    const len = Math.min(dashLen, pitch);
    const sampleStep = Math.max(1, Math.min(len, r));
    for (let s0 = 0; s0 < total - 1e-6; s0 += pitch) {
      const s1 = Math.min(s0 + len, total);
      const steps = Math.max(1, Math.ceil((s1 - s0) / sampleStep));
      const left: paper.Point[] = [];
      const right: paper.Point[] = [];
      for (let k = 0; k <= steps; k += 1) {
        const s = s0 + ((s1 - s0) * k) / steps;
        const p = center.getPointAt(s);
        const n = center.getNormalAt(s);
        if (!p || !n) continue;
        const hw = r * mulAt(s);
        left.push(p.add(n.multiply(hw)));
        right.push(p.subtract(n.multiply(hw)));
      }
      if (left.length < 2) continue;
      children.push(new scope.Path({ segments: [...left, ...right.reverse()], closed: true, insert: false }));
    }
  } else if (mode === "dash") {
    // Fixed-angle TICKS across the path: perpendicular by default (railroad ties), leaned by
    // `angle`. `dash` is the tick length (across); thickness is the stroke width (× profile).
    const tickLen = Math.max(0.5, style.dash);
    const pitch = dashPitch(2 * r + gap, total, MAX_DASH_ELEMENTS);
    for (let s = pitch / 2; s <= total + 1e-6; s += pitch) {
      const sc = Math.min(s, total);
      const p = center.getPointAt(sc);
      if (!p) continue;
      const thick = Math.max(0.3, 2 * r * mulAt(sc));
      const tang = center.getTangentAt(sc)?.angle ?? 0;
      const tick = new scope.Path.Rectangle({
        point: [p.x - tickLen / 2, p.y - thick / 2],
        size: [tickLen, thick],
        insert: false,
      });
      tick.rotate(tang + 90 + baseAngle, p); // ⟂ to the path tangent + lean
      children.push(tick);
    }
  } else {
    // dot OR svg: one element every `pitch`, centred on the path, started half a pitch in.
    const pitch = dashPitch(size + gap, total, mode === "svg" ? MAX_DASH_ELEMENTS_SVG : MAX_DASH_ELEMENTS);
    for (let s = pitch / 2; s <= total + 1e-6; s += pitch) {
      const sc = Math.min(s, total);
      const p = center.getPointAt(sc);
      if (!p) continue;
      const m = mulAt(sc);
      if (m <= 0.001) continue; // zeroed by the profile → no element here
      if (mode === "svg" && patternBase) {
        const tang = center.getTangentAt(sc)?.angle ?? 0;
        const rot = (align ? tang : 0) + baseAngle;
        const stamp = patternBase.clone({ insert: false }) as paper.CompoundPath;
        stamp.scale(size * m, origin); // unit box → size (× profile)
        if (rot !== 0) stamp.rotate(rot, origin);
        stamp.translate(p);
        for (const sp of stamp.children as paper.Path[]) children.push(sp);
      } else {
        children.push(new scope.Path.Circle({ center: p, radius: (size / 2) * m, insert: false }));
      }
    }
  }
  if (children.length === 0) return [];
  // SELF-UNION before winding assignment (like halftone's `intersect(body)`): dissolves
  // OVERLAPPING elements into merged solids so nesting-based `correctWinding` can't mislabel
  // an intersecting sibling as a hole (the "exclusion"/XOR bug). The compound's nonzero rule
  // keeps a genuine internal hole (e.g. an SVG donut) a hole.
  return normalize(solidify(new scope.CompoundPath({ children, insert: false })));
}

/**
 * Combined halftone (the "merge same-layer halftones" setting): union the stroke BODIES
 * of several same-style contours into one region, then fill that merged region with ONE
 * shared dot grid — so abutting/overlapping same-style halftone paths read as a single
 * continuous tone with no seam. Isolated like `halftoneStroke` (it does NOT touch the
 * single-path code) and reuses the same helpers. Returns CW dot solids; the caller applies
 * the shared paint.
 */
function halftoneGroup(contours: Contour[], stroke: StrokeStyle, style: HalftoneStyle): Contour[] {
  scope.activate();
  const r = stroke.width / 2;
  if (r <= 0) return [];
  // Union every contour's body (open → swept ribbon + round caps; closed → interior).
  let merged: paper.PathItem | null = null;
  for (const c of contours) {
    if (c.points.length < 2) continue;
    const center = toPath(c);
    let body: paper.PathItem | null;
    if (center.closed) {
      body = center.clone({ insert: false }) as paper.PathItem;
    } else {
      body = sweptUniform(center, r, stroke.join, stroke.miterLimit ?? 10);
      if (body && stroke.startCap === "round")
        body = body.unite(new scope.Path.Circle({ center: center.firstSegment.point, radius: r, insert: false }), { insert: false });
      if (body && stroke.endCap === "round")
        body = body.unite(new scope.Path.Circle({ center: center.lastSegment.point, radius: r, insert: false }), { insert: false });
    }
    if (!body) continue;
    merged = merged ? merged.unite(body, { insert: false }) : body;
  }
  if (!merged) return [];
  return halftoneFill(merged, r, style);
}

/**
 * Fill a body region with the rotated halftone dot grid, dot size fading by distance to
 * the body's BOUNDARY (full deep inside → 0 at the edge). The grid loop mirrors
 * `halftoneStroke`'s but is kept separate so the single-path look can't regress. `r` is
 * the fade depth (half the stroke width). Used by the combined `halftoneGroup`.
 */
function halftoneFill(body: paper.PathItem, r: number, style: HalftoneStyle): Contour[] {
  const b = body.bounds;
  const patternBase =
    style.shape === "svg" && style.pattern && style.pattern.length > 0
      ? halftonePatternPath(style.pattern)
      : null;
  const maxCells = patternBase ? HALFTONE_MAX_CELLS_SVG : HALFTONE_MAX_CELLS;
  let cell = Math.max(style.cell, 1);
  if ((b.width / cell + 1) * (b.height / cell + 1) > maxCells) {
    cell = Math.sqrt((b.width * b.height) / maxCells);
  }
  const maxR = Math.max(style.size, 0) / 2;
  if (maxR < 0.3) return [];
  const gamma = Math.pow(4, (clamp(style.contrast ?? 0.5, 0, 1) - 0.5) * 2);
  const angRad = (style.angle * Math.PI) / 180;
  const cos = Math.cos(angRad);
  const sin = Math.sin(angRad);
  const cx = b.center.x;
  const cy = b.center.y;
  const origin = new scope.Point(0, 0);
  const fallbackShape: HalftoneShape = style.shape === "svg" ? "circle" : style.shape;
  const reach = Math.hypot(b.width, b.height) / 2 + cell;
  const children: paper.Path[] = [];
  for (let u = -reach; u <= reach; u += cell) {
    for (let v = -reach; v <= reach; v += cell) {
      const P = new scope.Point(cx + u * cos - v * sin, cy + u * sin + v * cos);
      if (!body.contains(P)) continue; // only inside the merged shape
      const near = body.getNearestPoint(P);
      if (!near) continue;
      const dist = P.getDistance(near); // distance to the merged boundary
      const dotR = maxR * Math.pow(Math.min(dist / r, 1), gamma); // full deep inside → 0 at edge
      if (dotR < 0.3) continue;
      if (patternBase) {
        const stamp = patternBase.clone({ insert: false }) as paper.CompoundPath;
        stamp.scale(2 * dotR, origin);
        if (style.angle !== 0) stamp.rotate(style.angle, origin);
        stamp.translate(P);
        for (const sp of stamp.children as paper.Path[]) children.push(sp);
      } else {
        children.push(halftoneShape(P, dotR, fallbackShape, style.angle, cell));
      }
    }
  }
  if (children.length === 0) return [];
  const pattern = new scope.CompoundPath({ children, insert: false });
  return normalize(pattern.intersect(body, { insert: false }));
}

/**
 * Build a stroke body as a true SWEPT-BRUSH ENVELOPE (a Minkowski-style sweep): a
 * brush is stamped along the centerline and the stamps are unioned into one region,
 * so thick strokes with sharp corners read as pen-DRAWN and can never glitch (a
 * boolean union has no self-intersections to leave notches).
 *
 * At each dense sample we add (a) a QUAD bridging this cross-section to the previous
 * one and (b) a DISC `dotAt` wide — for a ROUND brush the disc IS the brush (it rounds
 * convex corners); for a NIB the cross-section is the pen edge (`edgeAt`) and the disc
 * is the small contrast minor-axis (so a stroke moving parallel to the nib stays a
 * thin line instead of vanishing). All stamps share one winding and go into a single
 * CompoundPath, so ONE `solidify` (self-union) dissolves every overlap at once —
 * O(1) booleans regardless of the sample count. Closed paths keep their interior hole
 * (an annulus); `normalize` then sets outer-CW / hole-CCW.
 */
function sweptBrush(
  center: paper.Path,
  halfAt: (s: number) => number,
  edgeAt: (s: number) => paper.Point | null,
  dotAt: (s: number) => number,
): paper.PathItem | null {
  const len = center.length;
  if (len <= 0) return null;
  const closed = center.closed;
  const tangentAt = (s: number): paper.Point =>
    center.getTangentAt(clamp(s, 0, len)) ?? new scope.Point(1, 0);

  // ADAPTIVE arc-length samples: walk a fine step but only emit a cross-section where
  // the direction has turned enough (a corner / tight curve) or after a max straight
  // run — so a straight edge is ONE quad and only curves get dense stamps. This keeps
  // the union count (and so the boolean cost) proportional to the path's curvature,
  // not its raw length.
  const fine = clamp(len / 400, 0.25, 2);
  const turnThresh = 0.12; // rad (~7°) of accumulated turn before a new sample
  const maxRun = 24; // units of straight path between forced samples
  const sList: number[] = [0];
  let lastEmit = 0;
  let prevTan = tangentAt(0);
  let acc = 0;
  for (let s = fine; s < len - 1e-6; s += fine) {
    const tan = tangentAt(s);
    acc += Math.acos(clamp(prevTan.dot(tan), -1, 1));
    prevTan = tan;
    if (acc >= turnThresh || s - lastEmit >= maxRun) {
      sList.push(s);
      lastEmit = s;
      acc = 0;
    }
  }
  sList.push(len);

  const stamps: paper.PathItem[] = [];
  let prevL: paper.Point | null = null;
  let prevR: paper.Point | null = null;
  let prevTanE: paper.Point | null = null;
  for (let i = 0; i < sList.length; i += 1) {
    const s = sList[i]!;
    const pt = center.getPointAt(s) ?? center.lastSegment.point;
    const tan = tangentAt(s);
    const h = Math.max(halfAt(s), 1e-3);
    // Round brush → cross-section ⟂ the path; nib → the fixed pen edge.
    const e = edgeAt(s) ?? new scope.Point(-tan.y, tan.x);
    const L = pt.add(e.multiply(h));
    const R = pt.subtract(e.multiply(h));
    if (prevL && prevR) {
      const quad = new scope.Path([prevL, L, R, prevR]);
      quad.closed = true;
      stamps.push(quad);
    }
    // Round the convex corner with a disc only where the path actually turns (or at a
    // closed loop's seam) — skip it on near-straight junctions (tiny facet, no disc).
    const turn = prevTanE ? Math.acos(clamp(prevTanE.dot(tan), -1, 1)) : 0;
    const seam = closed && (i === 0 || i === sList.length - 1);
    const dot = dotAt(s);
    // Leave the OPEN terminals flat (butt): a disc within its own radius of an end would
    // poke past the flat butt that the quad cross-sections form, so skip it there. The
    // shared cap-finishing pass (withCap / dropTip) then shapes the ends as for the
    // offset body. (No global terminal half-plane cut — that sliced self-approaching
    // paths where a terminal's outward plane crossed a distant part of the body.)
    const nearTerminal = !closed && (s < dot || len - s < dot);
    if (dot > 1e-3 && !nearTerminal && (turn > 0.08 || seam)) {
      stamps.push(new scope.Path.Circle(pt, dot));
    }
    prevL = L;
    prevR = R;
    prevTanE = tan;
  }

  // Round each genuine CORNER NODE with a brush disc centered ON the vertex. The adaptive
  // samples above land NEAR but not ON a hard corner, so the bridging cross-section chords
  // inside the rounded envelope and leave a "disc–notch–disc" artefact at sharp corners
  // (triangles/rectangles). A disc on the actual vertex fills it — exactly how a round
  // brush rounds a corner. Skip open terminals (kept flat/butt) and the closed seam
  // (already capped by the seam disc); smooth nodes (tiny tangent break) get nothing.
  const segs = center.segments;
  const eps = Math.min(fine, 0.5);
  for (let i = 0; i < segs.length; i += 1) {
    const seg = segs[i]!;
    if (!closed && (i === 0 || i === segs.length - 1)) continue; // open terminal
    const s = center.getNearestLocation(seg.point)?.offset ?? 0;
    if (closed && (s < eps || len - s < eps)) continue; // seam (already capped)
    const turn = Math.acos(clamp(tangentAt(s - eps).dot(tangentAt(s + eps)), -1, 1));
    if (turn <= 0.2) continue; // ~11° — a smooth node, no disc needed
    const dotR = dotAt(s);
    const nearTerminal = !closed && (s < dotR || len - s < dotR);
    if (dotR > 1e-3 && !nearTerminal) stamps.push(new scope.Path.Circle(seg.point, dotR));
  }

  return uniteAll(stamps);
}

/**
 * ROUND-brush envelope (the exact swept disc). Per centerline SEGMENT we add a
 * trapezoid aligned to THAT segment's own direction (so straight edges stay perfectly
 * straight — no scalloping), and at every joint/corner a disc of the local half-width
 * rounds it. Breaking exactly at each node (curves subdivided; straight curves left whole)
 * means a hard corner gets a disc centered ON the vertex, tangent to both edges — a clean
 * rounded corner with NO notch (the per-sample perpendicular-quad approach in `sweptBrush`
 * mis-orients the cross-section at a corner's ambiguous tangent and leaves a reflex sliver).
 * Open terminals are left flat (the cap-finishing pass shapes them). Used for the round
 * brush; `sweptBrush` still serves the NIB brush (pen-edge cross-sections).
 */
function sweptRound(center: paper.Path, halfAt: (s: number) => number): paper.PathItem | null {
  const len = center.length;
  if (len <= 0) return null;
  const closed = center.closed;

  // Sample arc-lengths, broken at every node (so trapezoids align with edges and discs
  // land on corners); subdivide only genuinely-curved curves.
  const samples: number[] = [0];
  let acc = 0;
  for (const cv of center.curves) {
    const cl = cv.length;
    if (cl <= 1e-6) continue;
    if (cv.isStraight()) {
      acc += cl;
      samples.push(acc);
    } else {
      const hMid = Math.max(halfAt(acc + cl / 2), 1e-3);
      const k = Math.max(2, Math.ceil(cl / Math.max(hMid / 2, 2)));
      for (let j = 1; j <= k; j += 1) samples.push(acc + (cl * j) / k);
      acc += cl;
    }
  }

  const at = (s: number) => {
    const ss = clamp(s, 0, len);
    const p = center.getPointAt(ss) ?? center.lastSegment.point;
    return { p, h: Math.max(halfAt(ss), 1e-3) };
  };
  const pts = samples.map((s) => ({ s, ...at(s) }));

  const stamps: paper.PathItem[] = [];
  // Per-segment trapezoid (segment-aligned perpendicular → exact straight sides).
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const d = b.p.subtract(a.p);
    const L = d.length;
    if (L <= 1e-6) continue;
    const n = new scope.Point(-d.y, d.x).divide(L);
    const rect = new scope.Path([
      a.p.add(n.multiply(a.h)),
      b.p.add(n.multiply(b.h)),
      b.p.subtract(n.multiply(b.h)),
      a.p.subtract(n.multiply(a.h)),
    ]);
    rect.closed = true;
    stamps.push(rect);
  }
  // A disc at each joint rounds corners/curve-joints. Skip OPEN terminals (kept flat;
  // the cap pass shapes them); the closed seam (s≈0≈len) is covered by its endpoint discs.
  for (const q of pts) {
    if (!closed && (q.s < q.h || len - q.s < q.h)) continue;
    stamps.push(new scope.Path.Circle(q.p, q.h));
  }
  return uniteAll(stamps);
}

/** Union a set of paths into one region via a balanced divide-and-conquer reduce
 *  (O(N) booleans, log depth) — reliable where uniting an overlapping CompoundPath
 *  with itself is not. Returns null for an empty set. */
function uniteAll(items: paper.PathItem[]): paper.PathItem | null {
  if (items.length === 0) return null;
  let layer = items;
  while (layer.length > 1) {
    const next: paper.PathItem[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const a = layer[i]!;
      const b = layer[i + 1];
      next.push(b ? a.unite(b, { insert: false }) : a);
    }
    layer = next;
  }
  return layer[0]!;
}

/** A large rectangle covering the half-plane on the `outward` side of the line through
 *  `p` (⟂ `outward`) — subtract it to cut a terminal flat. */
function terminalCut(p: paper.Point, outward: paper.Point, big: number): paper.Path {
  const o = outward.normalize();
  const perp = new scope.Point(-o.y, o.x).multiply(big);
  const a = p.add(perp);
  const b = p.subtract(perp);
  const rect = new scope.Path([a, b, b.add(o.multiply(big)), a.add(o.multiply(big))]);
  rect.closed = true;
  return rect;
}

/**
 * Re-cut a terminal flat along a CAP-ANGLE handle: extend the body past the node along
 * the tangent (so there is material on both sides of the cut), then slice it at the
 * plane through the node ⟂ the handle axis. The flat butt then tracks the handle
 * direction instead of the path tangent. `outwardTan` is the outward unit tangent at
 * the terminal, `axisDir` the handle vector, `half` the terminal half-width.
 */
function angledTerminal(
  body: paper.PathItem,
  p: paper.Point,
  outwardTan: paper.Point,
  axisDir: paper.Point,
  half: number,
  big: number,
): paper.PathItem {
  const tan = outwardTan.normalize();
  const perp = new scope.Point(-tan.y, tan.x).multiply(half);
  const back = p.add(tan.multiply(-half)); // overlap inward for a solid union
  const fore = p.add(tan.multiply(half * 3)); // overshoot so the slant has material
  const ext = new scope.Path([back.add(perp), back.subtract(perp), fore.subtract(perp), fore.add(perp)]);
  ext.closed = true;
  // Slice at the handle plane: its outward normal is the handle axis oriented to agree
  // with the outward tangent, so everything past the node along the handle is removed.
  const axisOut = axisDir.dot(tan) >= 0 ? axisDir : axisDir.multiply(-1);
  return body.unite(ext, { insert: false }).subtract(terminalCut(p, axisOut, big), { insert: false });
}

/** Intersection of the lines through `p1` (dir `d1`) and `p2` (dir `d2`), or null
 *  when (near-)parallel. */
function lineIntersect(
  p1: paper.Point,
  d1: paper.Point,
  p2: paper.Point,
  d2: paper.Point,
): paper.Point | null {
  const denom = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(denom) < 1e-9) return null;
  const a = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / denom;
  return p1.add(d1.multiply(a));
}

/**
 * Add a per-end cap by uniting a cap shape onto the butt-capped body: `round`
 * unions a disc at the endpoint (or, with `roundAtNode`, carves the tip back so the
 * far edge sits ON the node — see below); `rectangle` unions a parametric box whose
 * FAR edge sits on the node and which grows INWARD up the stem (see rectCap); `butt`
 * adds nothing.
 */
function withCap(
  body: paper.PathItem,
  cap: StrokeCap,
  point: paper.Point,
  t: paper.Point,
  r: number,
  rect: RectCapStyle | null | undefined,
  roundAtNode: boolean | undefined,
  center: paper.Path,
  terminalAtStart: boolean,
): paper.PathItem {
  if (cap === "round") {
    if (roundAtNode) {
      // Far edge ON the node: round the flat butt terminal back into a dome whose apex
      // is the node, so nothing projects past it. The corners to remove are the last
      // `r` of the REAL body (curved or not) lying OUTSIDE the inward disc whose apex
      // reaches the node. Carving against `body ∩ term` (not the bare straight box)
      // follows the actual body, so a wide/curved terminal rounds cleanly and the cut
      // can never reach a distant/opposite part of the stroke (which removed whole caps).
      const inward = t.multiply(-r);
      const perp = new scope.Point(-t.y, t.x).multiply(r);
      const boxFar = point;
      const boxNear = point.add(inward);
      const term = new scope.Path([
        boxFar.add(perp),
        boxFar.subtract(perp),
        boxNear.subtract(perp),
        boxNear.add(perp),
      ]);
      term.closed = true;
      const disc = new scope.Path.Circle(boxNear, r); // apex reaches the node
      const lunes = body.intersect(term, { insert: false }).subtract(disc, { insert: false });
      return body.subtract(lunes, { insert: false });
    }
    const disc = new scope.Path.Circle(point, r);
    return body.unite(disc, { insert: false });
  }
  if (cap === "rectangle") {
    const style = rect ?? DEFAULT_RECT;
    if (style.variant === "b") return rectFlareB(body, point, t, r, style, center, terminalAtStart);
    // A (crisp): union the slab, then slice off any body projecting past the far-edge
    // plane (⟂ axis) — so a tilted/narrow slab can't leave the butt corners sticking
    // out. For the auto case (far edge on the node ⟂ tangent) the body ends at the node,
    // so the cut removes nothing → byte-identical to the old union-box.
    const big = body.bounds.width + body.bounds.height + r * 4 + 100;
    return body
      .unite(rectCap(point, t, r, style), { insert: false })
      .subtract(rectFarCut(point, t, style, big), { insert: false });
  }
  return body; // butt — offsetStroke already capped flat
}

/** The outward foot/cap axis: a world `angleDeg` oriented to agree with the outward
 *  tangent, or the tangent itself when no angle is set. Shared by serif/rect caps. */
function footAxis(outwardTan: paper.Point, angleDeg: number | null | undefined): paper.Point {
  const tan = outwardTan.normalize();
  if (angleDeg == null) return tan;
  const a = new scope.Point(Math.cos((angleDeg * Math.PI) / 180), Math.sin((angleDeg * Math.PI) / 180));
  return a.dot(tan) >= 0 ? a : a.multiply(-1);
}

/**
 * The CONSTRUCTIVE foot hull shared by serif-B and rectangle-B: a flat far edge of
 * half-widths `halfL`/`halfR` (⟂ `axis`) at `proj` past the node, joined to the stem
 * edges (±`r`, `reach` up the stem) by concave fillets scaled by `bracket` (0 = a
 * straight trapezoid). Because it's constructed — not an offset of a kinked angled
 * centerline — it can't notch on a curved/steeply-angled stem (algorithm A's failure).
 * The "close across the stem" edge is interior to the body, so the union is seamless.
 */
function constructiveFootHull(
  point: paper.Point,
  outwardTan: paper.Point,
  axis: paper.Point,
  r: number,
  halfL: number,
  halfR: number,
  reach: number,
  proj: number,
  bracket: number,
  center: paper.Path,
  terminalAtStart: boolean,
): paper.Path {
  const tan = outwardTan.normalize();
  const perpFoot = new scope.Point(-axis.y, axis.x);
  const hug = bracket > 0 ? lerp(0.2, 0.7, bracket) : 0; // concave fillet depth (0 = straight)

  const farCenter = point.add(axis.multiply(proj));
  const farL = farCenter.add(perpFoot.multiply(halfL));
  const farR = farCenter.subtract(perpFoot.multiply(halfR));

  // Anchor the stem ends on the ACTUAL centerline outline `reach` up the stem and leave
  // along the LOCAL stem tangent — so the bracket meets a curved (or straight) stem
  // tangentially (seamless). Fall back to a straight projection if sampling fails.
  const up = clamp(terminalAtStart ? reach : center.length - reach, 0, center.length);
  const stemPt = center.getPointAt(up);
  const stemTan = center.getTangentAt(up);
  let stemL: paper.Point;
  let stemR: paper.Point;
  let stemDir: paper.Point; // outward (toward the terminal), tangent to the local stem
  if (stemPt && stemTan) {
    stemDir = (terminalAtStart ? stemTan.multiply(-1) : stemTan).normalize();
    const sp = new scope.Point(-stemDir.y, stemDir.x);
    stemL = stemPt.add(sp.multiply(r));
    stemR = stemPt.subtract(sp.multiply(r));
  } else {
    const inward = tan.multiply(-1);
    const perpStem = new scope.Point(-tan.y, tan.x);
    stemL = point.add(inward.multiply(reach)).add(perpStem.multiply(r));
    stemR = point.add(inward.multiply(reach)).subtract(perpStem.multiply(r));
    stemDir = tan;
  }

  const down = stemDir.multiply(reach * hug); // leave the stem along its local tangent
  const back = axis.multiply(-proj * hug); // arrive at the foot corner heading toward the node
  const z = new scope.Point(0, 0);

  const hull = new scope.Path([
    new scope.Segment(stemR, z, down),
    new scope.Segment(farR, back, z),
    new scope.Segment(farL, z, back),
    new scope.Segment(stemL, down, z),
  ]);
  hull.closed = true;
  return hull;
}

/**
 * Rectangle variant "b": a SEAMLESS constructive slab — the stem flares (concave) out
 * to a flat slab edge of half-width `ratio·r`, projecting `size` past the node when
 * `anchor:"outward"` (else the far edge sits at the node). Joins the body with no union
 * seam and rides curved/angled stems gracefully (the alternative to A's crisp re-cut).
 */
function rectFlareB(
  body: paper.PathItem,
  point: paper.Point,
  outwardTan: paper.Point,
  r: number,
  style: RectCapStyle,
  center: paper.Path,
  terminalAtStart: boolean,
): paper.PathItem {
  const axis = footAxis(outwardTan, style.angle);
  const halfW = Math.max(r * Math.max(style.ratio, 0.01), 0.01);
  const depth = Math.max(style.size, r);
  const proj = (style.anchor ?? "node") === "outward" ? depth : 0;
  const maxReach = Math.min(body.bounds.width + body.bounds.height, center.length);
  const reach = clamp(style.reach ?? Math.max(depth * 0.6, r), 1, maxReach);
  const hull = constructiveFootHull(point, outwardTan, axis, r, halfW, halfW, reach, proj, 0.5, center, terminalAtStart);
  return body.unite(hull, { insert: false });
}

/** The half-plane to slice off body material projecting PAST a rectangle slab's far
 *  edge (⟂ the cap axis), so a tilted/narrow slab can't leave the stem's butt corners
 *  sticking out. Used by the rectangle-A (crisp) cap. */
function rectFarCut(
  point: paper.Point,
  outwardTan: paper.Point,
  style: RectCapStyle,
  big: number,
): paper.Path {
  const axis = footAxis(outwardTan, style.angle);
  const depth = Math.max(style.size, 0);
  const farCenter = (style.anchor ?? "node") === "outward" ? point.add(axis.multiply(depth)) : point;
  const perp = new scope.Point(-axis.y, axis.x).multiply(big);
  const out = axis.multiply(big);
  const plane = new scope.Path([
    farCenter.add(perp),
    farCenter.subtract(perp),
    farCenter.subtract(perp).add(out),
    farCenter.add(perp).add(out),
  ]);
  plane.closed = true;
  return plane;
}

/**
 * Build the `rectangle` cap shape. The FAR edge lies on `point` (the node) and the
 * box extends INWARD along `-t` (`t` is the outward unit tangent), so the cap never
 * projects past the terminal. `size` = inward depth; `ratio` scales the cross half-
 * width relative to the stroke half-width `r`; `radius` (0–1) rounds the two NEAR
 * (inward) corners with kappa arcs.
 *
 * `angle` is the cap's AXIS (point-handle) direction: undefined = auto (along the
 * path tangent `t`); a number = WORLD-ABSOLUTE degrees from the canvas X axis. The
 * WHOLE cap rotates rigidly about the node with that axis — the flat far edge stays
 * perpendicular to the axis. The cap always extrudes toward the stroke (the inward
 * sign is picked from `t`), so it can never detach into a floating box.
 */
function rectCap(
  point: paper.Point,
  t: paper.Point,
  r: number,
  style: RectCapStyle,
): paper.Path {
  const depth = Math.max(style.size, 0);
  const halfW = Math.max(r * Math.max(style.ratio, 0.01), 0.01);
  // Cap axis (point-handle direction): the path tangent in auto, else the world
  // angle. The flat far edge is perpendicular to it; the cap rotates rigidly.
  const axis =
    style.angle == null
      ? t
      : new scope.Point(
          Math.cos((style.angle * Math.PI) / 180),
          Math.sin((style.angle * Math.PI) / 180),
        );
  const edgeDir = new scope.Point(-axis.y, axis.x); // ⟂ axis (the flat edge direction)
  const perp = edgeDir.multiply(halfW);
  // The axis, oriented to point AWAY from the stroke (outward).
  const outwardUnit = axis.dot(t) > 0 ? axis : axis.multiply(-1);
  // `node` (default): the flat edge sits on the node and the box extrudes INWARD up
  // the stem. `outward`: the box projects PAST the node — keep a small inward overlap
  // (so it unions solidly with the stem's butt terminal instead of just touching).
  const outward = (style.anchor ?? "node") === "outward";
  const tipUnit = outward ? outwardUnit : outwardUnit.multiply(-1);
  const overlap = outward ? Math.min(Math.max(r, 1), depth || Math.max(r, 1)) : 0;
  const cBase = point.subtract(tipUnit.multiply(overlap)); // the on-stem (base) edge
  const cTip = point.add(tipUnit.multiply(depth)); // the exposed tip edge
  const baseA = cBase.add(perp);
  const baseB = cBase.subtract(perp);
  const tipA = cTip.add(perp);
  const tipB = cTip.subtract(perp);

  const radius = clamp(style.radius ?? 0, 0, 1);
  if (radius <= 0 || depth <= 0) {
    const rect = new scope.Path([baseA, tipA, tipB, baseB]);
    rect.closed = true;
    return rect;
  }
  // Round the two exposed TIP corners: cut back along each edge by `cut` and bridge
  // with a kappa (quarter-arc) bezier. Bound `cut` so a thin/shallow cap can't
  // over-round (cut must stay under the depth and the half-width).
  const cut = Math.min(radius * Math.min(depth, halfW), depth * 0.99, halfW * 0.99);
  const k = 0.5523 * cut;
  const along = tipUnit.multiply(-cut); // from the tip back toward the base
  const acrossA = tipB.subtract(tipA).normalize(cut); // tip edge, A→B
  const seg = (pt: paper.Point, hIn?: paper.Point, hOut?: paper.Point) =>
    new scope.Segment(pt, hIn, hOut);
  const k1 = along.multiply(k / cut);
  const k2 = acrossA.multiply(k / cut);
  const cap = new scope.Path([
    seg(baseA),
    seg(tipA.add(along), undefined, k1.multiply(-1)), // approach tip corner A
    seg(tipA.add(acrossA), k2.multiply(-1), undefined), // leave toward B
    seg(tipB.subtract(acrossA), undefined, k2), // approach tip corner B
    seg(tipB.add(along), k1.multiply(-1), undefined), // leave toward base edge
    seg(baseB),
  ]);
  cap.closed = true;
  return cap;
}

