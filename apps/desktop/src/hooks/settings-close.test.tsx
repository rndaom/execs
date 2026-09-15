// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsDraftBoundary } from "../components/SettingsDraftBoundary";
import { createFilesDraftStore } from "../lib/files-drafts";
import { createSettingsDraftStore } from "../lib/settings-drafts";
import type { SettingsTab } from "../lib/settings-ui";
import { useAutosave } from "./useAutosave";
import { useFilesExitGuard } from "./useFilesExitGuard";
import { useSeededDraft } from "./useSeededDraft";

const native = vi.hoisted(() => ({ listen: vi.fn(), destroy: vi.fn() }));
vi.mock("../lib/bridge", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: native.listen, destroy: native.destroy }),
}));
let root: Root;
let box: HTMLDivElement;
let files: ReturnType<typeof createFilesDraftStore>;
let settings: ReturnType<typeof createSettingsDraftStore>;
let close: (event: { preventDefault: () => void }) => void;
let running: boolean;
let busy: boolean;
let profile: string;
let guard: ReturnType<typeof useFilesExitGuard>;
const edits = new Map<SettingsTab, (value: string) => void>();
const values = new Map<SettingsTab, string>();
const save = vi.fn<(tab: SettingsTab, text: string) => Promise<boolean>>();
const saveFile = vi.fn<() => Promise<boolean>>();
function Pane({ tab }: { tab: SettingsTab }) {
  const [seed, setSeed] = useState("saved");
  const [draft, setDraft] = useSeededDraft(seed, String, profile);
  edits.set(tab, setDraft);
  values.set(tab, draft);
  useAutosave({
    dirty: draft !== seed,
    locked: running,
    token: draft,
    save: async () => {
      const result = await save(tab, draft);
      if (result) setSeed(draft);
      return result;
    },
  });
  return null;
}
function Harness() {
  guard = useFilesExitGuard(files, running, busy, settings);
  guard.saver.current = saveFile;
  return (
    <>
      {guard.modal}
      {(["hud", "sounds"] as const).map((tab) => (
        <SettingsDraftBoundary
          key={`${profile}:${tab}`}
          store={settings}
          profile={profile}
          tab={tab}
          active
          blocked={false}
        >
          <Pane tab={tab} />
        </SettingsDraftBoundary>
      ))}
    </>
  );
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  files = createFilesDraftStore();
  settings = createSettingsDraftStore();
  running = false;
  busy = false;
  profile = "a";
  edits.clear();
  values.clear();
  save.mockReset().mockResolvedValue(true);
  saveFile.mockReset().mockResolvedValue(true);
  native.destroy.mockReset().mockResolvedValue(undefined);
  native.listen.mockReset().mockImplementation(async (handler) => {
    close = handler;
    return () => {};
  });
  await render();
  await act(async () => vi.dynamicImportSettled());
});
afterEach(async () => {
  await act(async () => {
    settings.discard();
    root.unmount();
  });
  box.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(<Harness />));
}
async function edit(tab: SettingsTab, text = "edited") {
  await act(async () => edits.get(tab)?.(text));
}
async function requestClose() {
  const event = { preventDefault: vi.fn() };
  await act(async () => close(event));
  expect(event.preventDefault).toHaveBeenCalledOnce();
}
function button(label: string) {
  const result = [...box.querySelectorAll("button")].find((item) => item.textContent === label);
  if (!result) throw Error(`Missing ${label}`);
  return result;
}
async function click(label: string) {
  await act(async () => button(label).click());
}

it("flushes and awaits every debounced settings pane before native destruction", async () => {
  let finish!: (saved: boolean) => void;
  save.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await edit("hud");
  await edit("sounds");
  expect(save).not.toHaveBeenCalled();
  await requestClose();
  expect(save.mock.calls).toEqual([["hud", "edited"]]);
  expect(native.destroy).not.toHaveBeenCalled();
  expect(button("Discard and continue").disabled).toBe(true);
  await act(async () => finish(true));
  expect(save.mock.calls).toEqual([
    ["hud", "edited"],
    ["sounds", "edited"],
  ]);
  expect(settings.getSnapshot()).toEqual([]);
  expect(native.destroy).toHaveBeenCalledOnce();
});

