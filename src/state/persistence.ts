import { create } from "zustand";
import type { Glyph } from "../types/document";
import { createStorage } from "../storage/createStorage";
import { CorruptValueError, type StorageService } from "../storage/StorageService";
import { useDocumentStore } from "./documentStore";
import { useHistoryStore } from "./history";
import { claimWorkspace } from "./tabLock";
import {
  STORAGE_KEY,
  BACKUP_KEY,
  CORRUPT_KEY,
  SESSION_KEY,
  SESSION_PREV_KEY,
  serializeProject,
  migrate,
} from "../storage/projectFile";

/**
 * Document persistence: load the saved project on launch, then keep it saved.
 * Single auto-persisted workspace (one document = all glyphs). Two triggers,
 * both routed through the write queue:
 *   - autosave: debounced on every glyph change, flushed when the page is hidden;
 *   - explicit: saveNow() from File → Save.
 *
 * Corruption safety:
 *  - Each write promotes the previous main to the backup slot — but only when that
 *    main is itself a VALID project, so a corrupt main can never overwrite a good
 *    backup. (Desktop writes are additionally atomic: see TauriStorage.setItem.)
 *  - Load distinguishes three failure kinds, because they need opposite handling:
 *      missing    → nothing to lose; fall through to the backup / seed.
 *      invalid    → a value is there but unusable (corrupt, truncated, unknown
 *                   version): PARK it under a corrupt key, then use the backup.
 *      unreadable → the read itself failed (I/O). The data may be perfectly fine,
 *                   so autosave is PAUSED — writing now would replace the real
 *                   document with whatever is on screen.
 *  - Writes are serialized, so an autosave and an explicit save never interleave.
 *  - Recovery points (File → Restore previous version…): each launch keeps the loaded workspace as the
 *    "session" snapshot (the previous one rotating to "session.prev"), outside the
 *    autosave rotation — so a non-undoable mistake (deleting a glyph) stays recoverable.
 *  - Only ONE tab may write (tabLock.ts); a second tab opens but doesn't save.
 * Nothing here throws into the UI; failures surface through the save-status store.
 */

type SaveState = "idle" | "saving" | "saved" | "error" | "paused";

interface SaveStatus {
  state: SaveState;
  /** Epoch ms of the last successful save, or null. */
  savedAt: number | null;
  error: string | null;
}

/** Header indicator reads this; updated only from the functions below. */
export const useSaveStatus = create<SaveStatus>(() => ({
  state: "idle",
  savedAt: null,
  error: null,
}));

const DEBOUNCE_MS = 600;
/** Re-reads of a slot whose read threw an I/O error, before calling it unreadable. */
const READ_ATTEMPTS = 3;
const READ_RETRY_MS = 150;

let ready = false;
/** Why saving is refused this session (null = saving allowed). Never cleared: the
 *  user resolves it by reloading, which re-runs the load with fresh reads. */
let blockedReason: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Tail of the write queue — every write chains onto it so none overlap. */
let writeChain: Promise<void> = Promise.resolve();
let initPromise: Promise<void> | null = null;

type Slot =
  | { kind: "missing" }
  | { kind: "ok"; glyphs: Record<string, Glyph> }
  | { kind: "invalid"; raw: unknown }
  | { kind: "unreadable" };

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function readSlot(storage: StorageService, key: string): Promise<Slot> {
  for (let attempt = 1; ; attempt += 1) {
    let raw: unknown;
    try {
      raw = await storage.getItem<unknown>(key);
    } catch (err) {
      if (err instanceof CorruptValueError) return { kind: "invalid", raw: err.raw };
      if (attempt >= READ_ATTEMPTS) return { kind: "unreadable" };
      await delay(READ_RETRY_MS);
      continue;
    }
    if (raw == null) return { kind: "missing" };
    const glyphs = migrate(raw);
    return glyphs ? { kind: "ok", glyphs } : { kind: "invalid", raw };
  }
}

/** Park an unusable value so it is never silently lost. A previous parked value is
 *  kept: a second corruption goes to a timestamped key instead of overwriting it. */
async function park(storage: StorageService, raw: unknown): Promise<void> {
  try {
    const existing = await storage.getItem<unknown>(CORRUPT_KEY).catch(() => null);
    const key = existing == null ? CORRUPT_KEY : `${CORRUPT_KEY}.${Date.now()}`;
    await storage.setItem(key, raw);
  } catch {
    /* parking is best-effort */
  }
}

/** Is the value currently in the main slot a valid project (safe to promote)? */
async function readPromotable(storage: StorageService): Promise<unknown> {
  try {
    const prev = await storage.getItem<unknown>(STORAGE_KEY);
    return prev != null && migrate(prev) ? prev : null;
  } catch (err) {
    if (err instanceof CorruptValueError) return null; // garbage — don't promote it
    throw err; // I/O failure: abort this save rather than write half-blind
  }
}

async function writeNow(): Promise<void> {
  if (blockedReason) {
    useSaveStatus.setState({ state: "paused", error: blockedReason });
    return;
  }
  useSaveStatus.setState({ state: "saving", error: null });
  try {
    const storage = await createStorage();
    const payload = serializeProject(useDocumentStore.getState().glyphs);
    // Double-buffer: keep the previous good main as the backup before overwriting.
    const prev = await readPromotable(storage);
    if (prev != null) await storage.setItem(BACKUP_KEY, prev);
    await storage.setItem(STORAGE_KEY, payload);
    useSaveStatus.setState({ state: "saved", savedAt: payload.savedAt, error: null });
  } catch (err) {
    useSaveStatus.setState({
      state: "error",
      error: err instanceof Error ? err.message : "Save failed",
    });
  }
}

