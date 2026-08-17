import localforage from "localforage";
import type { StorageService } from "./StorageService";

/**
 * Web implementation. LocalForage gives us an async key/value store backed by
 * IndexedDB (falling back to WebSQL/localStorage), which maps 1:1 onto the
 * StorageService contract.
 */
export class LocalForageStorage implements StorageService {
  private readonly store: LocalForage;

  constructor(name = "glyph-draft") {
    this.store = localforage.createInstance({
      name,
      storeName: "documents",
      description: "Glyph Draft documents and application settings",
    });
  }

  async getItem<T>(key: string): Promise<T | null> {
    return (await this.store.getItem<T>(key)) ?? null;
  }

  async setItem<T>(key: string, value: T): Promise<void> {
    await this.store.setItem(key, value);
  }

  async removeItem(key: string): Promise<void> {
    await this.store.removeItem(key);
  }

  async keys(): Promise<string[]> {
    return this.store.keys();
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }
}
