// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFilesDraftStore } from "../lib/files-drafts";
import { SettingsBusyQueue } from "../lib/settings-busy-ui";
import { createSettingsDraftStore, type SettingsDraft } from "../lib/settings-drafts";
import { useFilesExitGuard } from "./useFilesExitGuard";

const native = vi.hoisted(() => ({ listen: vi.fn(), destroy: vi.fn() }));
vi.mock("../lib/bridge", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: native.listen, destroy: native.destroy }),
}));
let root: Root;
let box: HTMLDivElement;
let store: ReturnType<typeof createFilesDraftStore>;
let settings: ReturnType<typeof createSettingsDraftStore>;
let close: (event: { preventDefault: () => void }) => void;
let busy = false;
const save = vi.fn();
const onOpenPane = vi.fn();
function Harness() {
  const guard = useFilesExitGuard(store, false, busy, settings, onOpenPane);
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
  settings = createSettingsDraftStore();
  onOpenPane.mockReset();
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
  await act(async () => button("Continue").click());
  expect(native.destroy).toHaveBeenCalledTimes(2);
  expect(box.querySelector('[data-testid="files-exit-guard"]')).toBeNull();
});

it("waits for a settings write without inventing Files drafts or requiring a saver", async () => {
  store.discardAll();
  busy = true;
  await act(async () => root.render(createElement(Harness)));
  await requestClose();
  expect(box.textContent).toContain("Finish current operation?");
  expect(box.textContent).not.toContain("Discard and continue");
  expect(button("Continue").disabled).toBe(true);
  busy = false;
  await act(async () => root.render(createElement(Harness)));
  await act(async () => button("Continue").click());
  expect(save).not.toHaveBeenCalled();
  expect(native.destroy).toHaveBeenCalledOnce();
});

