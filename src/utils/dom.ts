/**
 * True when the event target is a text-entry surface where typing should win
 * over global shortcuts (e.g. a layer-rename input). The single source for this
 * check, shared by the command keyboard handler and the tool controller, so the
 * two listeners agree on when to stand down.
 */
export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}
