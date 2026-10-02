// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsDraftBoundary } from "./components/SettingsDraftBoundary";
import { AppStatusProvider } from "./hooks/useAppStatus";
import {
  getViewmodelSourceCatalog,
  type ViewmodelBuildRequest,
  type ViewmodelRecord,
  type ViewmodelSourceCatalog,
} from "./lib/bridge";
import { createSettingsDraftStore, type SettingsDraftStore } from "./lib/settings-drafts";
import { resetViewmodelCatalogCache } from "./lib/viewmodel-catalog-cache";
import { ViewmodelPane } from "./ViewmodelPane";

vi.mock("./lib/bridge", () => ({ getViewmodelSourceCatalog: vi.fn() }));

const catalog: ViewmodelSourceCatalog = {
  status: "provisional",
  catalog: { patchVersion: "10828683", catalogSha256: "first" },
  sourceFingerprints: [{ id: "models/weapons/c_models/c_scout_animations.mdl", sha256: "source" }],
  groups: [
    {
      id: "scout/a",
      class: "scout",
      items: [{ id: 13, schemaName: "TF_WEAPON_SCATTERGUN", slot: "primary" }],
      animations: ["draw"],
      overlaps: ["scout/b"],
      teamVariantsDiffer: false,
    },
    {
      id: "scout/b",
      class: "scout",
      items: [{ id: 14, schemaName: "The Shortstop", slot: "primary" }],
      animations: ["draw", "idle"],
      overlaps: ["scout/a"],
      teamVariantsDiffer: true,
    },
    {
      id: "soldier/c",
      class: "soldier",
      items: [{ id: 18, schemaName: "TF_WEAPON_ROCKETLAUNCHER", slot: "primary" }],
      animations: ["fire"],
      overlaps: [],
      teamVariantsDiffer: false,
    },
  ],
  unresolvedItems: [],
  unresolvedRoleCount: 0,
  candidateRoleCount: 0,
};

let box: HTMLDivElement;
let root: Root;
let running: boolean;
let record: ViewmodelRecord | null;
let profileId: string;
let paneActive: boolean;
let focused: boolean;
let visible: boolean;
let now: number;
let drafts: SettingsDraftStore;
const getCatalog = vi.mocked(getViewmodelSourceCatalog);
const importPack = vi.fn();
const removePack = vi.fn();
let buildPack: (request: ViewmodelBuildRequest) => Promise<boolean>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  running = false;
  record = null;
  profileId = "profile-one";
  paneActive = true;
  focused = true;
  visible = true;
  now = 1_000_000;
  drafts = createSettingsDraftStore();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
    visible ? "visible" : "hidden",
  );
  getCatalog.mockReset();
  getCatalog.mockResolvedValue(catalog);
  importPack.mockReset();
  removePack.mockReset();
  buildPack = vi.fn(async () => true);
  resetViewmodelCatalogCache();
});

afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(profilePreload: boolean | null = true, globalShown = true) {
  await act(async () =>
    root.render(
      <AppStatusProvider value={{ running, busy: false, error: null, setError: () => {} }}>
        <SettingsDraftBoundary
          store={drafts}
          profile={profileId}
          tab="viewmodels"
          active={paneActive}
          blocked={false}
        >
          <ViewmodelPane
            active={paneActive}
            profileId={profileId}
            record={record}
            settings={{
              effective: {},
              managedText: `r_drawviewmodel ${globalShown ? 1 : 0}\n`,
              cfgReady: true,
              transparentViewmodels: false,
              canUseComfigAddons: true,
              onToggleTransparentViewmodels: () => undefined,
              onSave: async () => undefined,
            }}
            profilePreload={profilePreload}
            loadCatalog={getCatalog}
            onImport={importPack}
            onBuild={buildPack}
            onRemove={removePack}
          />
        </SettingsDraftBoundary>
      </AppStatusProvider>,
    ),
  );
}

