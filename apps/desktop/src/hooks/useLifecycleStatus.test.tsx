// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Api } from "../lib/api";
import type { LifecycleStatus } from "../lib/bridge";
import { useLifecycleStatus } from "./useLifecycleStatus";

const IDLE: LifecycleStatus = {
  launchingTf2: false,
  steamVerification: false,
  installingUpdate: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

let root: ReturnType<typeof createRoot>;
let result: ReturnType<typeof useLifecycleStatus>;
let api: Api;
let getStatus: ReturnType<typeof vi.fn>;
let focused: boolean;
let visible: DocumentVisibilityState;
let renders: number;
let mounted: boolean;

function Harness() {
  result = useLifecycleStatus(api);
  renders += 1;
  return null;
}

async function render() {
  await act(async () => root.render(<Harness />));
}

async function advance(ms: number) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}

async function presence(nextFocused: boolean, nextVisible = visible) {
  focused = nextFocused;
  visible = nextVisible;
  await act(async () => {
    window.dispatchEvent(new Event(nextFocused ? "focus" : "blur"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  focused = true;
  visible = "visible";
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visible);
  getStatus = vi.fn().mockResolvedValue(IDLE);
  api = { getLifecycleStatus: getStatus } as unknown as Api;
  renders = 0;
  root = createRoot(document.createElement("div"));
  mounted = true;
});

afterEach(async () => {
  if (mounted) await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("reads restored maintenance immediately and stays closed until that read finishes", async () => {
  focused = false;
  visible = "hidden";
  const boot = deferred<LifecycleStatus>();
  getStatus.mockReturnValueOnce(boot.promise);
  await render();
  expect(getStatus).toHaveBeenCalledTimes(1);
  expect(result.available).toBe(false);
  await advance(60_000);
  expect(getStatus).toHaveBeenCalledTimes(1);
  await act(async () => boot.resolve({ ...IDLE, steamVerification: true }));
  expect(result.available).toBe(true);
  expect(result.steamVerification).toBe(true);
  await advance(60_000);
  expect(getStatus).toHaveBeenCalledTimes(1);
});

it("backs off idle checks and does not publish identical snapshots on every check", async () => {
  await render();
  await advance(4_999);
  expect(getStatus).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(getStatus).toHaveBeenCalledTimes(2);
  const settledRenders = renders;
  await advance(30_000);
  expect(getStatus).toHaveBeenCalledTimes(8);
  expect(renders).toBe(settledRenders);
});

it.each(["launchingTf2", "steamVerification", "installingUpdate"] as const)(
  "keeps fast checks for an active %s lease and retains it while unfocused",
  async (lease) => {
    getStatus.mockResolvedValue({ ...IDLE, [lease]: true });
    await render();
    await advance(2_000);
    expect(getStatus).toHaveBeenCalledTimes(3);
    expect(result[lease]).toBe(true);
    await presence(false);
    await advance(60_000);
    expect(getStatus).toHaveBeenCalledTimes(3);
    expect(result[lease]).toBe(true);
    const returnRead = deferred<LifecycleStatus>();
    getStatus.mockReturnValueOnce(returnRead.promise);
    await presence(true);
    expect(getStatus).toHaveBeenCalledTimes(4);
    expect(result.available).toBe(false);
    expect(result[lease]).toBe(true);
    await act(async () => returnRead.resolve({ ...IDLE, [lease]: true }));
    expect(result.available).toBe(true);
    expect(result[lease]).toBe(true);
  },
);

it("sleeps while hidden and refreshes only once for a combined visibility/focus return", async () => {
  await render();
  await presence(true, "hidden");
  await advance(60_000);
  expect(getStatus).toHaveBeenCalledTimes(1);
  await presence(true, "visible");
  expect(getStatus).toHaveBeenCalledTimes(2);
  await presence(true, "visible");
  expect(getStatus).toHaveBeenCalledTimes(2);
});

it("coalesces manual refreshes behind a pending poll and awaits a fresh post-operation read", async () => {
  await render();
  const old = deferred<LifecycleStatus>();
  const fresh = deferred<LifecycleStatus>();
  getStatus.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  await advance(5_000);
  expect(getStatus).toHaveBeenCalledTimes(2);
  let settled = false;
  let pending!: Promise<void>;
  await act(async () => {
    pending = Promise.all([result.refresh(), result.refresh(), result.refresh()]).then(() => {
      settled = true;
    });
  });
  expect(result.available).toBe(false);
  expect(getStatus).toHaveBeenCalledTimes(2);
  await act(async () => old.resolve(IDLE));
  expect(getStatus).toHaveBeenCalledTimes(3);
  expect(result.available).toBe(false);
  expect(settled).toBe(false);
  await advance(60_000);
  expect(getStatus).toHaveBeenCalledTimes(3);
  await act(async () => {
    fresh.resolve({ ...IDLE, installingUpdate: true });
    await pending;
  });
  expect(settled).toBe(true);
  expect(result.available).toBe(true);
  expect(result.installingUpdate).toBe(true);
});

it("fails closed and backs off failed reads, while explicit refresh stays immediate", async () => {
  getStatus.mockRejectedValue(new Error("Unavailable"));
  await render();
  expect(result.available).toBe(false);
  expect(result.degraded).toContain("changes are locked");
  await advance(5_000);
  expect(getStatus).toHaveBeenCalledTimes(2);
  await advance(9_999);
  expect(getStatus).toHaveBeenCalledTimes(2);
  await advance(1);
  expect(getStatus).toHaveBeenCalledTimes(3);
  getStatus.mockResolvedValue({ ...IDLE, launchingTf2: true });
  await act(async () => result.refresh());
  expect(getStatus).toHaveBeenCalledTimes(4);
  expect(result.available).toBe(true);
  expect(result.launchingTf2).toBe(true);
  expect(result.degraded).toBeNull();
  await advance(1_000);
  expect(getStatus).toHaveBeenCalledTimes(5);
});

it("does not let an obsolete API response unlock a replacement subscription", async () => {
  const obsolete = deferred<LifecycleStatus>();
  getStatus.mockReturnValueOnce(obsolete.promise);
  await render();
  const replacement = vi.fn().mockResolvedValue({ ...IDLE, steamVerification: true });
  api = { getLifecycleStatus: replacement } as unknown as Api;
  await render();
  expect(result.steamVerification).toBe(true);
  await act(async () => obsolete.resolve(IDLE));
  expect(result.steamVerification).toBe(true);
  await advance(5_000);
  expect(getStatus).toHaveBeenCalledTimes(1);
  expect(replacement).toHaveBeenCalledTimes(6);
});

it("ignores pending results and removes timers and presence listeners after unmount", async () => {
  const pending = deferred<LifecycleStatus>();
  getStatus.mockReturnValueOnce(pending.promise);
  await render();
  await act(async () => root.unmount());
  mounted = false;
  const count = renders;
  await act(async () => pending.resolve({ ...IDLE, launchingTf2: true }));
  await presence(false);
  await presence(true);
  await advance(60_000);
  expect(renders).toBe(count);
  expect(getStatus).toHaveBeenCalledTimes(1);
});
