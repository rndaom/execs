import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutosavePending } from "./hooks/useAutosave";
import type { Api } from "./lib/api";
import { PREVIEW_MODS_CATALOG, PREVIEW_MODS_STATUS, PREVIEW_PROFILE_MODS } from "./lib/mods-ui";
import { ModsPane, type ModsPaneProps } from "./ModsPane";

const appState = vi.hoisted(() => ({ running: false, busy: false }));
vi.mock("./hooks/useAppStatus", () => ({
  useAppStatus: () => appState,
  useCanWrite: () => !appState.running && !appState.busy,
}));

let dom: JSDOM;
let root: Root;

beforeEach(() => {
  appState.running = false;
  appState.busy = false;
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
    active: false,
    profileId: "mvm",
    payload: PREVIEW_MODS_STATUS,
    catalog: PREVIEW_MODS_CATALOG,
    mods: PREVIEW_PROFILE_MODS,
    loading: false,
    report: null,
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
    onInstallGameBananaMod: vi.fn(async () => true),
    ...overrides,
  };
}

function button(id: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
  expect(found).not.toBeNull();
  return found as HTMLButtonElement;
}

describe("ModsPane profile particle containment", () => {
  it("shows only saved library choices and lets an uncached legacy choice be removed", async () => {
    const onApply = vi.fn();
    const initial = props({
      payload: { ...PREVIEW_MODS_STATUS, modsCached: false },
      onApply,
    });
    await act(async () => root.render(createElement(ModsPane, initial)));
    await act(async () => document.getElementById("mods-task-casual")?.click());

    expect(document.querySelector('[data-testid="mods-particle-tf2-classic"]')).toBeNull();
    expect(
      document.querySelector('[data-testid="mods-addon-ultimate-visual-fix-pack"]'),
    ).toBeNull();
    const saved = button("mods-particle-square-series");
    expect(saved.getAttribute("aria-checked")).toBe("true");
    expect(document.body.textContent).toContain("New library choices and downloads are paused");

    await act(async () => saved.click());
    expect(saved.getAttribute("aria-checked")).toBe("false");
    expect(button("mods-apply").disabled).toBe(false);
    await act(async () => button("mods-apply").click());
    expect(onApply).toHaveBeenCalledWith(["No Burning Overlay"], [], []);

    await act(async () => saved.click());
    expect(saved.getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector('[data-testid="mods-apply"]')).toBeNull();
  });

  it("routes a refused HUD payload to explicit HUD review without retrying an install", async () => {
    const onReviewHudImport = vi.fn();
    const onDismissHudImport = vi.fn();
    const initial = props({
      hudImportRequired: "Nothing was installed. Extract this HUD VPK and import its folder.",
      onReviewHudImport,
      onDismissHudImport,
    });
    await act(async () => root.render(createElement(ModsPane, initial)));
    const alert = document.querySelector('[data-testid="mods-hud-import-required"]');
    expect(alert?.textContent).toContain("Extract this HUD VPK and import its folder.");
    expect(alert?.textContent).toContain("select the intended source again");
    const buttons = [...(alert?.querySelectorAll("button") ?? [])];
    await act(async () => buttons.find((item) => item.textContent === "Review in HUD")?.click());
    expect(onReviewHudImport).toHaveBeenCalledOnce();
    expect(initial.onImportArchive).not.toHaveBeenCalled();
    expect(initial.onImportFolder).not.toHaveBeenCalled();
    expect(initial.onInstallGameBananaMod).not.toHaveBeenCalled();
    await act(async () => buttons.find((item) => item.textContent === "Dismiss")?.click());
    expect(onDismissHudImport).toHaveBeenCalledOnce();
  });

  it("registers unapplied selection without an implicit heavy save and clears it after Apply", async () => {
    const reportPending = vi.fn();
    const initial = props();
    const render = (next: ModsPaneProps) =>
      createElement(
        AutosavePending.Provider,
        { value: reportPending },
        createElement(ModsPane, next),
      );
    await act(async () => root.render(render(initial)));
    await act(async () => button("mods-particle-square-series").click());
    expect(reportPending).toHaveBeenLastCalledWith(expect.any(String), true);
    expect(initial.onApply).not.toHaveBeenCalled();

    const payload = {
      ...PREVIEW_MODS_STATUS,
      status: { ...PREVIEW_MODS_STATUS.status, particleMods: [] },
    };
    await act(async () => root.render(render({ ...initial, payload })));
    expect(reportPending).toHaveBeenLastCalledWith(expect.any(String), false);
  });

  it("defaults to Browse, keeps task state mounted, and routes stale work to Casual setup", async () => {
    const payload = {
      ...PREVIEW_MODS_STATUS,
      status: { ...PREVIEW_MODS_STATUS.status, stale: true },
    };
    await act(async () => root.render(createElement(ModsPane, props({ payload }))));

    const browse = document.getElementById("mods-task-browse") as HTMLButtonElement;
    const installed = document.getElementById("mods-task-installed") as HTMLButtonElement;
    expect(installed.textContent).toContain("Custom packs");
    const casual = document.getElementById("mods-task-casual") as HTMLButtonElement;
    expect(browse.getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector('[data-testid="mods-yours-list"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="mods-stale"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="mods-apply"]')).not.toBeNull();

    await act(async () => installed.click());
    expect(installed.getAttribute("aria-selected")).toBe("true");
    await act(async () => casual.click());
    expect(casual.getAttribute("aria-selected")).toBe("true");
    expect(button("mods-apply").disabled).toBe(false);
  });

  it("opens the shared Casual preload setting from Viewmodels", async () => {
    const initial = props({ casualOpenRequest: 0 });
    await act(async () => root.render(createElement(ModsPane, initial)));
    expect(document.getElementById("mods-task-browse")?.getAttribute("aria-selected")).toBe("true");
    await act(async () =>
      root.render(createElement(ModsPane, { ...initial, casualOpenRequest: 1 })),
    );
    expect(document.getElementById("mods-task-casual")?.getAttribute("aria-selected")).toBe("true");
  });

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
    await act(async () => button("mods-particle-square-series").click());
    expect(button("mods-apply").disabled).toBe(false);

    await act(async () => root.render(createElement(ModsPane, { ...initial, profileId: "other" })));
    expect(button("mods-particle-square-series").getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector('[data-testid="mods-apply"]')).toBeNull();
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
    await act(async () => document.getElementById("mods-task-casual")?.click());
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

  it("keeps the launch-hook retry available even when no selection is dirty", async () => {
    const onTogglePreload = vi.fn();
    const payload = { ...PREVIEW_MODS_STATUS, preloadLaunchInSteam: false };
    await act(async () =>
      root.render(createElement(ModsPane, props({ payload, onTogglePreload }))),
    );
    await act(async () => document.getElementById("mods-task-casual")?.click());
    expect(document.querySelector('[data-testid="mods-apply"]')).toBeNull();
    const retry = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent === "Retry launch setup",
    );
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    expect(onTogglePreload).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("keeps a Casual selection editable while TF2 runs but refuses Apply", async () => {
    appState.running = true;
    const onApply = vi.fn();
    await act(async () => root.render(createElement(ModsPane, props({ onApply }))));
    await act(async () => document.getElementById("mods-task-casual")?.click());
    const choice = button("mods-particle-square-series");
    expect(choice.disabled).toBe(false);
    await act(async () => choice.click());
    expect(choice.getAttribute("aria-checked")).toBe("false");
    expect(button("mods-apply").disabled).toBe(true);
    await act(async () => button("mods-apply").click());
    expect(onApply).not.toHaveBeenCalled();
  });

  it("reviews restoration with Cancel focused and rechecks the write lock", async () => {
    const onRevert = vi.fn();
    const initial = props({ onRevert, active: true });
    await act(async () => root.render(createElement(ModsPane, initial)));
    await act(async () => document.getElementById("mods-task-casual")?.click());
    await act(async () => button("mods-revert").click());
    expect(document.activeElement?.textContent).toBe("Cancel");
    appState.running = true;
    await act(async () => root.render(createElement(ModsPane, { ...initial })));
    expect(button("mods-restore-confirm-yes").disabled).toBe(true);
    await act(async () => button("mods-restore-confirm-yes").click());
    expect(onRevert).not.toHaveBeenCalled();
  });
});

describe("ModsPane particle overlaps", () => {
  it("names the winning mod for each shared file and changes it only through the draft", async () => {
    const first = { ...PREVIEW_PROFILE_MODS[1], id: "trails-a", name: "Trails A" };
    const second = { ...PREVIEW_PROFILE_MODS[1], id: "trails-b", name: "Trails B" };
    const payload = {
      ...PREVIEW_MODS_STATUS,
      status: {
        ...PREVIEW_MODS_STATUS.status,
        particleMods: [],
        profileParticleMods: ["trails-a", "trails-b"],
      },
      profileParticleSources: [
        { modId: "trails-a", name: "Trails A", pcfFiles: ["RocketTrail.pcf", "explosion.pcf"] },
        { modId: "trails-b", name: "Trails B", pcfFiles: ["rockettrail.pcf"] },
      ],
    };
    const onApply = vi.fn();
    await act(async () =>
      root.render(createElement(ModsPane, props({ payload, mods: [first, second], onApply }))),
    );
    await act(async () => document.getElementById("mods-task-casual")?.click());

    const conflict = () =>
      document.querySelector('[data-testid="mods-particle-conflict-rockettrail.pcf"]');
    expect(conflict()?.textContent).toContain("Trails B wins over Trails A");
    expect(
      document.querySelector('[data-testid="mods-particle-conflict-explosion.pcf"]'),
    ).toBeNull();
    expect(document.body.textContent).toContain("not merged");

    const use = [...(conflict()?.querySelectorAll("button") ?? [])].find(
      (candidate) => candidate.textContent === "Use Trails A",
    );
    expect(use?.getAttribute("aria-label")).toBe("Use Trails A for rockettrail.pcf");
    await act(async () => use?.click());
    expect(conflict()?.textContent).toContain("Trails A wins over Trails B");
    expect(onApply).not.toHaveBeenCalled();
    await act(async () => button("mods-apply").click());
    expect(onApply).toHaveBeenCalledWith(expect.any(Array), [], ["trails-b", "trails-a"]);
  });
});
