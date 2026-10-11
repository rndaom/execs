import { JSDOM } from "jsdom";
import { act, type ComponentProps, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComfigPane, comfigModulesSummary } from "./ComfigPane";
import { COMFIG_MODULE_GROUPS, COMFIG_PRESETS } from "./lib/comfig-catalog";
import { type ComfigUiState, OFFICIAL_ADDON_DETAILS, PREVIEW_COMFIG_STATE } from "./lib/comfig-ui";
import { OFFICIAL_ADDONS } from "./lib/first-run-ui";

const status = vi.hoisted(() => ({ running: false, busy: false }));
vi.mock("./hooks/useAppStatus", () => ({ useAppStatus: () => status }));

let dom: JSDOM;
let root: Root;

/** A mastercomfig profile with its base package installed. */
const BASE_FILES = [
  { path: "tf/custom/mastercomfig-base.vpk", sha256: "base", storage: "exclusive" as const },
];

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

function render(
  onApplyPreset = vi.fn(async () => false),
  state: ComfigUiState = PREVIEW_COMFIG_STATE,
  overrides: Partial<ComponentProps<typeof ComfigPane>> = {},
) {
  root.render(
    createElement(ComfigPane, {
      detail: {
        id: "profile",
        name: "Main",
        layer: "comfig",
        launchOptions: "",
        files: BASE_FILES,
      },
      state,
      onApplyPreset,
      onApplyModules: async () => false,
      onToggleAddon: async () => false,
      onUpdatePackages: () => undefined,
      onImportCustom: () => undefined,
      ...overrides,
    }),
  );
}

describe("comfigModulesSummary", () => {
  it("counts changes from a preset, and set modules for Custom", () => {
    expect(comfigModulesSummary("medium", "Medium", 0)).toBe("Using Medium for every module");
    expect(comfigModulesSummary("medium", "Medium", 2)).toBe("2 modules changed from Medium");
    expect(comfigModulesSummary("none", "Custom", 21)).toBe("21 modules set");
    expect(comfigModulesSummary("none", "Custom", 0)).toBe("No modules set yet");
  });
});

