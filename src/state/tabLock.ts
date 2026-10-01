/**
 * Single-writer guard for the autosaved workspace (web).
 *
 * Every tab of the app autosaves the WHOLE document to the same storage key, so two
 * open tabs silently overwrite each other — an old tab left open would replace newer
 * work, then rotate it out of the backup on its next save. A tab therefore claims the
 * workspace with a Web Lock held for the page's lifetime; a tab that can't get it
 * still opens (read-only in effect) but must not save.
 *
 * Waits briefly rather than failing instantly, so a RELOAD (where the previous page
 * may release its lock a moment after this one starts) still gets ownership.
 * Without Web Locks (very old browsers, the node test environment) it reports
 * ownership, i.e. exactly the previous behaviour.
 */

const LOCK_NAME = "glyphdraft:workspace";
const WAIT_MS = 2000;

interface LockManagerLike {
  request(
    name: string,
    options: { signal?: AbortSignal },
    callback: (lock: unknown) => Promise<void>,
  ): Promise<unknown>;
}

export function claimWorkspace(): Promise<boolean> {
  const locks = (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks;
  if (!locks || typeof locks.request !== "function") return Promise.resolve(true);

  return new Promise((resolve) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), WAIT_MS);
    locks
      .request(LOCK_NAME, { signal: ctrl.signal }, () => {
        clearTimeout(timer);
        resolve(true);
        return new Promise<void>(() => undefined); // never settles: hold until unload
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(false); // aborted after WAIT_MS: another tab owns the workspace
      });
  });
}
