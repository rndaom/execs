import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComfigPane } from "./ComfigPane";
import { COMFIG_MODULE_GROUPS, COMFIG_PRESETS } from "./lib/comfig-catalog";
import { PREVIEW_COMFIG_STATE } from "./lib/comfig-ui";
import { OFFICIAL_ADDONS } from "./lib/first-run-ui";

const status = vi.hoisted(() => ({ running: false, busy: false }));
vi.mock("./hooks/useAppStatus", () => ({ useAppStatus: () => status }));

let dom: JSDOM;
let root: Root;

beforeEach(() => {
  status.running = false;
  status.busy = false;
  dom = new JSDOM("<!doctype html><div id='root'></div>");
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("root") as HTMLElement);
});

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function render(onApplyPreset = vi.fn(async () => false)) {
  root.render(
    createElement(ComfigPane, {
      detail: null,
      state: PREVIEW_COMFIG_STATE,
      onApplyPreset,
      onApplyModules: async () => false,
      onToggleAddon: async () => false,
      onUpdatePackages: () => undefined,
      onImportCustom: () => undefined,
    }),
  );
}

describe("ComfigPane workspaces", () => {
  it("exposes every module category and official addon without a disclosure", async () => {
    await act(async () => render());
    expect(document.querySelector('[data-testid="comfig-modules"]')?.closest("details")).toBeNull();
    for (const group of COMFIG_MODULE_GROUPS) {
      await act(async () => document.getElementById(`comfig-module-tab-${group.id}`)?.click());
      expect(
        document.querySelector(`[data-testid="comfig-module-${group.modules[0].id}"]`),
      ).not.toBeNull();
      const more = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) =>
          button.textContent?.startsWith("Show ") && button.textContent?.includes(" more "),
      );
      if (more) await act(async () => more.click());
      for (const module of group.modules) {
        expect(document.querySelector(`[data-testid="comfig-module-${module.id}"]`)).not.toBeNull();
      }
    }
    for (const addon of OFFICIAL_ADDONS) {
      expect(
        document.querySelector(`[data-testid="comfig-addon-${addon.id}"]`)?.getAttribute("role"),
      ).toBe("switch");
    }
  });

  it("keeps the committed preset and authentic preview when a selection fails", async () => {
    const apply = vi.fn(async () => false);
    await act(async () => render(apply));
    const preview = document.querySelector("img")?.getAttribute("src");
    await act(async () => document.getElementById("comfig-preset-high")?.click());
    expect(apply).toHaveBeenCalledWith("high");
    expect(document.querySelector<HTMLInputElement>("#comfig-preset-medium")?.checked).toBe(true);
    expect(document.querySelector("img")?.getAttribute("src")).toBe(preview);
    const showAll = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Show all presets",
    );
    await act(async () => showAll?.click());
    for (const preset of COMFIG_PRESETS) {
      expect(document.getElementById(`comfig-preset-${preset.id}`)).not.toBeNull();
    }
  });

  it("retains the write lock for presets, module values and addon package writes", async () => {
    status.running = true;
    await act(async () => render());
    expect(document.querySelector<HTMLInputElement>("#comfig-preset-high")?.disabled).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>(
        '[data-testid="comfig-module-panel"] button, #comfig-module-panel button',
      )?.disabled,
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>(
        `[data-testid="comfig-addon-${OFFICIAL_ADDONS[0].id}"]`,
      )?.disabled,
    ).toBe(true);
  });
});
