// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { createPreviewApi } from "./lib/preview-bridge";

const native = vi.hoisted(() => ({ listen: vi.fn(), destroy: vi.fn() }));
vi.mock("./lib/bridge", async (original) => ({
  ...(await original<typeof import("./lib/bridge")>()),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: native.listen, destroy: native.destroy }),
}));
let root: Root;
let box: HTMLDivElement;
let api: ReturnType<typeof createPreviewApi>;
let applyHud: typeof api.applyHudOptions;
let close: (event: { preventDefault: () => void }) => void;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  native.destroy.mockReset().mockResolvedValue(undefined);
  native.listen.mockReset().mockImplementation(async (handler) => {
    close = handler;
    return () => {};
  });
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  api = createPreviewApi("settings-hud-installed");
  applyHud = api.applyHudOptions;
  vi.spyOn(api, "launchTf2").mockResolvedValue(undefined);
  const library = await api.getProfileLibrary();
  vi.spyOn(api, "getProfileLibrary").mockResolvedValue({
    ...library,
    profiles: [...library.profiles, { ...library.profiles[0], id: "second", name: "Second" }],
  });
  const absorb = api.absorbOwned;
  api.absorbOwned = async () => ({ ...(await absorb()), library: await api.getProfileLibrary() });
  await act(async () => root.render(<App api={api} preview="settings-hud-installed" />));
  await act(async () => vi.dynamicImportSettled());
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function element<T extends HTMLElement>(selector: string): T {
  const found = box.querySelector<T>(selector);
  if (!found) throw Error(`Missing ${selector}`);
  return found;
}
function button(label: string) {
  const found = [...box.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!found) throw Error(`Missing ${label}`);
  return found;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function clickId(id: string) {
  await act(async () => element(`[data-testid="${id}"]`).click());
}
async function debounce() {
  await act(async () => vi.advanceTimersByTimeAsync(701));
}
function launch() {
  return element<HTMLButtonElement>('[data-testid="launch-tf2"]');
}
function reason() {
  return document.getElementById(launch().getAttribute("aria-describedby") ?? "")?.textContent;
}

it("identifies a failed HUD save after navigating to Sounds and retries the retained edit", async () => {
  const apply = vi.spyOn(api, "applyHudOptions").mockRejectedValue(Error("expected VDF string"));
  await clickId("hud-opt-minmode");
  await debounce();
  await clickId("settings-tab-sounds");
  expect(launch().disabled).toBe(true);
  expect(reason()).toContain("HUD: save failed");
  expect(button("Review changes").disabled).toBe(false);
  await click("Review changes");
  await click("Open HUD");
  expect(element('[data-testid="settings-tab-hud"]').getAttribute("aria-current")).toBe("page");
  expect(element('[data-testid="hud-opt-minmode"]').getAttribute("aria-checked")).toBe("true");
  await click("Review changes");
  const attempts = apply.mock.calls.length;
  await click("Save and continue");
  expect(apply).toHaveBeenCalledTimes(attempts + 1);
  expect(launch().disabled).toBe(true);
  apply.mockImplementation(applyHud);
  await click("Save and continue");
  expect(launch().disabled).toBe(false);
  await click("Launch TF2");
  expect(api.launchTf2).toHaveBeenCalledOnce();
});

it("keeps multiple panes protected until each resolves, and explicit discard restores persisted controls", async () => {
  vi.spyOn(api, "applyHudOptions").mockRejectedValue(Error("HUD refused"));
  const write = vi.spyOn(api, "writeManagedCfg").mockRejectedValue(Error("sound refused"));
  await clickId("hud-opt-minmode");
  await debounce();
  await clickId("settings-tab-sounds");
  await clickId("sounds-hit-enabled");
  await debounce();
  expect(reason()).toContain("HUD, Sounds");
  await clickId("settings-tab-hud");
  await clickId("hud-opt-minmode");
  expect(reason()).toContain("Sounds");
  expect(reason()).not.toContain("HUD");
  await click("Review changes");
  await click("Discard and continue");
  expect(launch().disabled).toBe(false);
  await clickId("settings-tab-sounds");
  expect(element('[data-testid="sounds-hit-enabled"]').getAttribute("aria-checked")).toBe("false");
  const count = write.mock.calls.length;
  await debounce();
  expect(write).toHaveBeenCalledTimes(count);
});

it("keeps launch and discard blocked during the actual write, then releases both after completion", async () => {
  let finish!: () => void;
  vi.spyOn(api, "applyHudOptions").mockImplementation(async (options) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return applyHud(options);
  });
  await clickId("hud-opt-minmode");
  await debounce();
  expect(reason()).toContain("current settings write");
  expect(launch().disabled).toBe(true);
  await click("Review changes");
  expect(button("Discard and continue").disabled).toBe(true);
  expect(api.launchTf2).not.toHaveBeenCalled();
  await act(async () => finish());
  await click("Continue");
  expect(launch().disabled).toBe(false);
});

