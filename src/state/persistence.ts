import { create } from "zustand";
import type { Glyph } from "../types/document";
import { createStorage } from "../storage/createStorage";
import { useDocumentStore } from "./documentStore";
import { useHistoryStore } from "./history";
import {
  STORAGE_KEY,
  BACKUP_KEY,
  CORRUPT_KEY,
  serializeProject,
  migrate,
  type ProjectFile,
} from "../storage/projectFile";

/**
 * Document persistence: load the saved project on launch, then keep it saved.
 * Single auto-persisted workspace (one document = all glyphs). Two triggers,
 * both routed through writeNow():
 *   - autosave: debounced on every glyph change (survives refresh/crash);
 *   - explicit: saveNow() from File → Save.
 *
 * Corruption safety: each write keeps the previous main as a backup
 * (double-buffer; the KV layer has no atomic rename), load validates via
 * migrate() and falls back main → backup → in-memory seed, and an unreadable
 * blob is parked under CORRUPT_KEY rather than discarded. Nothing here throws
 * into the UI; failures surface through the save-status store.
 */

type SaveState = "idle" | "saving" | "saved" | "error";

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
let ready = false;
let timer: ReturnType<typeof setTimeout> | null = null;

async function writeNow(): Promise<void> {
  useSaveStatus.setState({ state: "saving", error: null });
  try {
    const storage = await createStorage();
    const payload = serializeProject(useDocumentStore.getState().glyphs);
    // Double-buffer: promote the current main to backup before overwriting it,
    // so a failed/garbage write still leaves a recoverable previous version.
    const prev = await storage.getItem<ProjectFile>(STORAGE_KEY);
    if (prev) await storage.setItem(BACKUP_KEY, prev);
    await storage.setItem(STORAGE_KEY, payload);
    useSaveStatus.setState({
      state: "saved",
      savedAt: payload.savedAt,
      error: null,
    });
  } catch (err) {
    useSaveStatus.setState({
      state: "error",
      error: err instanceof Error ? err.message : "Save failed",
    });
  }
}

function scheduleSave(): void {
  if (!ready) return; // never write the seed before the initial load completes
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void writeNow();
  }, DEBOUNCE_MS);
}

/** Flush any pending autosave and write immediately (explicit File → Save). */
export async function saveNow(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await writeNow();
}

/** Load the saved project (if any) and start autosaving. Call once at startup. */
export async function initPersistence(): Promise<void> {
  let loaded: Record<string, Glyph> | null = null;
  try {
    const storage = await createStorage();
    const main = await storage.getItem<unknown>(STORAGE_KEY);
    loaded = migrate(main);
    if (!loaded) {
      // Main is missing or corrupt: park the unreadable blob, then try backup.
      if (main != null) {
        try {
          await storage.setItem(CORRUPT_KEY, main);
        } catch {
          /* parking the corrupt blob is best-effort */
        }
      }
      loaded = migrate(await storage.getItem<unknown>(BACKUP_KEY));
    }
  } catch {
    loaded = null; // storage unavailable — fall through to the in-memory seed
  }

  if (loaded) {
    useDocumentStore.getState().loadGlyphs(loaded);
    // The restored document is the baseline, not an undoable step.
    useHistoryStore.getState().clear();
    useSaveStatus.setState({ state: "saved", savedAt: Date.now(), error: null });
  }

  ready = true;

  // Persist on every document-content change; identity of `glyphs` changes per edit.
  useDocumentStore.subscribe((s, prev) => {
    if (s.glyphs !== prev.glyphs) scheduleSave();
  });
}