/** Run a storage task behind any in-flight one, so no two ever interleave. */
function enqueue(task: () => Promise<void>): Promise<void> {
  const run = writeChain.then(task);
  writeChain = run.catch(() => undefined);
  return run;
}

/** Queue a write behind any in-flight one. Each write serializes the document as it
 *  is when the write STARTS, so a queued write always carries the latest state. */
function enqueueWrite(): Promise<void> {
  return enqueue(writeNow);
}

/** Keep the just-loaded workspace as this session's recovery point, rotating the last
 *  session's one to `SESSION_PREV_KEY`. Best-effort: a recovery point must never get in
 *  the way of saving, so every failure is swallowed. */
async function snapshotSession(glyphs: Record<string, Glyph>): Promise<void> {
  try {
    const storage = await createStorage();
    const prev = await storage.getItem<unknown>(SESSION_KEY).catch(() => null);
    if (prev != null && migrate(prev)) await storage.setItem(SESSION_PREV_KEY, prev);
    await storage.setItem(SESSION_KEY, serializeProject(glyphs));
  } catch {
    /* best-effort */
  }
}

function scheduleSave(): void {
  if (!ready) return; // never write the seed before the initial load completes
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void enqueueWrite();
  }, DEBOUNCE_MS);
}

/** Write a pending autosave now (page hidden / closing). No-op when nothing waits. */
function flushPending(): void {
  if (!timer) return;
  clearTimeout(timer);
  timer = null;
  void enqueueWrite();
}

/** Flush any pending autosave and write immediately (explicit File → Save). */
export async function saveNow(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await enqueueWrite();
}

/**
 * Refuse every save for the rest of the session (shown in the header). Used when
 * writing would be unsafe — an unreadable saved project, or another tab owning the
 * workspace. Pending autosaves are dropped.
 */
export function blockSaving(reason: string): void {
  blockedReason = reason;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  useSaveStatus.setState({ state: "paused", error: reason });
}

/** Decide what to load, and whether autosave may overwrite the slots afterwards. */
async function loadSaved(): Promise<{ glyphs: Record<string, Glyph> | null; blocked: string | null }> {
  let storage: StorageService;
  try {
    storage = await createStorage();
  } catch {
    return { glyphs: null, blocked: "storage is unavailable" };
  }

  const main = await readSlot(storage, STORAGE_KEY);
  if (main.kind === "ok") return { glyphs: main.glyphs, blocked: null };
  if (main.kind === "invalid") await park(storage, main.raw);

  const backup = await readSlot(storage, BACKUP_KEY);
  if (backup.kind === "invalid") await park(storage, backup.raw);

  if (main.kind === "unreadable") {
    // The newest save may be intact — never autosave over it. Show the backup if
    // there is one so the user can see (and export) their work.
    return {
      glyphs: backup.kind === "ok" ? backup.glyphs : null,
      blocked: "couldn't read the saved project, so autosave is off to protect it — reload to retry",
    };
  }
  if (backup.kind === "ok") return { glyphs: backup.glyphs, blocked: null };
  if (backup.kind === "unreadable") {
    return {
      glyphs: null,
      blocked: "couldn't read the backup project, so autosave is off to protect it — reload to retry",
    };
  }
  // missing/invalid main + missing/invalid backup: anything unusable is parked, so
  // nothing recoverable is lost by starting fresh.
  return { glyphs: null, blocked: null };
}

/** Load the saved project (if any) and start autosaving. Call once at startup;
 *  repeated calls (e.g. React StrictMode re-running effects) share the first run. */
export function initPersistence(): Promise<void> {
  initPromise ??= init();
  return initPromise;
}

async function init(): Promise<void> {
  // Claim the workspace first, so of two tabs opened together exactly one saves.
  const owner = await claimWorkspace();
  const { glyphs, blocked } = await loadSaved();

  if (glyphs) {
    useDocumentStore.getState().loadGlyphs(glyphs);
    // The restored document is the baseline, not an undoable step.
    useHistoryStore.getState().clear();
    useSaveStatus.setState({ state: "saved", savedAt: Date.now(), error: null });
  }
  if (blocked) blockSaving(blocked);
  else if (!owner) {
    blockSaving("Glyph Draft is open in another tab — edits here won't be saved. Use that tab, or close it and reload this one");
  } else if (glyphs) {
    // Only the tab that may write, and only when the load was trustworthy.
    void enqueue(() => snapshotSession(glyphs));
  }

  ready = true;

  // Persist on every document-content change; identity of `glyphs` changes per edit.
  useDocumentStore.subscribe((s, prev) => {
    if (s.glyphs !== prev.glyphs) scheduleSave();
  });

  // Don't let the debounce window swallow the last edit when the tab is hidden or
  // closed. (On desktop, a JS close hook would need the window-destroy permission —
  // without it the window could not close at all — so this relies on the webview's
  // page events; atomic writes keep a cut-short save from corrupting the file.)
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushPending();
    });
  }
  if (typeof window !== "undefined") window.addEventListener("pagehide", flushPending);
}
