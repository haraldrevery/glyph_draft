/**
 * The command model. A Command is a named, parameter-free action with optional
 * default keybindings and enable/visibility predicates. This is the single
 * source of truth that the global keyboard handler, right-click menus, and (in a
 * later phase) the keybind editor all read from — so an action is defined once
 * and surfaced everywhere consistently.
 */

/** A keyboard chord. `mod` means Ctrl (Win/Linux) OR Cmd (macOS). */
export interface KeyChord {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface Command {
  id: string;
  label: string;
  /** Logical grouping (e.g. "edit", "file", "tool") for menu construction. */
  group?: string;
  /** Default bindings. Multiple chords map to one command (e.g. Redo). The array
   *  is the seam a future keybind editor overlays user overrides onto. */
  defaultKeys?: KeyChord[];
  run: () => void;
  /** When false, the command is shown disabled and never fires. */
  isEnabled?: () => boolean;
  /** When false, the command is hidden from menus entirely. */
  isVisible?: () => boolean;
}