it("keeps locked settings through Cancel, discards only explicitly and never flushes discarded panes", async () => {
  running = true;
  await render();
  await edit("hud");
  await edit("sounds");
  await requestClose();
  expect(button("Save and continue").disabled).toBe(true);
  await click("Cancel");
  expect(values.get("hud")).toBe("edited");
  expect(settings.getSnapshot()).toHaveLength(2);
  await requestClose();
  await click("Discard and continue");
  expect(settings.getSnapshot()).toEqual([]);
  expect([...values.values()]).toEqual(["saved", "saved"]);
  expect(native.destroy).toHaveBeenCalledOnce();
  running = false;
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(save).not.toHaveBeenCalled();
});

it("keeps a failed save visible, supports repeated failure and retries before closing", async () => {
  save.mockResolvedValue(false);
  await edit("hud");
  await requestClose();
  expect(box.textContent).toContain("HUD: Save failed");
  expect(native.destroy).not.toHaveBeenCalled();
  await click("Save and continue");
  expect(save).toHaveBeenCalledTimes(2);
  expect(values.get("hud")).toBe("edited");
  save.mockResolvedValue(true);
  await click("Save and continue");
  expect(native.destroy).toHaveBeenCalledOnce();
  expect(settings.getSnapshot()).toEqual([]);
});

it("preserves Files' explicit decision with mixed settings and file drafts", async () => {
  files.read("a", "tf/cfg/config.cfg", "old");
  files.edit("a", "tf/cfg/config.cfg", "new bytes");
  await edit("hud");
  await edit("sounds");
  await requestClose();
  expect(save).not.toHaveBeenCalled();
  await click("Save and continue");
  expect(save).toHaveBeenCalledTimes(2);
  expect(saveFile).toHaveBeenCalledWith({
    profile: "a",
    path: "tf/cfg/config.cfg",
    text: "new bytes",
  });
  expect(files.dirty()).toEqual([]);
  expect(native.destroy).toHaveBeenCalledOnce();
});

it("refuses close when a newer edit arrives during the awaited save", async () => {
  let finish!: (saved: boolean) => void;
  save.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await edit("hud", "first");
  await requestClose();
  await edit("hud", "newer");
  await act(async () => finish(true));
  expect(native.destroy).not.toHaveBeenCalled();
  expect(values.get("hud")).toBe("newer");
  expect(settings.getSnapshot()).toHaveLength(1);
  await click("Save and continue");
  expect(save.mock.calls).toEqual([
    ["hud", "first"],
    ["hud", "newer"],
  ]);
  expect(native.destroy).toHaveBeenCalledOnce();
});

it("awaits an existing save and never discards an in-flight write", async () => {
  let finish!: (saved: boolean) => void;
  save.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await edit("hud");
  await act(async () => vi.advanceTimersByTimeAsync(700));
  expect(settings.discard()).toBe(false);
  await requestClose();
  expect(save).toHaveBeenCalledOnce();
  expect(native.destroy).not.toHaveBeenCalled();
  await act(async () => finish(true));
  expect(native.destroy).toHaveBeenCalledOnce();
});

it("refuses a transition whose source profile changes during save", async () => {
  let finish!: (saved: boolean) => void;
  save.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await edit("hud");
  await requestClose();
  profile = "b";
  await render();
  await act(async () => finish(true));
  expect(native.destroy).not.toHaveBeenCalled();
  expect(settings.getSnapshot()).toEqual([]);
  expect(box.textContent).toContain("Settings drafts kept");
});

it("does not bypass another active operation when settings are discarded", async () => {
  running = true;
  busy = true;
  await render();
  await edit("hud");
  await requestClose();
  expect(button("Discard and continue").disabled).toBe(true);
  expect(native.destroy).not.toHaveBeenCalled();
  busy = false;
  await render();
  await click("Discard and continue");
  expect(native.destroy).toHaveBeenCalledOnce();
});
