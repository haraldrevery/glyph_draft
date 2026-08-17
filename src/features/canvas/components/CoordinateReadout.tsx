import type { Vec2 } from "../../../types/viewport";

/**
 * Live cursor position in font units, with the snapped target shown when
 * snap-to-grid is on. This makes the snapping behavior tangible and testable in
 * Phase 1, before there is any geometry to draw.
 */
export function CoordinateReadout({
  raw,
  snapped,
  snapOn,
}: {
  raw: Vec2 | null;
  snapped: Vec2 | null;
  snapOn: boolean;
}) {
  return (
    <div className="coord-readout" role="status" aria-live="off">
      {raw ? (
        <>
          <span className="coord">
            x <b>{Math.round(raw.x)}</b> y <b>{Math.round(raw.y)}</b>
          </span>
          {snapOn && snapped && (
            <span className="coord snapped">
              snap <b>{Math.round(snapped.x)}</b>, <b>{Math.round(snapped.y)}</b>
            </span>
          )}
        </>
      ) : (
        <span className="coord muted">move over the canvas</span>
      )}
    </div>
  );
}
