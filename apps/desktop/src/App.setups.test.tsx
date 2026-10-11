// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { createPreviewApi } from "./lib/preview-bridge";

const external = vi.hoisted(() => vi.fn());
vi.mock("./lib/bridge", async (original) => ({
  ...(await original<typeof import("./lib/bridge")>()),
  openExternal: external,
}));

let root: Root;
let box: HTMLDivElement;
let api: ReturnType<typeof createPreviewApi>;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  external.mockReset().mockResolvedValue(undefined);
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  api = createPreviewApi("setups");
  vi.spyOn(api, "launchTf2").mockResolvedValue(undefined);
  vi.spyOn(api, "getLaunchSyncStatus").mockResolvedValue({
    profileOptions: "-novid",
    steamOptions: "-novid",
    inSync: true,
    steamRunning: false,
  });
  await act(async () => root.render(<App api={api} preview="setups" />));
  await act(async () => vi.dynamicImportSettled());
  await settle(100);
});

afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const q = (selector: string) => box.querySelector<HTMLElement>(selector);
const text = (selector: string) => q(selector)?.textContent?.trim() ?? null;
const click = (selector: string) => act(async () => q(selector)?.click());
/** Time passes in small steps so each timer's state change renders before the next. */
async function settle(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 250) {
    await act(async () => vi.advanceTimersByTimeAsync(250));
  }
}
const current = (id: string) => q(`[data-testid="${id}"]`)?.getAttribute("aria-current");

it("opens on Setups with the panes kept, hidden, behind it", async () => {
  expect(q('[data-testid="setups-home"]')).not.toBeNull();
  expect(current("settings-tab-setups")).toBe("page");
  expect(box.querySelectorAll('[data-testid^="settings-tab-"][aria-current="page"]')).toHaveLength(
    1,
  );
  expect(q('[data-testid="settings-pane-setups"] > [hidden]')).not.toBeNull();
  expect(Array.from(box.querySelectorAll("[data-setup-id] b")).map((b) => b.textContent)).toEqual([
    "Main",
    "Casual",
    "Vanilla",
    "Comp",
  ]);
  expect(text(".setups-name")).toBe("Main");
});

it("opens the Edit page from Edit, a pane from its rows, and back with the Setups entry", async () => {
  await click('[data-testid="setups-edit"]');
  expect(q('[data-testid="setups-home"]')).toBeNull();
  expect(q('[data-testid="setup-sheet"]')).not.toBeNull();
  expect(current("settings-tab-edit")).toBe("page");
  expect(text('[data-testid="settings-tab-edit"]')).toBe("Edit Main");
  expect(text(".setup-sheet-name")).toBe("Main");
  expect(
    Array.from(box.querySelectorAll(".setup-group-title")).map((title) => title.textContent),
  ).toEqual(["Look", "Feel", "Sound", "Mods", "Performance", "Advanced"]);

  await click('[data-testid="setup-row-fov"]');
  expect(q('[data-testid="setup-sheet"]')).toBeNull();
  expect(current("settings-tab-gameplay")).toBe("page");
  expect(q('[data-testid="settings-pane-gameplay"] > [hidden]')).toBeNull();

  await click('[data-testid="settings-tab-edit"]');
  expect(q('[data-testid="setup-sheet"]')).not.toBeNull();
  await click('[data-testid="setup-row-launch"]');
  expect(current("settings-tab-launch")).toBe("page");

  await click('[data-testid="settings-tab-binds"]');
  expect(current("settings-tab-binds")).toBe("page");
  await click('[data-testid="settings-tab-setups"]');
  expect(q('[data-testid="setups-home"]')).not.toBeNull();
  expect(current("settings-tab-binds")).toBeNull();

  // A pane chosen from the sidebar leaves Setups too.
  await click('[data-testid="settings-tab-sounds"]');
  expect(q('[data-testid="setups-home"]')).toBeNull();
  expect(current("settings-tab-sounds")).toBe("page");
});

