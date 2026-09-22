// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStatusProvider } from "./hooks/useAppStatus";
import { AutosavePending } from "./hooks/useAutosave";
import type { Api } from "./lib/api";
import type { ViewmodelRecord } from "./lib/bridge";
import { ViewmodelPane } from "./ViewmodelPane";

let box: HTMLDivElement;
let root: Root;
let running: boolean;
let record: ViewmodelRecord | null;
const pending = vi.fn();
const build = vi.fn();
const api = {} as Api;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  running = false;
  record = null;
  pending.mockReset();
  build.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.unstubAllGlobals();
});

async function render(profileId = "A") {
  await act(async () =>
    root.render(
      <AppStatusProvider value={{ running, busy: false, error: null, setError: () => {} }}>
        <AutosavePending.Provider value={pending}>
          <ViewmodelPane
            api={api}
            profileId={profileId}
            record={record}
            onBuild={build}
            onImport={() => {}}
            onRemove={() => {}}
          />
        </AutosavePending.Provider>
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

describe("Viewmodels workspace", () => {
  it("keeps class drafts editable during a game and requires a later explicit build", async () => {
    running = true;
    await render();
    expect(box.querySelectorAll('[role="tab"]')).toHaveLength(9);
    await click('[data-testid="viewmodel-group-scout/scatterguns"]');
    expect(
      element('[data-testid="viewmodel-group-scout/scatterguns"]').getAttribute("aria-checked"),
    ).toBe("true");
    expect(element<HTMLButtonElement>('[data-testid="viewmodel-build"]').disabled).toBe(true);
    expect(pending).toHaveBeenLastCalledWith(expect.any(String), true);
    running = false;
    await render();
    expect(build).not.toHaveBeenCalled();
    await click('[data-testid="viewmodel-build"]');
    expect(build).toHaveBeenCalledWith(["scout/scatterguns"], true, "full");
  });

  it("acknowledges a built snapshot without dropping edits made while it builds", async () => {
    await render();
    await click('[data-testid="viewmodel-group-scout/scatterguns"]');
    await click('[data-testid="viewmodel-build"]');
    await click('[data-testid="viewmodel-group-scout/double-barrels"]');
    record = {
      id: "execs-viewmodels",
      source: "compiled",
      preload: true,
      options: { hidden: "scout/scatterguns", mode: "full" },
    };
    await render();
    expect(
      element('[data-testid="viewmodel-group-scout/double-barrels"]').getAttribute("aria-checked"),
    ).toBe("true");
    expect(pending).toHaveBeenLastCalledWith(expect.any(String), true);
    await click('[data-testid="viewmodel-build"]');
    expect(build).toHaveBeenLastCalledWith(
      ["scout/double-barrels", "scout/scatterguns"],
      true,
      "full",
    );
    await render("B");
    expect(
      element('[data-testid="viewmodel-group-scout/double-barrels"]').getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("labels weapon-only imagery as a stock reference and never implies that hidden hands are a preview", async () => {
    await render();
    await click('[data-testid="viewmodel-visibility-weapon"]');
    expect(box.textContent).toContain("Stock reference");
    expect(box.textContent).toContain("keeps hands");
    expect(element('[data-testid="viewmodel-stage"]').getAttribute("data-stem")).toBe(
      "scout_scattergun",
    );
    await click('[data-testid="viewmodel-visibility-full"]');
    expect(element('[data-testid="viewmodel-stage"]').getAttribute("data-stem")).toBe(
      "scout_blank",
    );
  });
});
