// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFilesDraftStore } from "../lib/files-drafts";
import { useFilesExitGuard } from "./useFilesExitGuard";

const native = vi.hoisted(() => ({ listen: vi.fn(), destroy: vi.fn() }));
vi.mock("../lib/bridge", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: native.listen, destroy: native.destroy }),
}));
let root: Root;
let box: HTMLDivElement;
let store: ReturnType<typeof createFilesDraftStore>;
let close: (event: { preventDefault: () => void }) => void;
let busy = false;
const save = vi.fn();
function Harness() {
  const guard = useFilesExitGuard(store, false, busy);
  guard.saver.current = save;
  return guard.modal;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  busy = false;
  store = createFilesDraftStore();
  store.read("a", "tf/cfg/config.cfg", "old");
  store.edit("a", "tf/cfg/config.cfg", "new");
  save.mockReset().mockResolvedValue(true);
  native.destroy.mockReset().mockResolvedValue(undefined);
  native.listen.mockReset().mockImplementation(async (handler) => {
    close = handler;
    return () => {};
  });
  await act(async () => root.render(createElement(Harness)));
  await act(async () => vi.dynamicImportSettled());
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.unstubAllGlobals();
});
function button(label: string) {
  const found = [...box.querySelectorAll("button")].find((item) => item.textContent === label);
  if (!found) throw Error(`Missing ${label}`);
  return found;
}
async function requestClose() {
  const event = { preventDefault: vi.fn() };
  await act(async () => close(event));
  expect(event.preventDefault).toHaveBeenCalledOnce();
}
it("cancels native close with exact bytes intact and awaits save before destroying", async () => {
  await requestClose();
  await act(async () => button("Cancel").click());
  expect(store.dirty()[0].text).toBe("new");
  expect(native.destroy).not.toHaveBeenCalled();
  let finish: (value: boolean) => void = () => {};
  save.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  await requestClose();
  await act(async () => button("Save and continue").click());
  expect(native.destroy).not.toHaveBeenCalled();
  expect(button("Discard and continue").disabled).toBe(true);
  await act(async () => finish(false));
  expect(native.destroy).not.toHaveBeenCalled();
  expect(store.dirty()[0].text).toBe("new");
  save.mockResolvedValue(true);
  await act(async () => button("Save and continue").click());
  expect(native.destroy).toHaveBeenCalledOnce();
  expect(store.dirty()).toEqual([]);
});
it("cannot discard and close while another write is active", async () => {
  busy = true;
  await act(async () => root.render(createElement(Harness)));
  await requestClose();
  expect(button("Discard and continue").disabled).toBe(true);
  await act(async () => button("Discard and continue").click());
  expect(native.destroy).not.toHaveBeenCalled();
  busy = false;
  await act(async () => root.render(createElement(Harness)));
  await act(async () => button("Discard and continue").click());
  expect(native.destroy).toHaveBeenCalledOnce();
});
it("keeps a rejected native close visible and retryable after saving", async () => {
  native.destroy.mockRejectedValueOnce(Error("close refused"));
  await requestClose();
  await act(async () => button("Save and continue").click());
  expect(box.querySelector('[role="alert"]')?.textContent).toBe("close refused");
  expect(store.dirty()).toEqual([]);
  await act(async () => button("Save and continue").click());
  expect(native.destroy).toHaveBeenCalledTimes(2);
  expect(box.querySelector('[data-testid="files-exit-guard"]')).toBeNull();
});
