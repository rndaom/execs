import { describe, expect, it, vi } from "vitest";
import type { Api } from "./api";
import { type WriteLockState, watchWriteLock } from "./write-lock-ui";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function fixture() {
  const sample = deferred<Awaited<ReturnType<Api["getTf2WriteLock"]>>>();
  const runningReady = deferred<() => void>();
  const healthReady = deferred<() => void>();
  let emitRunning!: (next: boolean) => void;
  let emitUnavailable!: () => void;
  const api = {
    getTf2WriteLock: vi.fn(() => sample.promise),
    onTf2Running: vi.fn((handler: (next: boolean) => void) => {
      emitRunning = handler;
      return runningReady.promise;
    }),
    onTf2LockUnavailable: vi.fn((handler: () => void) => {
      emitUnavailable = handler;
      return healthReady.promise;
    }),
  };
  const states: WriteLockState[] = [];
  const stop = watchWriteLock(api, (state) => states.push(state));
  const unlistenRunning = vi.fn();
  const unlistenHealth = vi.fn();
  return {
    api,
    sample,
    runningReady,
    healthReady,
    states,
    stop,
    emitRunning: (next: boolean) => emitRunning(next),
    emitUnavailable: () => emitUnavailable(),
    unlistenRunning,
    unlistenHealth,
    async ready() {
      runningReady.resolve(unlistenRunning);
      healthReady.resolve(unlistenHealth);
      await settle();
    },
    latest: () => states[states.length - 1],
  };
}

const unlocked = { running: false } as Awaited<ReturnType<Api["getTf2WriteLock"]>>;

describe("write lock subscription lifecycle", () => {
  it.each(["running", "health"])("latches a failed %s subscription closed", async (source) => {
    const f = fixture();
    if (source === "running") f.runningReady.reject(new Error("offline"));
    else f.healthReady.reject(new Error("offline"));
    await settle();
    await f.ready();
    f.sample.resolve(unlocked);
    f.emitRunning(false);
    await settle();
    expect(f.latest()).toMatchObject({ running: true, quitNonce: 0 });
    expect(f.latest().degraded).toContain("disabled for safety");
    expect(f.api.getTf2WriteLock).not.toHaveBeenCalled();
    f.stop();
  });

  it("retains failure when an old boot sample and later events arrive", async () => {
    const f = fixture();
    await f.ready();
    expect(f.api.getTf2WriteLock).toHaveBeenCalledOnce();
    f.emitUnavailable();
    f.sample.resolve(unlocked);
    f.emitRunning(false);
    await settle();
    expect(f.latest()).toMatchObject({ running: true, quitNonce: 0 });
    expect(f.latest().degraded).toContain("no longer watch");
    f.stop();
  });

  it("keeps a newer running event over a stale unlocked sample", async () => {
    const f = fixture();
    await f.ready();
    f.emitRunning(true);
    f.sample.resolve(unlocked);
    await settle();
    expect(f.latest()).toEqual({ running: true, quitNonce: 0, degraded: null });
    f.emitRunning(false);
    f.emitRunning(false);
    expect(f.latest()).toEqual({ running: false, quitNonce: 1, degraded: null });
    f.stop();
  });

  it("stays locked until both listeners register and absorbs an initial closed sample", async () => {
    const f = fixture();
    f.sample.resolve(unlocked);
    f.runningReady.resolve(f.unlistenRunning);
    await settle();
    expect(f.latest().running).toBe(true);
    expect(f.api.getTf2WriteLock).not.toHaveBeenCalled();
    await f.ready();
    expect(f.latest()).toEqual({ running: false, quitNonce: 1, degraded: null });
    f.stop();
  });

  it("fails closed on a boot-read failure even after later events", async () => {
    const f = fixture();
    await f.ready();
    f.sample.reject(new Error("unavailable"));
    await settle();
    f.emitRunning(false);
    expect(f.latest().running).toBe(true);
    expect(f.latest().degraded).toContain("Could not read");
    f.stop();
  });

  it("ignores cancelled callbacks and releases listeners registered after cleanup", async () => {
    const f = fixture();
    f.stop();
    const count = f.states.length;
    f.emitRunning(false);
    f.emitUnavailable();
    await f.ready();
    expect(f.states).toHaveLength(count);
    expect(f.unlistenRunning).toHaveBeenCalledOnce();
    expect(f.unlistenHealth).toHaveBeenCalledOnce();
    expect(f.api.getTf2WriteLock).not.toHaveBeenCalled();
  });

  it("ignores an in-flight sample after cleanup", async () => {
    const f = fixture();
    await f.ready();
    f.stop();
    const count = f.states.length;
    f.sample.resolve(unlocked);
    f.emitRunning(false);
    await settle();
    expect(f.states).toHaveLength(count);
    expect(f.unlistenRunning).toHaveBeenCalledOnce();
    expect(f.unlistenHealth).toHaveBeenCalledOnce();
  });
});
