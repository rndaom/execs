// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStatusProvider } from "./hooks/useAppStatus";
import {
  getViewmodelSourceCatalog,
  type ViewmodelBuildRequest,
  type ViewmodelRecord,
  type ViewmodelSourceCatalog,
} from "./lib/bridge";
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

describe("Viewmodels source-derived draft", () => {
  it("shows class sections and short labels while release Build stays unavailable", async () => {
    await render(false, false);
    expect(box.textContent).toContain("Import VPK");
    expect(box.textContent).not.toContain("being prepared for 0.2.0");
    expect(box.textContent).not.toContain("Casual preload");
    expect(box.textContent).toContain("Every viewmodel is hidden in game");
    expect(box.textContent).toContain("Scattergun");
    expect(box.querySelector('[data-testid="viewmodel-section-primary"]')?.textContent).toContain(
      "Primary",
    );
    expect(box.textContent).toContain("Everything shown");
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-review-build"]').disabled).toBe(
      true,
    );
    await click('[data-testid="viewmodel-choice-scout/a-full"]');
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-review-build"]').disabled).toBe(
      false,
    );
    await click('[data-testid="viewmodel-review-build"]');
    expect(box.textContent).toContain("Replaces this profile's viewmodel pack");
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
      "saved viewmodel pack was changed outside execs",
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
      element<HTMLInputElement>('[data-testid="viewmodel-choice-scout/a-weapon"]').checked,
    ).toBe(true);
    expect(element('[data-testid="viewmodel-choice-summary"]').textContent).toBe("1 hidden");
    await click('[data-testid="viewmodel-choice-scout/a-full"]');
    expect(element('[data-testid="viewmodel-choice-summary"]').textContent).toBe(
      "1 hidden · not built yet",
    );
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

  it("keeps a failed refresh stale and clears draft choices after installed sources change", async () => {
    await render();
    await click('[data-testid="viewmodel-choice-scout/a-full"]');
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-review-build"]').disabled).toBe(
      false,
    );

    getCatalog.mockRejectedValueOnce(new Error("TF2 source read failed"));
    await click('[data-testid="viewmodel-catalog-refresh"]');
    expect(box.textContent).toContain("TF2 source read failed");
    expect(box.textContent).toContain("Scattergun");
    expect(
      element<HTMLInputElement>('[data-testid="viewmodel-choice-scout/a-full"]').disabled,
    ).toBe(true);

    getCatalog.mockResolvedValueOnce({
      ...catalog,
      sourceFingerprints: [{ id: "models/weapons/c_models/c_scout_animations.mdl", sha256: "new" }],
    });
    await click('[data-testid="viewmodel-catalog-refresh"]');
    expect(box.textContent).toContain("TF2 was updated, so your unsaved choices were cleared");
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-review-build"]').disabled).toBe(
      true,
    );
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

    await click('[data-testid="viewmodel-choice-scout/a-full"]');
    await click('[data-testid="viewmodel-review-build"]');
    expect(box.querySelector('[data-testid="viewmodel-build-review"]')).not.toBeNull();
    paneActive = false;
    await render();
    expect(box.querySelector('[data-testid="viewmodel-build-review"]')).toBeNull();
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
    expect(element<HTMLInputElement>('[data-testid="viewmodel-choice-scout/a-full"]').checked).toBe(
      true,
    );
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
    await click('[data-testid="viewmodel-choice-scout/a-weapon"]');
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

  it("identifies overlapping modes during review", async () => {
    await render();
    await click('[data-testid="viewmodel-choice-scout/a-full"]');
    await click('[data-testid="viewmodel-choice-scout/b-weapon"]');
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
    await click('[data-testid="viewmodel-choice-scout/a-full"]');
    await click('[data-testid="viewmodel-review-build"]');
    expect(box.textContent).toContain("Replaces this profile's viewmodel pack");
    const build = element<HTMLButtonElement>('[data-testid="viewmodel-build"]');
    expect(build.disabled).toBe(false);
    await act(async () => build.click());
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toEqual({
      catalog: catalog.catalog,
      sourceFingerprints: catalog.sourceFingerprints,
      choices: [{ groupId: "scout/a", mode: "full" }],
      preload: true,
    });
    expect(box.textContent).toContain("Building from your TF2 files");
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-build"]').disabled).toBe(true);
    await act(async () => finish(false));
    expect(box.querySelector('[data-testid="viewmodel-build-review"]')).not.toBeNull();
    await click('[data-testid="viewmodel-build"]');
    await act(async () => finish(true));
    expect(box.querySelector('[data-testid="viewmodel-build-review"]')).toBeNull();
  });

  it("keeps Build disabled while TF2 runs or choices conflict", async () => {
    buildPack = vi.fn(async () => true);
    running = true;
    await render();
    await click('[data-testid="viewmodel-choice-scout/a-full"]');
    await click('[data-testid="viewmodel-review-build"]');
    expect(box.textContent).toContain("Close TF2 before building");
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-build"]').disabled).toBe(true);
    running = false;
    await render();
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-build"]').disabled).toBe(false);
    await click('[data-testid="viewmodel-build-review"] .btn-ghost');
    expect(box.querySelector('[data-testid="viewmodel-build-review"]')).toBeNull();
    await click('[data-testid="viewmodel-choice-scout/b-weapon"]');
    await click('[data-testid="viewmodel-review-build"]');
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-build"]').disabled).toBe(true);
    expect(buildPack).not.toHaveBeenCalled();
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