it("opens the guide's profiles page from Setups and the pane's page elsewhere", async () => {
  await click('[data-testid="guide-open"]');
  expect(external).toHaveBeenLastCalledWith(expect.stringMatching(/\/docs\/guide\/profiles\.md$/));
  await click('[data-testid="settings-tab-binds"]');
  await click('[data-testid="guide-open"]');
  expect(external).toHaveBeenLastCalledWith(expect.stringMatching(/\/docs\/guide\/binds\.md$/));
  // The Edit page is described with the setups.
  await click('[data-testid="settings-tab-edit"]');
  await click('[data-testid="guide-open"]');
  expect(external).toHaveBeenLastCalledWith(expect.stringMatching(/\/docs\/guide\/profiles\.md$/));
});

it("returns to Setups from App settings", async () => {
  await click('[data-testid="app-settings-open"]');
  expect(q('[data-testid="setups-home"]')).toBeNull();
  const back = Array.from(box.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Back to"),
  );
  expect(back?.textContent).toContain("Back to Setups");
  await act(async () => back?.click());
  expect(q('[data-testid="setups-home"]')).not.toBeNull();
});

it("switches the way the header menu does and shows the new setup in the game", async () => {
  const change = vi.spyOn(api, "switchProfile");
  await click('[data-testid="setup-item-preview-2"]');
  await click('[data-testid="setups-switch"]');
  await settle(10_000);
  expect(change).toHaveBeenCalledWith("preview-2");
  expect(api.launchTf2).not.toHaveBeenCalled();
  expect(text(".setups-name")).toBe("Casual");
  expect(text(".setups-chip")).toBe("In the game now");
  expect(q('[data-testid="setups-play"]')).not.toBeNull();
  expect(q('[data-testid="setups-switch"]')).toBeNull();
});

it("starts the game only after Switch and play has finished switching", async () => {
  await click('[data-testid="setup-item-preview-3"]');
  await click('[data-testid="setups-switch-play"]');
  // The switch is still showing its steps: nothing launches over it.
  expect(api.launchTf2).not.toHaveBeenCalled();
  await settle(1_000);
  expect(api.launchTf2).not.toHaveBeenCalled();
  await settle(15_000);
  expect(api.launchTf2).toHaveBeenCalledOnce();
  expect(text(".setups-chip")).toBe("In the game now");
  expect(text(".setups-name")).toBe("Vanilla");
});

it("does not start the game when the switch did not happen", async () => {
  const change = vi.spyOn(api, "switchProfile").mockRejectedValue(new Error("Could not switch."));
  await click('[data-testid="setup-item-preview-3"]');
  await click('[data-testid="setups-switch-play"]');
  await settle(15_000);
  expect(api.launchTf2).not.toHaveBeenCalled();
  expect(text(".setups-chip")).toBeNull();
  expect(q('[data-testid="setups-switch"]')).not.toBeNull();
  // A later plain switch does not inherit the play.
  change.mockRestore();
  await click('[data-testid="setups-switch"]');
  await settle(15_000);
  expect(api.launchTf2).not.toHaveBeenCalled();
});

it("plays the setup in the game through the header's launch path", async () => {
  await click('[data-testid="setups-play"]');
  await settle(50);
  expect(api.launchTf2).toHaveBeenCalledOnce();
});

it("opens the existing switch preview from the changes line", async () => {
  const compare = vi.spyOn(api, "compareProfileSwitch");
  await click('[data-testid="setup-item-preview-2"]');
  expect(text('[data-testid="setups-compare"]')).toMatch(/^\d+ changes? from Main$/);
  await click('[data-testid="setups-compare"]');
  await settle(50);
  expect(compare).toHaveBeenCalledWith("preview-2");
  expect(document.querySelector('[data-testid="switch-compare-confirm"]')).not.toBeNull();
});
