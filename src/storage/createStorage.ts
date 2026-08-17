import type { StorageService } from "./StorageService";
import { LocalForageStorage } from "./LocalForageStorage";
import { isTauri } from "./platform";

let instance: StorageService | null = null;

/**
 * Resolve the platform-appropriate StorageService (memoized). On desktop the
 * Tauri adapter is pulled in via dynamic import so the web bundle never
 * references @tauri-apps at all.
 */
export async function createStorage(): Promise<StorageService> {
  if (instance) return instance;
  if (isTauri()) {
    const { TauriStorage } = await import("./TauriStorage");
    instance = new TauriStorage();
  } else {
    instance = new LocalForageStorage();
  }
  return instance;
}

/** Synchronous accessor once createStorage() has resolved at startup. */
export function getStorage(): StorageService {
  if (!instance) {
    throw new Error("Storage not initialised — await createStorage() first.");
  }
  return instance;
}
