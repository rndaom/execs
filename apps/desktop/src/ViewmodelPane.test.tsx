// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStatusProvider } from "./hooks/useAppStatus";
import type { ViewmodelRecord } from "./lib/bridge";
import { ViewmodelPane } from "./ViewmodelPane";

let box: HTMLDivElement;
let root: Root;
let running: boolean;
let record: ViewmodelRecord | null;
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
  openGameplay.mockReset();
  openCasual.mockReset();
  importPack.mockReset();
  removePack.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.unstubAllGlobals();
});

async function render(profilePreload: boolean | null = true, globalShown = true) {
  await act(async () =>
    root.render(
      <AppStatusProvider value={{ running, busy: false, error: null, setError: () => {} }}>
        <ViewmodelPane
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

describe("Viewmodels workspace while the builder is replaced", () => {
  it("offers local VPK import without a builder, copied option list, or remote images", async () => {
    await render(false, false);
    expect(box.textContent).toContain("Import a model-only VPK");
    expect(box.textContent).toContain(
      "The Viewmodels builder and previews are being rebuilt for 0.2.0",
    );
    expect(box.textContent).toContain("Global Draw viewmodel: Off");
    expect(box.textContent).toContain("Casual preload: Off");
    expect(box.querySelector('[data-testid="viewmodel-build"]')).toBeNull();
    expect(box.querySelector('[data-testid^="viewmodel-group-"]')).toBeNull();
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
    expect(box.querySelector('[data-testid="viewmodel-build"]')).toBeNull();
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
});
