// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { createPreviewApi } from "./lib/preview-bridge";

let root: Root;
let box: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
});

afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("holds the startup screen over an inert app until the first pane has loaded", async () => {
  // Startup caps its hold at BOOT_MAX_MS from page start, which performance.now()
  // measures in a webview. Here it counts from the worker's start instead, so a
  // slow cold import would already be past the cap; start the page clock now.
  const pageStart = performance.now();
  const now = performance.now.bind(performance);
  vi.spyOn(performance, "now").mockImplementation(() => now() - pageStart);
  const api = createPreviewApi("settings-comfig");
  const read = api.getActiveProfileDetail.bind(api);
  const waiting: (() => void)[] = [];
  let released = false;
  const finishRead = () => {
    released = true;
    for (const resume of waiting.splice(0)) resume();
  };
  vi.spyOn(api, "getActiveProfileDetail").mockImplementation(() =>
    released ? read() : new Promise((resolve) => waiting.push(() => resolve(read()))),
  );

  await act(async () => root.render(<App api={api} preview="settings-comfig" bootSplash />));

  const splash = box.querySelector('[data-testid="boot-splash"]');
  expect(splash?.textContent).toContain("Loading Comfig…");
  expect(splash?.nextElementSibling?.hasAttribute("inert")).toBe(true);

  await act(async () => finishRead());
  // Under test the minimum hold is zero; the screen leaves on the next timer.
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

  expect(box.querySelector('[data-testid="boot-splash"]')).toBeNull();
  expect(box.querySelector("[inert]")).toBeNull();
  expect(box.querySelector('[data-testid="settings-pane-comfig"]')?.textContent).toContain(
    "Preset",
  );
});

it("renders no startup screen unless asked", async () => {
  await act(async () =>
    root.render(<App api={createPreviewApi("settings-comfig")} preview="settings-comfig" />),
  );
  expect(box.querySelector('[data-testid="boot-splash"]')).toBeNull();
});