it("releases failed draft gating for a later profile change only after explicit discard", async () => {
  vi.spyOn(api, "applyHudOptions").mockRejectedValue(Error("HUD refused"));
  const change = vi.spyOn(api, "switchProfile");
  await clickId("hud-opt-minmode");
  await debounce();
  const target = [...box.querySelectorAll<HTMLButtonElement>('[data-testid="profile-name"]')].find(
    (item) => item.textContent?.includes("Second"),
  );
  expect(target?.disabled).toBe(true);
  await click("Review changes");
  await click("Discard and continue");
  const enabledTarget = [
    ...box.querySelectorAll<HTMLButtonElement>('[data-testid="profile-name"]'),
  ].find((item) => item.textContent?.includes("Second"));
  expect(enabledTarget?.disabled).toBe(false);
  await act(async () => enabledTarget?.click());
  expect(change).toHaveBeenCalledWith("second");
});

it("explains Steam verification separately and opens its recovery pane", async () => {
  vi.spyOn(api, "getLifecycleStatus").mockResolvedValue({
    launchingTf2: false,
    installingUpdate: false,
    steamVerification: true,
  });
  await act(async () => vi.advanceTimersByTimeAsync(1001));
  expect(launch().disabled).toBe(true);
  expect(reason()).toContain("Steam verification in Mods");
  await click("Open Mods");
  expect(element('[data-testid="settings-tab-mods"]').getAttribute("aria-current")).toBe("page");
  expect(api.launchTf2).not.toHaveBeenCalled();
});

it("wires native close through the actual App settings registry before debounce expires", async () => {
  const apply = vi.spyOn(api, "applyHudOptions");
  await clickId("hud-opt-minmode");
  expect(apply).not.toHaveBeenCalled();
  const event = { preventDefault: vi.fn() };
  await act(async () => close(event));
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(apply).toHaveBeenCalledOnce();
  expect(native.destroy).toHaveBeenCalledOnce();
});

it("saves two retained pane drafts through the native write queue before releasing launch", async () => {
  const apply = vi.spyOn(api, "applyHudOptions").mockRejectedValue(Error("HUD refused"));
  const managed = api.writeManagedCfg;
  const write = vi.spyOn(api, "writeManagedCfg").mockRejectedValue(Error("sounds refused"));
  await clickId("hud-opt-minmode");
  await debounce();
  await clickId("settings-tab-sounds");
  await clickId("sounds-hit-enabled");
  await debounce();
  expect(reason()).toContain("HUD, Sounds");
  apply.mockImplementation(applyHud);
  write.mockImplementation(managed);
  await click("Review changes");
  await click("Save and continue");
  expect(launch().disabled).toBe(false);
  expect(box.querySelector('[data-testid="files-exit-guard"]')).toBeNull();
});

it("keeps manual crosshair changes explicit when closing and discards only after a decision", async () => {
  const build = vi.spyOn(api, "applyCrosshairs");
  await clickId("settings-tab-crosshair");
  await clickId("crosshair-mode-custom");
  const event = { preventDefault: vi.fn() };
  await act(async () => close(event));
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(native.destroy).not.toHaveBeenCalled();
  expect(build).not.toHaveBeenCalled();
  expect(box.textContent).toContain("Crosshair: Apply from this pane");
  await click("Discard and continue");
  expect(native.destroy).toHaveBeenCalledOnce();
  expect(build).not.toHaveBeenCalled();
});

it("clears a discarded draft's failure while preserving an unrelated pane's failure", async () => {
  vi.spyOn(api, "applyHudOptions").mockRejectedValue(Error("HUD refused"));
  vi.spyOn(api, "writeManagedCfg").mockRejectedValue(Error("sounds refused"));
  await clickId("hud-opt-minmode");
  await debounce();
  await clickId("settings-tab-sounds");
  await clickId("sounds-hit-enabled");
  await debounce();
  await clickId("sounds-hit-enabled");
  expect(reason()).toContain("HUD: save failed");
  await click("Review changes");
  await click("Discard and continue");
  expect(launch().disabled).toBe(false);
  const feedback = element('[data-testid="toast"]');
  expect(feedback.textContent).toContain("sounds refused");
  await act(async () => feedback.click());
  expect(box.querySelector('[data-testid="toast"]')).toBeNull();
});

it("joins an actual in-flight autosave on native close and waits for its queue release", async () => {
  let finish!: () => void;
  const apply = vi.spyOn(api, "applyHudOptions").mockImplementation(async (options) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return applyHud(options);
  });
  await clickId("hud-opt-minmode");
  await debounce();
  const event = { preventDefault: vi.fn() };
  await act(async () => close(event));
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(native.destroy).not.toHaveBeenCalled();
  expect(button("Discard and continue").disabled).toBe(true);
  await act(async () => finish());
  expect(apply).toHaveBeenCalledOnce();
  expect(native.destroy).toHaveBeenCalledOnce();
});
