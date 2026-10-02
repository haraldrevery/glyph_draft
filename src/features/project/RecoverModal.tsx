import { useEffect, useState } from "react";
import { useEscapeKey } from "../../components/useEscapeKey";
import { listRecoveryPoints, type RecoveryPoint } from "./projectActions";

interface RecoverModalProps {
  open: boolean;
  onClose: () => void;
  /** The user picked a point; the caller confirms and performs the replacement. */
  onPick: (point: RecoveryPoint) => void;
}

/**
 * File → Restore previous version…: the stored recovery points (start of this session, start of the
 * previous one, before the last import/restore). Picking one hands it to the same
 * confirm-and-replace flow as Import project, which first keeps the current workspace
 * as the "before the last import / restore" point — so a restore can itself be undone.
 */
export function RecoverModal({ open, onClose, onPick }: RecoverModalProps) {
  const [points, setPoints] = useState<RecoveryPoint[] | null>(null);
  useEscapeKey(open, onClose);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setPoints(null);
    listRecoveryPoints()
      .then((p) => live && setPoints(p))
      .catch(() => live && setPoints([]));
    return () => {
      live = false;
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="confirm-dialog recover-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Restore a previous workspace"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <p className="confirm-message">Restore a previous version of the whole workspace:</p>
        {points === null ? (
          <p className="recover-empty">Looking…</p>
        ) : points.length === 0 ? (
          <p className="recover-empty">No recovery points yet — one is kept each time the app starts.</p>
        ) : (
          <ul className="recover-list">
            {points.map((p) => (
              <li key={p.key}>
                <button type="button" className="btn recover-item" onClick={() => onPick(p)}>
                  <span>{p.label}</span>
                  <span className="recover-meta">
                    {p.savedAt ? formatWhen(p.savedAt) : "—"} · {p.glyphCount} glyph{p.glyphCount === 1 ? "" : "s"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="confirm-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function formatWhen(epochMs: number): string {
  return new Date(epochMs).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
