import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "./lib/api";
import { PREVIEW_MODS_CATALOG, PREVIEW_MODS_STATUS, PREVIEW_PROFILE_MODS } from "./lib/mods-ui";
import { ModsPane, type ModsPaneProps } from "./ModsPane";

vi.mock("./hooks/useAppStatus", () => ({
  useAppStatus: () => ({ running: false, busy: false }),
  useCanWrite: () => true,
}));

let dom: JSDOM;
let root: Root;

beforeEach(() => {
  dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("root") as HTMLElement);
});

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function props(overrides: Partial<ModsPaneProps> = {}): ModsPaneProps {
  return {
    api: {} as Api,
    profileId: "mvm",
    payload: PREVIEW_MODS_STATUS,
    catalog: PREVIEW_MODS_CATALOG,
    mods: PREVIEW_PROFILE_MODS,
    loading: false,
    report: null,
    onDownloadLibrary: vi.fn(),
    onApply: vi.fn(),
    onToggleBypass: vi.fn(),
    onTogglePreload: vi.fn(),
    onRevert: vi.fn(),
    onRecover: vi.fn(),
    onRepair: vi.fn(async () => {}),
    onCompleteRepair: vi.fn(async () => true),
    onCancelRepair: vi.fn(async () => true),
    onRefreshStatus: vi.fn(async () => {}),
    onOpenRepo: vi.fn(),
    onImportArchive: vi.fn(),
    onImportFolder: vi.fn(),
    onRemoveMod: vi.fn(),
    onInstallGameBananaMod: vi.fn(async () => {}),
    ...overrides,
  };
}

function button(id: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
  expect(found).not.toBeNull();
  return found as HTMLButtonElement;
}

describe("ModsPane profile particle containment", () => {
  it("never applies a previous profile's hidden particle ID even with stale status", async () => {
    const id = "high-vis-mvm-cash-particles-gigantic";
    const cash = { ...PREVIEW_PROFILE_MODS[1], id, name: "High vis MvM cash particles" };
    const payload = {
      ...PREVIEW_MODS_STATUS,
      status: { ...PREVIEW_MODS_STATUS.status, profileParticleMods: [id] },
      profileParticleSources: [{ modId: id, name: cash.name, pcfFiles: ["mvm_cash.pcf"] }],
    };
    const onApply = vi.fn();
    await act(async () => root.render(createElement(ModsPane, props({ payload, mods: [cash] }))));
    expect(document.body.textContent).toContain(cash.name);

    // Profile details arrive first; the old preloader payload is still mounted.
    await act(async () =>
      root.render(
        createElement(ModsPane, props({ profileId: "colly", mods: [], payload, onApply })),
      ),
    );
    expect(document.body.textContent).not.toContain(cash.name);
    expect(button("mods-apply").disabled).toBe(false);
    await act(async () => button("mods-apply").click());
    expect(onApply).toHaveBeenCalledWith(["No Burning Overlay"], ["Square_Series"], []);
  });

  it("discards dirty picks when profiles change even if their installed bytes match", async () => {
    const initial = props();
    await act(async () => root.render(createElement(ModsPane, initial)));
    await act(async () => button("mods-particle-tf2-classic").click());
    expect(button("mods-apply").disabled).toBe(false);

    await act(async () => root.render(createElement(ModsPane, { ...initial, profileId: "other" })));
    expect(button("mods-particle-tf2-classic").getAttribute("aria-checked")).toBe("false");
    expect(button("mods-apply").disabled).toBe(true);
  });

  it("resumes repair with only the current profile's available particle sources", async () => {
    const onCompleteRepair = vi.fn(async () => true);
    const payload = {
      ...PREVIEW_MODS_STATUS,
      repairInProgress: true,
      profileParticleSources: [],
      status: {
        ...PREVIEW_MODS_STATUS.status,
        profileParticleMods: ["removed-cash-mod"],
        untrackedModified: [],
      },
    };
    await act(async () =>
      root.render(createElement(ModsPane, props({ payload, mods: [], onCompleteRepair }))),
    );
    const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
      item.textContent?.includes("Steam says it’s finished"),
    );
    expect(confirm).toBeDefined();
    await act(async () => confirm?.click());
    expect(onCompleteRepair).toHaveBeenCalledWith({
      addons: ["No Burning Overlay"],
      particleMods: ["Square_Series"],
      profileParticleMods: [],
    });
  });
});
