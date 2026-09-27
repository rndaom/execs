// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { App } from "./App";
import { createPreviewApi } from "./lib/preview-bridge";

it("applies an arrangement through the complete App and settings draft guard", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  const api = createPreviewApi("settings-inventory");
  const apply = vi.spyOn(api, "applyInventoryLayout");
  const button = (name: string) =>
    [...box.querySelectorAll("button")].find(
      (entry) => entry.textContent?.trim() === name || entry.getAttribute("aria-label") === name,
    );
  try {
    await act(async () =>
      root.render(
        <StrictMode>
          <App api={api} preview="settings-inventory" />
        </StrictMode>,
      ),
    );
    await act(async () => vi.dynamicImportSettled());
    await act(async () =>
      box
        .querySelector<HTMLButtonElement>(
          '[aria-label="Skull Cracked War Paint, Decorated, slot 2"]',
        )
        ?.click(),
    );
    await act(async () => button("Move selected in draft")?.click());
    await act(async () => button("Undo draft")?.click());
    await act(async () => button("Redo draft")?.click());
    await act(async () => button("Review 2 changes")?.click());
    expect(button("Apply simulation")?.disabled).toBe(false);
    expect(box.querySelector('[role="dialog"]')?.classList.contains("fixed")).toBe(true);
    await act(async () => button("Apply simulation")?.click());
    expect(apply).toHaveBeenCalledOnce();
    expect(box.textContent).toContain("Simulated 2 moves");
    expect(button("Undo draft")?.disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    box.remove();
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
