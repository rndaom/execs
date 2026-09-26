// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Api } from "../lib/api";
import { INVENTORY_REFRESH_MS, useInventorySnapshot } from "./useInventorySnapshot";

let root: ReturnType<typeof createRoot>;
let box: HTMLDivElement;
let result: ReturnType<typeof useInventorySnapshot>;
let focused: boolean;
let visible: string;
let props: { active: boolean; running: boolean; busy: boolean };
let getInventory: ReturnType<typeof vi.fn>;
let api: Api;
function Harness() {
  result = useInventorySnapshot(api, props.active, props.running, props.busy);
  return null;
}
async function render() {
  await act(async () =>
    root.render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    ),
  );
}
async function advance(ms: number) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  focused = true;
  visible = "visible";
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visible as DocumentVisibilityState,
  );
  props = { active: true, running: false, busy: false };
  getInventory = vi.fn().mockResolvedValue({ steamId: "one", items: [] });
  api = { getInventory } as unknown as Api;
  box = document.createElement("div");
  root = createRoot(box);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("loads once even in Strict Mode and schedules successive quiet refreshes", async () => {
  await render();
  expect(getInventory).toHaveBeenCalledTimes(1);
  await advance(INVENTORY_REFRESH_MS - 1);
  expect(getInventory).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(getInventory).toHaveBeenCalledTimes(2);
  await advance(INVENTORY_REFRESH_MS);
  expect(getInventory).toHaveBeenCalledTimes(3);
});

it("sleeps when hidden, unfocused, inactive, busy or running and catches up on return", async () => {
  props.active = false;
  await render();
  await advance(INVENTORY_REFRESH_MS);
  expect(getInventory).not.toHaveBeenCalled();
  props.active = true;
  props.busy = true;
  await render();
  expect(getInventory).not.toHaveBeenCalled();
  props.busy = false;
  props.running = true;
  await render();
  expect(getInventory).not.toHaveBeenCalled();
  props.running = false;
  focused = false;
  await render();
  expect(getInventory).not.toHaveBeenCalled();
  focused = true;
  visible = "hidden";
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(getInventory).not.toHaveBeenCalled();
  visible = "visible";
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(getInventory).toHaveBeenCalledTimes(1);
  focused = false;
  await act(async () => window.dispatchEvent(new Event("blur")));
  await advance(INVENTORY_REFRESH_MS * 3);
  expect(getInventory).toHaveBeenCalledTimes(1);
  focused = true;
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(getInventory).toHaveBeenCalledTimes(2);
});

it("coalesces focus events and retries, then backs off failures while retaining the last snapshot", async () => {
  await render();
  let reject!: (reason: Error) => void;
  getInventory.mockImplementationOnce(
    () =>
      new Promise((_, failure) => {
        reject = failure;
      }),
  );
  await advance(INVENTORY_REFRESH_MS);
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    void result.refresh();
  });
  expect(getInventory).toHaveBeenCalledTimes(2);
  getInventory.mockRejectedValue(new Error("Offline"));
  await act(async () => reject(new Error("Offline")));
  expect(result.snapshot?.steamId).toBe("one");
  expect(result.error).toContain("Offline");
  await advance(30_000);
  expect(getInventory).toHaveBeenCalledTimes(3);
  await advance(59_999);
  expect(getInventory).toHaveBeenCalledTimes(3);
  await advance(1);
  expect(getInventory).toHaveBeenCalledTimes(4);
});

it("refreshes after the game closes with a reconnect cooldown and stops after unmount", async () => {
  await render();
  props.running = true;
  await render();
  props.running = false;
  await render();
  expect(getInventory).toHaveBeenCalledTimes(1);
  getInventory.mockResolvedValue({ steamId: "two", items: [] });
  await advance(30_000);
  expect(result.snapshot?.steamId).toBe("two");
  await act(async () => root.unmount());
  await advance(INVENTORY_REFRESH_MS * 3);
  expect(getInventory).toHaveBeenCalledTimes(2);
});