function element<T extends HTMLElement>(selector: string): T {
  const result = box.querySelector<T>(selector);
  if (!result) throw new Error(`Missing ${selector}`);
  return result;
}

async function click(selector: string) {
  await act(async () => element(selector).click());
}

const WEAPON_MODES: Record<string, string> = {
  Shown: "shown",
  Hidden: "full",
  "Hands only": "weapon",
};

/** Set one weapon on its own from its row under the slot. */
async function chooseWeapon(groupId: string, label: string) {
  await click(`[data-testid="viewmodel-weapon-choice-${groupId}-${WEAPON_MODES[label]}"]`);
}

describe("Viewmodels source-derived draft", () => {
  it("shows class sections and short labels while release Build stays unavailable", async () => {
    await render(false, false);
    expect(box.textContent).toContain("Import VPK");
    expect(box.textContent).not.toContain("being prepared for 0.2.0");
    expect(box.textContent).not.toContain("Casual preload");
    expect(box.textContent).toContain("Every viewmodel is hidden in game");
    expect(box.textContent).toContain("Scattergun");
    expect(box.querySelector('[data-testid="viewmodel-slot-primary"]')?.textContent).toContain(
      "Primary",
    );
    expect(box.textContent).toContain("Everything shown");
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-review-build"]').disabled).toBe(
      true,
    );
    await click('[data-testid="viewmodel-slot-choice-primary-full"]');
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-review-build"]').disabled).toBe(
      false,
    );
    await click('[data-testid="viewmodel-review-build"]');
    expect(box.textContent).toContain("Build pack");
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-build"]').disabled).toBe(false);
    expect(box.querySelector("img")).toBeNull();
    await click('[data-testid="viewmodel-import"]');
    expect(importPack).toHaveBeenCalledWith(false);
  });

  it("keeps a previously built profile record visible and read only", async () => {
    record = {
      id: "execs-viewmodels",
      source: "compiled",
      preload: true,
      options: { hidden: "scout/scatterguns,scout/melee", mode: "full", schema: "yttrium-1" },
    };
    await render();
    expect(element('[data-testid="viewmodel-pack-status"]').textContent).toContain(
      "Previous build",
    );
    expect(element('[data-testid="viewmodel-saved-pack"]').textContent).toContain(
      "Built with the previous builder · 2 choices",
    );
    await click('[data-testid="viewmodel-remove"]');
    expect(removePack).toHaveBeenCalledOnce();
    await click('[data-testid="viewmodel-import"]');
    expect(importPack).toHaveBeenCalledWith(true);
  });

  it("warns when saved VPK bytes changed externally and keeps imported packs available", async () => {
    record = {
      id: "execs-viewmodels",
      source: "imported",
      preload: false,
      sourceChanged: true,
      options: {},
    };
    await render();
    expect(element('[data-testid="viewmodel-source-changed"]').textContent).toContain(
      "This pack was changed outside execs",
    );
    expect(box.textContent).toContain("Replace with VPK");
    expect(element('[data-testid="viewmodel-pack-status"]').textContent).toContain("Imported");
  });

  it("shows a locally built recipe's choices when the installed sources still match", async () => {
    record = {
      id: "execs-viewmodels",
      source: "stockBuilt",
      preload: true,
      options: {},
      buildRecipe: {
        schema: 1,
        catalog: catalog.catalog,
        sourceFingerprints: catalog.sourceFingerprints,
        choices: [{ groupId: "scout/a", mode: "weapon" }],
      },
    };
    await render();
    expect(element('[data-testid="viewmodel-pack-status"]').textContent).toContain("Built");
    expect(element('[data-testid="viewmodel-saved-pack"]').textContent).toContain("Built in execs");
    expect(
      element<HTMLInputElement>('[data-testid="viewmodel-slot-choice-primary-weapon"]').checked,
    ).toBe(true);
    expect(element('[data-testid="viewmodel-choice-summary"]').textContent).toBe("1 class changed");
    // The Shortstop was saved as shown, so it is kept as a weapon set on its own.
    expect(
      element('[data-testid="viewmodel-weapon"][data-group-id="scout/b"]').dataset.choice,
    ).toBe("shown");
    expect(box.querySelector("details")).toBeNull();
    await click('[data-testid="viewmodel-slot-choice-primary-full"]');
    expect(element('[data-testid="viewmodel-choice-summary"]').textContent).toBe(
      "1 class changed · not built yet",
    );
    expect(
      element('[data-testid="viewmodel-weapon"][data-group-id="scout/b"]').dataset.choice,
    ).toBe("shown");
  });

  it("keeps write operations disabled while TF2 runs or preload state is still loading", async () => {
    running = true;
    record = {
      id: "execs-viewmodels",
      source: "compiled",
      preload: true,
      options: {},
    };
    await render();
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-import"]').disabled).toBe(true);
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-remove"]').disabled).toBe(true);
    running = false;
    await render(null);
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-import"]').disabled).toBe(true);
  });

  it("keeps a failed refresh stale and protects choices until an updated catalog is explicitly accepted", async () => {
    await render();
    await click('[data-testid="viewmodel-slot-choice-primary-full"]');
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-review-build"]').disabled).toBe(
      false,
    );

    getCatalog.mockRejectedValueOnce(new Error("TF2 source read failed"));
    await click('[data-testid="viewmodel-catalog-refresh"]');
    expect(box.textContent).toContain("TF2 source read failed");
    expect(box.textContent).toContain("Scattergun");
    expect(
      element<HTMLInputElement>('[data-testid="viewmodel-slot-choice-primary-full"]').disabled,
    ).toBe(true);

    getCatalog.mockResolvedValueOnce({
      ...catalog,
      sourceFingerprints: [{ id: "models/weapons/c_models/c_scout_animations.mdl", sha256: "new" }],
    });
    await click('[data-testid="viewmodel-catalog-refresh"]');
    expect(box.textContent).toContain("these choices can't be built");
    expect(
      element<HTMLInputElement>('[data-testid="viewmodel-slot-choice-primary-full"]').checked,
    ).toBe(true);
    expect(drafts.getSnapshot()).toHaveLength(1);
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-review-build"]').disabled).toBe(
      true,
    );
    expect(buildPack).not.toHaveBeenCalled();
    await click('[data-testid="viewmodel-discard-reload"]');
    expect(
      element<HTMLInputElement>('[data-testid="viewmodel-slot-choice-primary-shown"]').checked,
    ).toBe(true);
    expect(drafts.getSnapshot()).toHaveLength(0);
  });

  it("reads only on focused active use, keeps drafts while hidden, and closes review", async () => {
    paneActive = false;
    await render();
    expect(getCatalog).not.toHaveBeenCalled();
    paneActive = true;
    focused = false;
    visible = false;
    await render();
    expect(getCatalog).not.toHaveBeenCalled();
    focused = true;
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(getCatalog).not.toHaveBeenCalled();
    visible = true;
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(getCatalog).toHaveBeenCalledTimes(1);

    await click('[data-testid="viewmodel-slot-choice-primary-full"]');
    await click('[data-testid="viewmodel-review-build"]');
    expect(box.querySelector('[data-testid="viewmodel-build-review"]')).not.toBeNull();
    paneActive = false;
    await render();
    expect(box.querySelector('[data-testid="viewmodel-build-review"]')).toBeNull();
    expect(drafts.getSnapshot()).toHaveLength(1);
    focused = false;
    await act(async () => window.dispatchEvent(new Event("blur")));
    focused = true;
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(getCatalog).toHaveBeenCalledTimes(1);

    // Reopening soon after a read reuses it; a stale read is checked again.
    paneActive = true;
    await render();
    expect(getCatalog).toHaveBeenCalledTimes(1);
    paneActive = false;
    await render();
    now += 3 * 60_000;
    paneActive = true;
    await render();
    expect(
      element<HTMLInputElement>('[data-testid="viewmodel-slot-choice-primary-full"]').checked,
    ).toBe(true);
    expect(getCatalog).toHaveBeenCalledTimes(2);

    focused = false;
    await act(async () => window.dispatchEvent(new Event("blur")));
    now += 3 * 60_000;
    focused = true;
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(getCatalog).toHaveBeenCalledTimes(3);
  });

  it("starts a fresh planning draft after switching profiles", async () => {
    await render();
    await click('[data-testid="viewmodel-slot-choice-primary-weapon"]');
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-review-build"]').disabled).toBe(
      false,
    );
    profileId = "profile-two";
    await render();
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-review-build"]').disabled).toBe(
      true,
    );
    // The new profile reuses the recent catalog read instead of waiting on TF2's files.
    expect(getCatalog).toHaveBeenCalledTimes(1);
  });

  it("previews a whole-profile change, applies it only to the draft and can undo it", async () => {
    await render();
    await click('[data-testid="viewmodel-slot-choice-primary-weapon"]');
    await click('[data-testid="viewmodel-presets"]');
    await click('[data-testid="viewmodel-preset-hide-all"]');
    // Each class with the result it would have.
    expect(element('[data-testid="viewmodel-preset-count"]').textContent).toBe("Afterwards:");
    const changes = element('[data-testid="viewmodel-preset-changes"]').textContent ?? "";
    expect(changes).toContain("ScoutPrimary hidden");
    expect(changes).toContain("SoldierPrimary hidden");

    // Cancel leaves the custom selection exactly as it was.
    const cancel = [...box.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Cancel",
    );
    await act(async () => cancel?.click());
    expect(element('[data-testid="viewmodel-choice-summary"]').textContent).toBe(
      "1 class changed · not built yet",
    );

    await click('[data-testid="viewmodel-presets"]');
    await click('[data-testid="viewmodel-preset-hide-all"]');
    await click('[data-testid="viewmodel-preset-apply"]');
    expect(element('[data-testid="viewmodel-choice-summary"]').textContent).toBe(
      "2 classes changed · not built yet",
    );
    expect(buildPack).not.toHaveBeenCalled();
    await click('[data-testid="viewmodel-preset-undo"]');
    expect(element('[data-testid="viewmodel-choice-summary"]').textContent).toBe(
      "1 class changed · not built yet",
    );
    expect(box.querySelector('[data-testid="viewmodel-preset-undo"]')).toBeNull();

    // Show all is a no-op review when nothing is hidden, and a row edit ends undo.
    await click('[data-testid="viewmodel-presets"]');
    await click('[data-testid="viewmodel-preset-show-all"]');
    await click('[data-testid="viewmodel-preset-apply"]');
    expect(element('[data-testid="viewmodel-choice-summary"]').textContent).toBe(
      "Everything shown",
    );
    await chooseWeapon("scout/b", "Hidden");
    expect(box.querySelector('[data-testid="viewmodel-preset-undo"]')).toBeNull();
    await click('[data-testid="viewmodel-presets"]');
    await click('[data-testid="viewmodel-preset-keep-melee"]');
    await click('[data-testid="viewmodel-preset-mode-full"]');
    expect(element('[data-testid="viewmodel-preset-changes"]').textContent).toContain(
      "SoldierPrimary hidden",
    );
  });

  it("identifies overlapping modes during review", async () => {
    await render();
    await click('[data-testid="viewmodel-slot-choice-primary-full"]');
    await chooseWeapon("scout/b", "Hands only");
    expect(element('[data-testid="viewmodel-conflict"]').textContent).toContain(
      "Scattergun and Shortstop share animations",
    );
    await click('[data-testid="viewmodel-review-build"]');
    expect(box.textContent).toContain("set differently");
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-build"]').disabled).toBe(true);
  });

  it("builds the reviewed request", async () => {
    let finish: (ok: boolean) => void = () => {};
    const handler = vi.fn(
      (_request: ViewmodelBuildRequest) =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    buildPack = handler;
    await render(true);
    await click('[data-testid="viewmodel-slot-choice-primary-full"]');
    await click('[data-testid="viewmodel-review-build"]');
    expect(box.textContent).toContain("Build pack");
    const build = element<HTMLButtonElement>('[data-testid="viewmodel-build"]');
    expect(build.disabled).toBe(false);
    await act(async () => build.click());
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toEqual({
      catalog: catalog.catalog,
      sourceFingerprints: catalog.sourceFingerprints,
      choices: [
        { groupId: "scout/a", mode: "full" },
        { groupId: "scout/b", mode: "full" },
      ],
      preload: true,
    });
    expect(box.textContent).toContain("Building from your TF2 files");
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-build"]').disabled).toBe(true);
    await act(async () => finish(false));
    expect(box.querySelector('[data-testid="viewmodel-build-review"]')).not.toBeNull();
    expect(drafts.getSnapshot()).toHaveLength(1);
    await click('[data-testid="viewmodel-build"]');
    await act(async () => finish(true));
    expect(box.querySelector('[data-testid="viewmodel-build-review"]')).toBeNull();
    expect(drafts.getSnapshot()).toHaveLength(0);
    expect(box.textContent).not.toContain("not built yet");
  });

  it("keeps Build disabled while TF2 runs or choices conflict", async () => {
    buildPack = vi.fn(async () => true);
    running = true;
    await render();
    await click('[data-testid="viewmodel-slot-choice-primary-full"]');
    await click('[data-testid="viewmodel-review-build"]');
    expect(box.textContent).toContain("Close TF2 before building");
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-build"]').disabled).toBe(true);
    running = false;
    await render();
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-build"]').disabled).toBe(false);
    await click('[data-testid="viewmodel-build-review"] .btn-ghost');
    expect(box.querySelector('[data-testid="viewmodel-build-review"]')).toBeNull();
    await chooseWeapon("scout/b", "Hands only");
    await click('[data-testid="viewmodel-review-build"]');
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-build"]').disabled).toBe(true);
    expect(buildPack).not.toHaveBeenCalled();
  });

  it("keeps locked choices in the session guard and lets an explicit discard reset them", async () => {
    running = true;
    await render();
    await click('[data-testid="viewmodel-slot-choice-primary-full"]');
    expect(drafts.getSnapshot()).toHaveLength(1);
    expect(await drafts.flush()).toBe(false);
    expect(buildPack).not.toHaveBeenCalled();
    await act(async () => {
      expect(drafts.discard()).toBe(true);
    });
    expect(drafts.getSnapshot()).toHaveLength(0);
    expect(
      element<HTMLInputElement>('[data-testid="viewmodel-slot-choice-primary-shown"]').checked,
    ).toBe(true);
  });

  it("acknowledges only the built snapshot while newer choices and preset Undo stay protected", async () => {
    let finish: (ok: boolean) => void = () => {};
    buildPack = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    await render();
    await click('[data-testid="viewmodel-slot-choice-primary-full"]');
    await click('[data-testid="viewmodel-review-build"]');
    await click('[data-testid="viewmodel-build"]');
    // Simulate the user's newer selection while the asynchronous write is pending.
    await click('[data-testid="viewmodel-slot-choice-primary-weapon"]');
    record = {
      id: "execs-viewmodels",
      source: "stockBuilt",
      preload: true,
      options: {},
      buildRecipe: {
        schema: 1,
        catalog: catalog.catalog,
        sourceFingerprints: catalog.sourceFingerprints,
        choices: [
          { groupId: "scout/a", mode: "full" },
          { groupId: "scout/b", mode: "full" },
        ],
      },
    };
    await render();
    await act(async () => finish(true));
    expect(
      element<HTMLInputElement>('[data-testid="viewmodel-slot-choice-primary-weapon"]').checked,
    ).toBe(true);
    expect(drafts.getSnapshot()).toHaveLength(1);
    await click('[data-testid="viewmodel-discard-draft"]');
    expect(
      element<HTMLInputElement>('[data-testid="viewmodel-slot-choice-primary-full"]').checked,
    ).toBe(true);
    expect(drafts.getSnapshot()).toHaveLength(0);
    await click('[data-testid="viewmodel-presets"]');
    await click('[data-testid="viewmodel-preset-show-all"]');
    await click('[data-testid="viewmodel-preset-apply"]');
    expect(box.textContent).toContain("remove the saved pack below");
    expect(drafts.getSnapshot()).toHaveLength(1);
    await click('[data-testid="viewmodel-preset-undo"]');
    expect(drafts.getSnapshot()).toHaveLength(0);
  });

  it("keeps a rejected build retryable and reseeds clean choices after a saved pack is removed", async () => {
    buildPack = vi.fn().mockRejectedValueOnce(new Error("disk refused")).mockResolvedValue(true);
    await render();
    await click('[data-testid="viewmodel-slot-choice-primary-full"]');
    await click('[data-testid="viewmodel-review-build"]');
    await click('[data-testid="viewmodel-build"]');
    expect(drafts.getSnapshot()).toHaveLength(1);
    await click('[data-testid="viewmodel-build"]');
    expect(drafts.getSnapshot()).toHaveLength(0);
    record = {
      id: "execs-viewmodels",
      source: "stockBuilt",
      preload: true,
      options: {},
      buildRecipe: {
        schema: 1,
        catalog: catalog.catalog,
        sourceFingerprints: catalog.sourceFingerprints,
        choices: [
          { groupId: "scout/a", mode: "full" },
          { groupId: "scout/b", mode: "full" },
        ],
      },
    };
    await render();
    record = null;
    await render();
    expect(
      element<HTMLInputElement>('[data-testid="viewmodel-slot-choice-primary-shown"]').checked,
    ).toBe(true);
    expect(drafts.getSnapshot()).toHaveLength(0);
  });

  it("keeps a newer edit when the saved recipe arrives after build completion", async () => {
    await render();
    await click('[data-testid="viewmodel-slot-choice-primary-full"]');
    await click('[data-testid="viewmodel-review-build"]');
    await click('[data-testid="viewmodel-build"]');
    expect(drafts.getSnapshot()).toHaveLength(0);
    await click('[data-testid="viewmodel-slot-choice-primary-weapon"]');
    record = {
      id: "execs-viewmodels",
      source: "stockBuilt",
      preload: true,
      options: {},
      buildRecipe: {
        schema: 1,
        catalog: catalog.catalog,
        sourceFingerprints: catalog.sourceFingerprints,
        choices: [
          { groupId: "scout/a", mode: "full" },
          { groupId: "scout/b", mode: "full" },
        ],
      },
    };
    await render();
    expect(
      element<HTMLInputElement>('[data-testid="viewmodel-slot-choice-primary-weapon"]').checked,
    ).toBe(true);
    expect(drafts.getSnapshot()).toHaveLength(1);
    await click('[data-testid="viewmodel-discard-draft"]');
    expect(
      element<HTMLInputElement>('[data-testid="viewmodel-slot-choice-primary-full"]').checked,
    ).toBe(true);
    expect(drafts.getSnapshot()).toHaveLength(0);
  });

  it("opens ready from the app's background read, then rechecks only on refresh", async () => {
    const { prefetchViewmodelCatalog } = await import("./lib/viewmodel-catalog-cache");
    prefetchViewmodelCatalog(getCatalog);
    await act(async () => {});
    expect(getCatalog).toHaveBeenCalledTimes(1);
    await render();
    expect(box.querySelector('[data-testid="viewmodel-catalog-status"]')).toBeNull();
    expect(box.textContent).toContain("Scattergun");
    expect(getCatalog).toHaveBeenCalledTimes(1);
    await click('[data-testid="viewmodel-catalog-refresh"]');
    expect(getCatalog).toHaveBeenCalledTimes(2);
  });
});
