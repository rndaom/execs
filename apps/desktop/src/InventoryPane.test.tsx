// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InventoryPane } from "./InventoryPane";
import type { Api } from "./lib/api";

const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);
const scrollIntoView = vi.fn();
beforeEach(() => {
  scrollIntoView.mockClear();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
});
afterEach(() => {
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
});

it("loads automatically and retains a clearly stale snapshot on a failed refresh", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const getInventory = vi.fn().mockResolvedValue({
    steamId: "test-account",
    personaName: "Test player",
    avatar: "data:image/png;base64,avatar",
    capacity: 50,
    items: [{ id: "123", definition: 13, position: 1, quality: 6, level: 1, customName: null }],
    definitions: { "13": { name: "Scattergun", kind: "Weapon", classes: ["scout"], icon: null } },
    warning: null,
  });
  const api = {
    getInventory,
    getInventoryIcons: vi.fn().mockResolvedValue({}),
    openExternal: vi.fn(),
  } as unknown as Api;
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  try {
    await act(async () =>
      root.render(<InventoryPane api={api} active running={false} busy={false} />),
    );
    expect(getInventory).toHaveBeenCalledTimes(1);
    expect(box.textContent).not.toContain("Refresh backpack");
    expect(box.textContent).toContain("Steam account test-account");
    expect(box.querySelector("h2")?.textContent).toBe("Test player");
    expect(box.querySelector('img[alt="Steam avatar"]')?.getAttribute("src")).toBe(
      "data:image/png;base64,avatar",
    );
    expect(box.querySelectorAll('nav[aria-label="Backpack pages"]')).toHaveLength(1);
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[aria-label="Scattergun, Unique, slot 1"]')?.click(),
    );
    expect(box.querySelector('[aria-label="Item details"]')?.textContent).toContain("Item 123");
    vi.useFakeTimers();
    getInventory.mockRejectedValueOnce(new Error("Steam disconnected"));
    // Return from the game requests a fresh snapshot without a refresh button.
    await act(async () => root.render(<InventoryPane api={api} active running busy={false} />));
    await act(async () =>
      root.render(<InventoryPane api={api} active running={false} busy={false} />),
    );
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(box.querySelector('[role="alert"]')?.textContent).toContain("Steam disconnected");
    expect(box.textContent).toContain("last confirmed snapshot");
    expect(box.textContent).toContain("Test player");
    expect(box.querySelector('img[alt="Steam avatar"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("loads an unplaced item's own artwork and keeps the preview while paging", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/png;base64,pixels",
  );
  const icon = "materials/backpack/kit.vtf";
  const getInventoryIcons = vi
    .fn()
    .mockResolvedValue({ [icon]: { width: 1, height: 1, rgba: [255, 255, 255, 255] } });
  const api = {
    getInventory: vi.fn().mockResolvedValue({
      steamId: "test-account",
      capacity: 100,
      warning: null,
      items: [{ id: "kit", definition: 1, position: 0, quality: 6, level: 1, customName: null }],
      definitions: { "1": { name: "Kit", kind: "Tool", classes: [], icon: null } },
      itemDescriptions: {
        kit: {
          name: "Rocket Launcher Kit",
          kind: "Tool",
          classes: [],
          icon,
          details: ["Sheen: Team Shine"],
        },
      },
    }),
    getInventoryIcons,
    openExternal: vi.fn(),
  } as unknown as Api;
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  try {
    await act(async () =>
      root.render(<InventoryPane api={api} active running={false} busy={false} />),
    );
    expect(getInventoryIcons).not.toHaveBeenCalled();
    await act(async () =>
      Array.from(box.querySelectorAll("button"))
        .find((button) => button.textContent === "Rocket Launcher Kit")
        ?.click(),
    );
    expect(getInventoryIcons).toHaveBeenCalledWith([icon]);
    expect(box.querySelector('img[alt="Rocket Launcher Kit"]')?.getAttribute("src")).toBe(
      "data:image/png;base64,pixels",
    );
    expect(box.querySelector('[aria-label="Item details"]')?.textContent).toContain(
      "Sheen: Team Shine",
    );
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[aria-label="Next page"]')?.click(),
    );
    expect(box.querySelector('img[alt="Rocket Launcher Kit"]')).not.toBeNull();
    expect(getInventoryIcons).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();
    await act(async () => root.render(<InventoryPane api={api} active running busy={false} />));
    await act(async () =>
      root.render(<InventoryPane api={api} active running={false} busy={false} />),
    );
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect((box.querySelector('[aria-label="Backpack page"]') as HTMLInputElement).value).toBe("2");
    expect(box.querySelector('img[alt="Rocket Launcher Kit"]')).not.toBeNull();
    expect(getInventoryIcons).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("reveals the first slot only when the displayed page changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const getInventory = vi.fn().mockResolvedValue({
    steamId: "test-account",
    capacity: 100,
    warning: null,
    items: [{ id: "123", definition: 13, position: 51, quality: 6, level: 1, customName: null }],
    definitions: { "13": { name: "Scattergun", kind: "Weapon", classes: ["scout"], icon: null } },
  });
  const api = {
    getInventory,
    getInventoryIcons: vi.fn().mockResolvedValue({}),
    openExternal: vi.fn(),
  } as unknown as Api;
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  async function render(active = true, running = false) {
    await act(async () =>
      root.render(<InventoryPane api={api} active={active} running={running} busy={false} />),
    );
  }
  async function click(selector: string) {
    await act(async () =>
      box.querySelector<HTMLInputElement | HTMLButtonElement>(selector)?.click(),
    );
  }
  try {
    await render();
    await click('input[value="name"]');
    await click('input[value="position"]');
    expect(scrollIntoView).not.toHaveBeenCalled();
    await click('[aria-label="Next page"]');
    expect(box.querySelector<HTMLInputElement>('[aria-label="Backpack page"]')?.value).toBe("2");
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: "start", behavior: "instant" });
    expect(scrollIntoView.mock.contexts[0]).toBe(
      box.querySelector('[aria-label="Backpack items"]'),
    );
    await render(false);
    await render();
    vi.useFakeTimers();
    await render(true, true);
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(getInventory.mock.calls.length).toBeGreaterThan(1);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    await click('input[value="name"]');
    expect(box.querySelector<HTMLInputElement>('[aria-label="Backpack page"]')?.value).toBe("1");
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    await click('input[value="quality"]');
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
