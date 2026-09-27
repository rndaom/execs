// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { createSettingsDraftStore } from "../lib/settings-drafts";
import { useInventoryDraftGuard } from "./useInventoryDraftGuard";

it("guards account drafts and in-flight operations without auto-applying on close", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const store = createSettingsDraftStore();
  let guard: ReturnType<typeof useInventoryDraftGuard> | undefined;
  const currentGuard = () => {
    if (!guard) throw new Error("Harness is not mounted");
    return guard;
  };
  function Harness() {
    guard = useInventoryDraftGuard(store);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const reset = vi.fn();
  try {
    await act(async () => root.render(<Harness />));
    currentGuard().onDraftChange(true, reset);
    expect(store.getSnapshot()[0]).toMatchObject({ profile: null, tab: "inventory" });
    expect(await store.flush()).toBe(false);
    expect(reset).not.toHaveBeenCalled();
    currentGuard().onOperationBusyChange(true);
    expect(store.discard()).toBe(false);
    currentGuard().onOperationBusyChange(false);
    expect(store.discard()).toBe(true);
    expect(reset).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