it("checks a newly started native write before the next React render", async () => {
  store.discardAll();
  const queue = new SettingsBusyQueue(vi.fn());
  settings.registerWriteGuard(() => queue.active);
  await act(async () => root.render(createElement(Harness)));

  // Native queue state is synchronous; its React busy update can still be pending.
  let release!: () => void;
  const operation = queue.run(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await requestClose();
  expect(native.destroy).not.toHaveBeenCalled();
  expect(box.textContent).toContain("Finish current operation?");
  expect(button("Continue").disabled).toBe(true);
  expect(save).not.toHaveBeenCalled();

  await act(async () => {
    release();
    await operation;
    root.render(createElement(Harness));
  });
  await act(async () => button("Continue").click());
  expect(native.destroy).toHaveBeenCalledOnce();
});

it.each([
  ["mods", "Mods"],
  ["crosshair", "Crosshair"],
] as const)(
  "keeps explicit %s drafts reviewable without offering an impossible save",
  async (tab, label) => {
    const entry: SettingsDraft = { id: `draft-${tab}`, owner: `owner-${tab}`, profile: "a", tab };
    const discard = vi.fn(() => settings.removeOwner(entry.owner));
    settings.register(entry.owner, discard);
    await act(async () => {
      store.discardAll();
      settings.report(entry, true);
    });
    await requestClose();
    expect(box.textContent).toContain(`${label}: Apply from this pane`);
    expect(box.textContent).toContain("Apply changes from their panes");
    expect(box.textContent).not.toContain("Save and continue");
    expect(document.activeElement).toBe(button("Cancel"));
    await act(async () => button(`Open ${label}`).click());
    expect(onOpenPane).toHaveBeenCalledExactlyOnceWith(tab);
    expect(box.querySelector('[data-testid="files-exit-guard"]')).toBeNull();
    expect(settings.getSnapshot()).toEqual([entry]);
    expect(save).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
    expect(native.destroy).not.toHaveBeenCalled();

    await requestClose();
    await act(async () => button("Cancel").click());
    expect(settings.getSnapshot()).toEqual([entry]);
    expect(discard).not.toHaveBeenCalled();
    await requestClose();
    await act(async () => button("Discard and continue").click());
    expect(discard).toHaveBeenCalledOnce();
    expect(settings.getSnapshot()).toEqual([]);
    expect(save).not.toHaveBeenCalled();
    expect(native.destroy).toHaveBeenCalledOnce();
  },
);

it("does not partially flush mixed Files, autosave, and explicit drafts before review", async () => {
  const explicit: SettingsDraft = { id: "mods", owner: "mods-owner", profile: "a", tab: "mods" };
  const flush = vi.fn(async () => {
    settings.report(automatic, false);
    return true;
  });
  const automatic: SettingsDraft = {
    id: "gameplay",
    owner: "gameplay-owner",
    profile: "a",
    tab: "gameplay",
    save: { flush, saving: false, failed: false, locked: false },
  };
  settings.register(explicit.owner, () => settings.report(explicit, false));
  settings.register(automatic.owner, () => settings.report(automatic, false));
  await act(async () => {
    settings.report(explicit, true);
    settings.report(automatic, true);
  });
  await requestClose();
  expect(box.textContent).not.toContain("Save and continue");
  expect(box.textContent).toContain("tf/cfg/config.cfg");
  expect(box.textContent).toContain("Mods: Apply from this pane");
  expect(box.textContent).toContain("Gameplay: Unsaved changes");
  expect(flush).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  await act(async () => button("Cancel").click());
  expect(store.dirty()[0].text).toBe("new");
  expect(settings.getSnapshot()).toHaveLength(2);

  // The player explicitly resolves the heavy draft from its pane. Ordinary
  // saves become available again, and all must finish before native close.
  await act(async () => settings.report(explicit, false));
  await requestClose();
  await act(async () => button("Save and continue").click());
  expect(flush).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledOnce();
  expect(flush.mock.invocationCallOrder[0]).toBeLessThan(save.mock.invocationCallOrder[0]);
  expect(settings.getSnapshot()).toEqual([]);
  expect(store.dirty()).toEqual([]);
  expect(native.destroy).toHaveBeenCalledOnce();
});

it("keeps explicit drafts intact while a registered native write prevents discard", async () => {
  const entry: SettingsDraft = { id: "mods", owner: "mods-owner", profile: "a", tab: "mods" };
  const discard = vi.fn(() => settings.report(entry, false));
  let writing = true;
  settings.register(entry.owner, discard);
  settings.registerWriteGuard(() => writing);
  await act(async () => {
    store.discardAll();
    settings.report(entry, true);
  });
  await requestClose();
  expect(button("Discard and continue").disabled).toBe(true);
  await act(async () => button("Discard and continue").click());
  expect(discard).not.toHaveBeenCalled();
  expect(settings.getSnapshot()).toEqual([entry]);
  expect(native.destroy).not.toHaveBeenCalled();
  writing = false;
  await act(async () => root.render(createElement(Harness)));
  await act(async () => button("Discard and continue").click());
  expect(discard).toHaveBeenCalledOnce();
  expect(native.destroy).toHaveBeenCalledOnce();
});

it("does not auto-flush an unlocked setting while an explicit build still requires review", async () => {
  const explicit: SettingsDraft = {
    id: "crosshair",
    owner: "crosshair-owner",
    profile: "a",
    tab: "crosshair",
  };
  const flush = vi.fn(async () => true);
  const automatic: SettingsDraft = {
    id: "gameplay",
    owner: "gameplay-owner",
    profile: "a",
    tab: "gameplay",
    save: { flush, saving: false, failed: false, locked: false },
  };
  settings.register(explicit.owner, () => settings.report(explicit, false));
  settings.register(automatic.owner, () => settings.report(automatic, false));
  await act(async () => {
    store.discardAll();
    settings.report(automatic, true);
    settings.report(explicit, true);
  });
  await requestClose();
  expect(box.textContent).not.toContain("Save and continue");
  expect(flush).not.toHaveBeenCalled();
  expect(native.destroy).not.toHaveBeenCalled();
  await act(async () => button("Cancel").click());
  expect(settings.getSnapshot()).toHaveLength(2);
  expect(flush).not.toHaveBeenCalled();
});
