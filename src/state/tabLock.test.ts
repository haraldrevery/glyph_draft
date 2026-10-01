import { describe, it, expect, vi, afterEach } from "vitest";
import { claimWorkspace } from "./tabLock";

/** A minimal in-process Web Locks stand-in: one holder per name, queued waiters. */
function fakeLocks() {
  let held = false;
  return {
    request(_name: string, opts: { signal?: AbortSignal }, cb: (l: unknown) => Promise<void>) {
      return new Promise((resolve, reject) => {
        if (!held) {
          held = true;
          resolve(cb({}));
          return;
        }
        opts.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("claimWorkspace", () => {
  it("the first tab owns the workspace, a second one does not", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { locks: fakeLocks() });
    await expect(claimWorkspace()).resolves.toBe(true);
    const second = claimWorkspace();
    await vi.advanceTimersByTimeAsync(2500);
    await expect(second).resolves.toBe(false);
  });

  it("without Web Locks it behaves as before (owner)", async () => {
    vi.stubGlobal("navigator", {});
    await expect(claimWorkspace()).resolves.toBe(true);
  });
});
