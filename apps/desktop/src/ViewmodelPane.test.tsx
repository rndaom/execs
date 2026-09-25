// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStatusProvider } from "./hooks/useAppStatus";
import {
  getViewmodelSourceCatalog,
  type ViewmodelRecord,
  type ViewmodelSourceCatalog,
} from "./lib/bridge";
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
      items: [{ id: 13, schemaName: "Scattergun" }],
      animations: ["draw"],
      overlaps: ["scout/b"],
      teamVariantsDiffer: false,
    },
    {
      id: "scout/b",
      class: "scout",
      items: [{ id: 14, schemaName: "Shortstop" }],
      animations: ["draw", "idle"],
      overlaps: ["scout/a"],
      teamVariantsDiffer: true,
    },
    {
      id: "soldier/c",
      class: "soldier",
      items: [{ id: 18, schemaName: "Rocket Launcher" }],
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
const getCatalog = vi.mocked(getViewmodelSourceCatalog);
const openGameplay = vi.fn();
const openCasual = vi.fn();
const importPack = vi.fn();
const removePack = vi.fn();

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
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
    visible ? "visible" : "hidden",
  );
  getCatalog.mockReset();
  getCatalog.mockResolvedValue(catalog);
  openGameplay.mockReset();
  openCasual.mockReset();
  importPack.mockReset();
  removePack.mockReset();
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
          globalViewmodelsShown={globalShown}
          profilePreload={profilePreload}
          onOpenGameplay={openGameplay}
          onOpenCasualSetup={openCasual}
          onImport={importPack}
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
  it("shows local class and group controls while Build stays unavailable", async () => {
    await render(false, false);
    expect(box.textContent).toContain("Import a model-only VPK");
    expect(box.textContent).toContain("replacement Viewmodels builder is being prepared for 0.2.0");
    expect(box.textContent).toContain("Global Draw viewmodel: Off");
    expect(box.textContent).toContain("Casual preload: Off");
    expect(box.textContent).toContain("Scattergun");
    expect(box.textContent).toContain("Rendered preview unavailable");
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-review-build"]').disabled).toBe(
      true,
    );
    await click('[data-testid="viewmodel-choice-scout/a-full"]');
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-review-build"]').disabled).toBe(
      false,
    );
    await click('[data-testid="viewmodel-review-build"]');
    expect(box.textContent).toContain("No build started");
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-build"]').disabled).toBe(true);
    expect(box.querySelector("img")).toBeNull();
    await click('[data-testid="viewmodel-import"]');
    expect(importPack).toHaveBeenCalledWith(false);
    await click('[data-testid="viewmodel-global-status"] button');
    await click('[data-testid="viewmodel-preload-status"] button');
    expect(openGameplay).toHaveBeenCalledOnce();
    expect(openCasual).toHaveBeenCalledOnce();
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
      "Previously built pack",
    );
    expect(box.textContent).toContain("2 recorded choices");
    expect(box.textContent).toContain("Switching profiles uses the saved VPK bytes");
    expect(box.textContent).toContain("Recorded choices are preserved");
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
      "saved viewmodel VPK changed outside execs",
    );
    expect(box.textContent).toContain("Replace the model-only VPK");
    expect(element('[data-testid="viewmodel-pack-status"]').textContent).toContain("Imported pack");
  });

  it("labels a locally built record without treating its recipe as editable legacy choices", async () => {
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
    expect(element('[data-testid="viewmodel-pack-status"]').textContent).toContain(
      "Locally built pack",
    );
    expect(box.textContent).toContain("1 recorded choice");
    expect(box.textContent).toContain("Saved build choices remain read only");
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-review-build"]').disabled).toBe(
      true,
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
    expect(box.textContent).toContain("Earlier planning choices were cleared");
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

    paneActive = true;
    await render();
    expect(element<HTMLInputElement>('[data-testid="viewmodel-choice-scout/a-full"]').checked).toBe(
      true,
    );
    expect(getCatalog).toHaveBeenCalledTimes(2);

    focused = false;
    await act(async () => window.dispatchEvent(new Event("blur")));
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
    expect(getCatalog).toHaveBeenCalledTimes(2);
  });

  it("identifies overlapping modes during review", async () => {
    await render();
    await click('[data-testid="viewmodel-choice-scout/a-full"]');
    await click('[data-testid="viewmodel-choice-scout/b-weapon"]');
    await click('[data-testid="viewmodel-review-build"]');
    expect(box.textContent).toContain("different hide modes");
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-build"]').disabled).toBe(true);
  });
});
