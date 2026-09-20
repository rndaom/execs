// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { InventoryPane } from "./InventoryPane";
import type { Api } from "./lib/api";

it("loads explicitly and clears the previous account snapshot on a failed refresh", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const getInventory = vi.fn().mockResolvedValue({
    steamId: "test-account",
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
    expect(getInventory).not.toHaveBeenCalled();
    await act(async () => box.querySelector<HTMLButtonElement>("button")?.click());
    expect(box.textContent).toContain("Steam account test-account");
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[aria-label="Scattergun, Unique, slot 1"]')?.click(),
    );
    expect(box.querySelector('[aria-label="Item details"]')?.textContent).toContain("Item 123");
    getInventory.mockRejectedValueOnce(new Error("Steam disconnected"));
    await act(async () => box.querySelector<HTMLButtonElement>("button")?.click());
    expect(box.querySelector('[role="alert"]')?.textContent).toContain("Steam disconnected");
    expect(box.textContent).not.toContain("Steam account test-account");
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.unstubAllGlobals();
  }
});
