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
    expect(
      box.querySelector<HTMLElement>('[aria-label="Backpack items"]')?.style.gridTemplateColumns,
    ).toBe("repeat(5, minmax(0, 1fr))");
    expect(box.querySelectorAll('[aria-label="Backpack items"] > *')).toHaveLength(50);
    expect(
      box.querySelector<HTMLButtonElement>('[aria-label="Scattergun, Unique, slot 1"]')?.style
        .borderColor,
    ).toBe("rgb(255, 215, 0)");
    expect(
      box.querySelector<HTMLButtonElement>('[aria-label="Scattergun, Unique, slot 1"]')?.style
        .borderWidth,
    ).toBe("");
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[aria-label="Scattergun, Unique, slot 1"]')?.click(),
    );
    expect(box.querySelector('[aria-label="Item details"]')?.textContent).toContain("Item 123");
    expect(box.querySelector<HTMLElement>('[aria-label="Item details"]')?.style.borderColor).toBe(
      "rgb(255, 215, 0)",
    );
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

it("keeps installed item artwork when an optional pattern cannot be decoded", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,ok");
  const icon = "materials/backpack/gun.vtf";
  const pattern = "materials/patterns/camo_jungle_green_02.vtf";
  const getInventoryIcons = vi.fn(async (paths: string[]) => {
    if (paths[0] === pattern) throw new Error("Pattern unavailable");
    return { [icon]: { width: 1, height: 1, rgba: [255, 255, 255, 255] } };
  });
  const api = {
    getInventory: vi.fn().mockResolvedValue({
      steamId: "test-account",
      capacity: 50,
      warning: null,
      items: [
        { id: "gun", definition: 1, position: 1, quality: 6, level: 1, customName: null },
        { id: "paint", definition: 2, position: 2, quality: 15, level: 1, customName: null },
      ],
      definitions: {
        "1": { name: "Gun", kind: "Weapon", classes: [], icon },
        "2": { name: "Paint", kind: "War Paint", classes: [], icon },
      },
      itemDescriptions: {
        paint: {
          name: "Paint",
          kind: "War Paint",
          classes: [],
          icon,
          patternIcon: pattern,
          details: ["Pattern swatch"],
        },
      },
    }),
    getInventoryIcons,
  } as unknown as Api;
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  try {
    await act(async () =>
      root.render(<InventoryPane api={api} active running={false} busy={false} />),
    );
    expect(getInventoryIcons).toHaveBeenCalledWith([icon]);
    expect(getInventoryIcons).toHaveBeenCalledWith([pattern]);
    expect(box.querySelector('img[src="data:image/png;base64,ok"]')).not.toBeNull();
    expect(box.textContent).not.toContain("Some item artwork is unavailable");
    expect(box.textContent).not.toContain("BridgeError");
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[aria-label="Paint, Decorated, slot 2"]')?.click(),
    );
    expect(getInventoryIcons.mock.calls.filter(([paths]) => paths[0] === pattern)).toHaveLength(1);
    expect(box.querySelector('[aria-label="Item details"]')?.textContent).toContain(
      "Pattern swatch unavailable in installed TF2 files.",
    );
  } finally {
    await act(async () => root.unmount());
    box.remove();
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

it("shows kit target art and an installed paint swatch without claiming rendered wear", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,art");
  const paths = {
    kit: "materials/backpack/kit.vtf",
    target: "materials/backpack/rocket.vtf",
    paint: "materials/patterns/camo.vtf",
    base: "materials/backpack/scattergun.vtf",
  };
  const api = {
    getInventory: vi.fn().mockResolvedValue({
      steamId: "test-account",
      capacity: 50,
      warning: null,
      items: [
        { id: "kit", definition: 1, position: 1, quality: 6, level: 1, customName: null },
        { id: "paint", definition: 2, position: 2, quality: 15, level: 1, customName: null },
      ],
      definitions: {
        "1": { name: "Kit", kind: "Tool", classes: [], icon: paths.kit },
        "2": { name: "Paint", kind: "Weapon", classes: [], icon: paths.paint },
      },
      itemDescriptions: {
        kit: {
          name: "Killstreak Kit · Rocket Launcher",
          kind: "Tool",
          classes: [],
          icon: paths.kit,
          targetIcon: paths.target,
          details: ["For Rocket Launcher"],
        },
        paint: {
          name: "Painted Scattergun",
          kind: "Weapon",
          classes: [],
          icon: paths.base,
          patternIcon: paths.paint,
          details: ["Well-Worn"],
        },
      },
    }),
    getInventoryIcons: vi.fn(async (requested: string[]) =>
      Object.fromEntries(
        requested.map((path) => [path, { width: 1, height: 1, rgba: [1, 2, 3, 255] }]),
      ),
    ),
  } as unknown as Api;
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  try {
    await act(async () =>
      root.render(<InventoryPane api={api} active running={false} busy={false} />),
    );
    expect(box.querySelector(".inventory-kit-target")).not.toBeNull();
    expect(box.querySelector(".inventory-paint-icon")).not.toBeNull();
    expect(box.querySelector(".inventory-paint-swatch")).not.toBeNull();
    expect(box.querySelector(".inventory-paint-only-swatch")).toBeNull();
    expect(box.textContent).toContain("Well-Worn");
    await act(async () =>
      box
        .querySelector<HTMLButtonElement>('[aria-label="Painted Scattergun, Decorated, slot 2"]')
        ?.click(),
    );
    expect(box.querySelector(".inventory-paint-swatch")).not.toBeNull();
    expect(box.querySelector('[aria-label="Item details"]')?.textContent).toContain(
      "In-game mapping, wear and effects are not rendered.",
    );
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("retries an omitted path alone when an icon batch hits its native byte budget", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,art");
  const first = "materials/backpack/first.vtf";
  const second = "materials/backpack/second.vtf";
  const icon = { width: 1, height: 1, rgba: [1, 2, 3, 255] };
  const getInventoryIcons = vi.fn(async (paths: string[]) =>
    paths.length === 2 ? { [first]: icon } : { [paths[0]]: icon },
  );
  const api = {
    getInventory: vi.fn().mockResolvedValue({
      steamId: "test-account",
      capacity: 50,
      warning: null,
      items: [
        { id: "first", definition: 1, position: 1, quality: 6, level: 1, customName: null },
        { id: "second", definition: 2, position: 2, quality: 6, level: 1, customName: null },
      ],
      definitions: {
        "1": { name: "First", kind: "Weapon", classes: [], icon: first },
        "2": { name: "Second", kind: "Weapon", classes: [], icon: second },
      },
    }),
    getInventoryIcons,
  } as unknown as Api;
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  try {
    await act(async () =>
      root.render(<InventoryPane api={api} active running={false} busy={false} />),
    );
    expect(getInventoryIcons).toHaveBeenCalledWith([first, second]);
    expect(getInventoryIcons).toHaveBeenCalledWith([second]);
    expect(
      box.querySelectorAll('.inventory-item img[src="data:image/png;base64,art"]'),
    ).toHaveLength(2);
    expect(box.textContent).not.toContain("Some item artwork is unavailable");
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
