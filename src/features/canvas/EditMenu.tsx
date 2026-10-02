import { Fragment } from "react";
import { MenuItem } from "../../components/menu";
import { commandMenuItems } from "../../commands/registry";

/**
 * The Edit top-bar menu — a VIEW over the command registry (Invariant 8), exactly like
 * the canvas right-click menu: no logic of its own, so a menu click and its shortcut can
 * never do different things. Unlike the right-click menu it keeps commands that don't
 * currently apply (disabled, not hidden), so the menu's layout is stable and every
 * action — with its shortcut — is discoverable without knowing the keys first.
 *
 * Rendered only while the menu is open, so enabled states are read fresh on each open.
 */
const SECTIONS: string[][] = [
  ["edit.undo", "edit.redo"],
  ["edit.cut", "edit.copy", "edit.paste", "edit.duplicate", "edit.delete", "edit.selectAll"],
  ["edit.transform", "edit.flipH", "edit.flipV", "edit.reverse"],
  ["edit.mergeNodes", "edit.smoothNode", "edit.cuspNode", "edit.cornerNode"],
  ["edit.expandStroke"],
];

export function EditMenu() {
  return (
    <>
      {SECTIONS.map((ids, i) => (
        <Fragment key={ids[0]}>
          {i > 0 && <div className="control-divider" aria-hidden="true" />}
          {commandMenuItems(ids, { keepHidden: true }).map((item) => (
            <MenuItem key={item.label} {...item} />
          ))}
        </Fragment>
      ))}
    </>
  );
}