describe("ComfigPane workspaces", () => {
  it("offers a new profile instead of unusable controls for a vanilla profile", async () => {
    const update = vi.fn();
    const tryComfig = vi.fn();
    await act(async () =>
      render(undefined, PREVIEW_COMFIG_STATE, {
        detail: { id: "vanilla", name: "Default", layer: "vanilla", launchOptions: "", files: [] },
        onUpdatePackages: update,
        onTryComfig: tryComfig,
      }),
    );
    expect(document.querySelector('[data-testid="comfig-vanilla-gate"]')?.textContent).toContain(
      "This profile doesn't use mastercomfig",
    );
    // Nothing on the page can write to this profile.
    expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(0);
    expect(document.querySelector('[data-testid="comfig-update"]')).toBeNull();
    for (const addon of OFFICIAL_ADDONS)
      expect(document.querySelector(`[data-testid="comfig-addon-${addon.id}"]`)).toBeNull();
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-testid="comfig-try-new-profile"]')?.click(),
    );
    expect(tryComfig).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
  });

  it("shows the installed release and reports a newer release for this profile", async () => {
    await act(async () =>
      render(
        undefined,
        { ...PREVIEW_COMFIG_STATE, release: { version: "9.100.0", packages: {} } },
        { onCheckRelease: async () => "9.100.1" },
      ),
    );
    expect(document.body.textContent).toContain("mastercomfig 9.100.0");
    expect(document.body.textContent).toContain("Update available: 9.100.1");
    const update = document.querySelector<HTMLButtonElement>('[data-testid="comfig-update"]');
    expect(update?.textContent).toBe("Update to 9.100.1");
    expect(update?.className).toContain("btn-primary");
  });

  it("shows no update button when the packages are current, and one place to add comfig-custom", async () => {
    await act(async () =>
      render(
        undefined,
        { ...PREVIEW_COMFIG_STATE, release: { version: "9.100.1", packages: {} } },
        { onCheckRelease: async () => "9.100.1" },
      ),
    );
    expect(document.querySelector('[data-testid="comfig-release-status"]')?.textContent).toBe(
      "Up to date.",
    );
    expect(document.querySelector('[data-testid="comfig-update"]')).toBeNull();
    expect(document.querySelector('[data-testid="comfig-import"]')?.textContent).toBe(
      "Add folder…",
    );
    expect(document.querySelector('[data-testid="comfig-extras"]')?.className).toContain(
      "text-link",
    );
  });

  it("offers installing missing packages first", async () => {
    await act(async () =>
      render(undefined, PREVIEW_COMFIG_STATE, {
        detail: { id: "bare", name: "Bare", layer: "comfig", launchOptions: "", files: [] },
      }),
    );
    const update = document.querySelector<HTMLButtonElement>('[data-testid="comfig-update"]');
    expect(update?.textContent).toBe("Install packages");
    expect(update?.className).toContain("btn-primary");
  });

  it("keeps an unknown version explicit and reports a failed check", async () => {
    await act(async () =>
      render(undefined, PREVIEW_COMFIG_STATE, {
        onCheckRelease: async () => {
          throw new Error("Network unavailable");
        },
      }),
    );
    expect(document.querySelector('[data-testid="comfig-release-status"]')?.textContent).toBe(
      "Network unavailable",
    );
    expect(document.querySelector<HTMLInputElement>("#comfig-preset-high")?.disabled).toBe(false);
  });

  it("ignores a release check completed after the profile changed", async () => {
    let finish: (value: string) => void = () => undefined;
    const oldCheck = new Promise<string>((resolve) => {
      finish = resolve;
    });
    await act(async () =>
      render(undefined, PREVIEW_COMFIG_STATE, { onCheckRelease: () => oldCheck }),
    );
    await act(async () =>
      render(undefined, PREVIEW_COMFIG_STATE, {
        detail: {
          id: "second",
          name: "Second",
          layer: "comfig",
          launchOptions: "",
          files: BASE_FILES,
        },
        onCheckRelease: async () => "9.100.1",
      }),
    );
    await act(async () => finish("old-result"));
    expect(document.querySelector('[data-testid="comfig-release-status"]')?.textContent).toContain(
      "9.100.1",
    );
    expect(document.body.textContent).not.toContain("old-result");
  });

  it("keeps every module on its own view and every addon on the first, with no folds", async () => {
    await act(async () => render());
    expect(document.querySelector("details")).toBeNull();
    const modules = document.querySelector('[data-testid="comfig-modules"]');
    expect(modules?.hasAttribute("hidden")).toBe(true);
    expect(document.getElementById("comfig-view-modules")?.textContent).toBe("Modules 1");
    expect(document.querySelector('[data-testid="comfig-modules-summary"]')?.textContent).toBe(
      "1 module changed from Medium",
    );
    await act(async () => document.getElementById("comfig-view-modules")?.click());
    expect(modules?.hasAttribute("hidden")).toBe(false);
    for (const group of COMFIG_MODULE_GROUPS) {
      expect(document.getElementById(`comfig-module-group-${group.id}`)?.textContent).toBe(
        group.label,
      );
      for (const module of group.modules) {
        expect(document.querySelector(`[data-testid="comfig-module-${module.id}"]`)).not.toBeNull();
      }
    }
    const filter = (id: string) =>
      document.querySelector<HTMLInputElement>(`[data-testid="comfig-modules-filter-${id}"]`);
    await act(async () => filter("changed")?.click());
    expect(
      [...document.querySelectorAll<HTMLElement>('[data-testid^="comfig-module-"]')].map(
        (module) => module.dataset.testid,
      ),
    ).toEqual(["comfig-module-texture_quality"]);
    await act(async () => filter("hud")?.click());
    expect(document.querySelectorAll('[data-testid^="comfig-module-"]')).toHaveLength(
      COMFIG_MODULE_GROUPS.find((group) => group.id === "hud")?.modules.length ?? -1,
    );
    for (const addon of OFFICIAL_ADDONS) {
      expect(
        document.querySelector(`[data-testid="comfig-addon-${addon.id}"]`)?.getAttribute("role"),
      ).toBe("switch");
    }
    expect(document.body.textContent).toContain(OFFICIAL_ADDON_DETAILS["transparent-viewmodels"]);
  });

  it("keeps the committed preset summary when a selection fails", async () => {
    const apply = vi.fn(async () => false);
    await act(async () => render(apply));
    const summary = document.querySelector('[data-testid="comfig-modules-summary"]');
    expect(summary?.textContent).toBe("1 module changed from Medium");
    await act(async () => document.getElementById("comfig-preset-high")?.click());
    expect(apply).toHaveBeenCalledWith("high");
    expect(document.querySelector<HTMLInputElement>("#comfig-preset-medium")?.checked).toBe(true);
    expect(summary?.textContent).toBe("1 module changed from Medium");
    expect(document.querySelector("img")).toBeNull();
    for (const preset of COMFIG_PRESETS) {
      expect(document.getElementById(`comfig-preset-${preset.id}`)).not.toBeNull();
    }
    expect(document.body.textContent).not.toContain("Show all presets");
  });

  it("discloses an older selected preset while offering only current choices", async () => {
    await act(async () => render(undefined, { ...PREVIEW_COMFIG_STATE, preset: "medium_high" }));
    expect(document.querySelector('[data-testid="comfig-old-preset"]')?.textContent).toContain(
      "Medium high, which current mastercomfig no longer supports",
    );
    expect(document.getElementById("comfig-preset-medium_high")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
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

  it("distinguishes inheriting a preset from the literal post-processing default", async () => {
    await act(async () => render());
    const picker = document.querySelector('[data-testid="comfig-module-post_processing"]');
    const labels = [...(picker?.querySelectorAll("button") ?? [])].map(
      (button) => button.textContent,
    );
    expect(labels).toContain("Use preset");
    expect(labels).toContain("Module default");
    expect(labels.filter((label) => label === "Default")).toHaveLength(0);
  });
});
