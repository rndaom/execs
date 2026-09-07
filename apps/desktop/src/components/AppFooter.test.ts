// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type AppUpdateState, useAppUpdate } from "../hooks/useAppUpdate";
import { createPreviewApi } from "../lib/preview-bridge";
import { AppFooter } from "./AppFooter";
import { UpdateBanner } from "./UpdateBanner";

let box: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  { current: "0.1.3", next: "0.1.3+1", installedTitle: "execs 0.1.3", nextHotfix: "Hotfix 1" },
  {
    current: "0.1.3+1",
    next: "0.1.3+2",
    installedTitle: "execs 0.1.3 · Hotfix 1",
    nextHotfix: "Hotfix 2",
  },
])(
  "automatically offers $next on $current without changing revision identities",
  async ({ current, next, installedTitle, nextHotfix }) => {
    const api = createPreviewApi("update-available");
    vi.spyOn(api, "getAppVersion").mockResolvedValue(current);
    vi.spyOn(api, "checkAppUpdate").mockResolvedValue({ version: next, notes: "Next hotfix" });
    vi.spyOn(api, "getDiagnostics").mockRejectedValue(Error("unavailable"));
    const install = vi.spyOn(api, "installAppUpdate").mockResolvedValue(undefined);
    const copy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
    let state: AppUpdateState | null = null;
    function Harness() {
      const update = useAppUpdate(api, { setError: vi.fn() });
      state = update;
      return h(
        "div",
        null,
        h(AppFooter, { api, update, pinned: true }),
        h(UpdateBanner, { update, blocked: false }),
      );
    }

    await act(async () => root.render(h(Harness)));
    const version = box.querySelector('[data-testid="app-version"]');
    expect(version?.textContent).toBe("v0.1.3");
    expect(version?.getAttribute("title")).toBe(installedTitle);
    expect(box.textContent).toContain(`Update available — execs 0.1.3 · ${nextHotfix}`);
    expect(box.textContent).not.toMatch(/0\.1\.3\+[12]/);
    expect(state).toMatchObject({ version: current, available: { version: next } });

    await act(async () =>
      box.querySelector<HTMLButtonElement>('[data-testid="app-copy-diagnostics"]')?.click(),
    );
    expect(copy).toHaveBeenCalledWith(`execs ${current}\n(diagnostics could not be read)\n`);
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[data-testid="app-update-install"]')?.click(),
    );
    expect(install).toHaveBeenCalledOnce();
    expect(
      JSON.parse(window.localStorage.getItem("execs:pending-release-notes") ?? "null"),
    ).toEqual({
      version: next,
      notes: "Next hotfix",
    });
  },
);
