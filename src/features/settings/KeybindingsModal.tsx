import { useEffect, useState } from "react";
import {
  commandsInGroup,
  effectiveKeys,
  commandUsing,
  formatChord,
  sameChord,
} from "../../commands";
import { useKeybindingStore } from "../../state/keybindingStore";
import type { KeyChord } from "../../commands/types";

/**
 * The keyboard-shortcuts editor. Lists every command (grouped) with its current
 * binding and lets the user rebind, reset one, or reset all. Rebinding captures a
 * single chord; while capturing, the global handler stands down (keybindingStore
 * `capturing`). Esc cancels; Enter/Tab are ignored (reserved). A chord already in
 * use is reassigned away from its old command so bindings stay unique. Overrides
 * persist via the settings file (v2).
 */

interface Props {
  open: boolean;
  onClose: () => void;
}

const GROUPS: { id: string; label: string }[] = [
  { id: "edit", label: "Edit" },
  { id: "file", label: "File" },
  { id: "view", label: "View" },
  { id: "tool", label: "Tools" },
];

/** Lone modifier presses don't form a chord on their own. */
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

function chordFromEvent(e: KeyboardEvent): KeyChord {
  const chord: KeyChord = { key: e.key.length === 1 ? e.key.toLowerCase() : e.key };
  if (e.ctrlKey || e.metaKey) chord.mod = true;
  if (e.shiftKey) chord.shift = true;
  if (e.altKey) chord.alt = true;
  return chord;
}

export function KeybindingsModal({ open, onClose }: Props) {
  const overrides = useKeybindingStore((s) => s.overrides);
  const setOverride = useKeybindingStore((s) => s.setOverride);
  const clearOverride = useKeybindingStore((s) => s.clearOverride);
  const resetAll = useKeybindingStore((s) => s.resetAll);
  const setCapturing = useKeybindingStore((s) => s.setCapturing);

  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // While capturing, listen (capture phase) for the chord to assign.
  useEffect(() => {
    if (!capturingId) return;
    setCapturing(true);

    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (MODIFIER_KEYS.has(e.key)) return; // wait for a real key
      if (e.key === "Escape") {
        setCapturingId(null);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") return; // reserved — ignore

      const chord = chordFromEvent(e);
      const conflict = commandUsing(chord, capturingId);
      if (conflict) {
        // Take the chord away from its current owner so bindings stay unique.
        setOverride(
          conflict.id,
          effectiveKeys(conflict).filter((k) => !sameChord(k, chord)),
        );
        setNote(`Reassigned ${formatChord(chord)} from “${conflict.label}”.`);
      } else {
        setNote(null);
      }
      setOverride(capturingId, [chord]);
      setCapturingId(null);
    };

    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      setCapturing(false);
    };
  }, [capturingId, setCapturing, setOverride]);

  // Drop capture/notes when the modal closes.
  useEffect(() => {
    if (!open) {
      setCapturingId(null);
      setNote(null);
    }
  }, [open]);

  if (!open) return null;

  const close = () => {
    setCapturingId(null);
    onClose();
  };

  return (
    <div className="modal-overlay" role="presentation" onClick={close}>
      <div
        className="keybind-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="export-modal-title">Keyboard shortcuts</h2>
        {note && <p className="keybind-note">{note}</p>}

        <div className="keybind-list">
          {GROUPS.map((group) => {
            const cmds = commandsInGroup(group.id);
            if (cmds.length === 0) return null;
            return (
              <div key={group.id} className="keybind-group">
                <span className="keybind-group-title">{group.label}</span>
                {cmds.map((cmd) => {
                  const keys = effectiveKeys(cmd);
                  const overridden = cmd.id in overrides;
                  const capturing = capturingId === cmd.id;
                  return (
                    <div key={cmd.id} className="keybind-row">
                      <span className="keybind-label">{cmd.label}</span>
                      <span className={`keybind-chip${capturing ? " is-capturing" : ""}`}>
                        {capturing
                          ? "Press keys…"
                          : keys.length
                            ? keys.map(formatChord).join(" / ")
                            : "—"}
                      </span>
                      <button
                        type="button"
                        className="btn keybind-btn"
                        onClick={() => setCapturingId(capturing ? null : cmd.id)}
                      >
                        {capturing ? "Cancel" : "Rebind"}
                      </button>
                      <button
                        type="button"
                        className="btn keybind-btn"
                        disabled={!overridden}
                        onClick={() => clearOverride(cmd.id)}
                      >
                        Reset
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="export-actions">
          <button type="button" className="btn" onClick={() => resetAll()}>
            Reset all
          </button>
          <button type="button" className="btn export-confirm" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
