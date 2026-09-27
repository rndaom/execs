// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  InventoryPolish,
  type InventoryPreferencesController,
  useInventoryPreferences,
} from "./InventoryPolish";
import { inventoryPreferencesKey } from "./lib/inventory-preferences";

let controller: InventoryPreferencesController;
function Harness({ account }: { account: string }) {
  controller = useInventoryPreferences(account);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("protects favorites, isolates account switches and rejects stale-account callbacks", async () => {
  const box = document.createElement("div");
  const root = createRoot(box);
  try {
    await act(async () => root.render(<Harness account="account-a" />));
    await act(async () => {
      controller.setFavorite(["123"], true);
      controller.setProtected(["456"], true);
    });
    expect([...controller.protectedIds]).toEqual(["456", "123"]);
    const stale = controller.setProtected;
    await act(async () => root.render(<Harness account="account-b" />));
    expect([...controller.protectedIds]).toEqual([]);
    await act(async () => stale(["999"], true));
    expect(localStorage.getItem(inventoryPreferencesKey("account-b"))).toBeNull();
    await act(async () => root.render(<Harness account="account-a" />));
    expect([...controller.protectedIds]).toEqual(["456", "123"]);
    await act(async () => controller.setFavorite(["123"], false));
    expect([...controller.protectedIds]).toEqual(["456"]);
  } finally {
    await act(async () => root.unmount());
  }
});

it("keeps changes in memory when persistence fails and preserves unreadable protections on disk", async () => {
  const key = inventoryPreferencesKey("account-a");
  localStorage.setItem(key, "unreadable");
  const box = document.createElement("div");
  const root = createRoot(box);
  try {
    await act(async () => root.render(<Harness account="account-a" />));
    expect(controller.storageError).toContain("protections cannot be checked");
    await act(async () => controller.setFavorite(["123"], true));
    expect(controller.protectedIds.has("123")).toBe(true);
    expect(localStorage.getItem(key)).toBe("unreadable");
    expect(controller.storageError).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});

it("bounds history with unique timestamps and keeps simulation and unknown outcomes distinct", async () => {
  vi.spyOn(Date, "now").mockReturnValue(100);
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Harness account="account-a" />));
    await act(async () => {
      for (let index = 0; index < 51; index++)
        controller.recordOperation({
          kind: "move",
          outcome: index === 50 ? "unknown" : "simulated",
          summary: `Operation ${index}`,
          itemIds: ["123"],
        });
    });
    expect(controller.preferences.history).toHaveLength(50);
    expect(controller.preferences.history[0].outcome).toBe("unknown");
    expect(controller.preferences.history[1].outcome).toBe("simulated");
    expect(new Set(controller.preferences.history.map((operation) => operation.at)).size).toBe(50);
  } finally {
    await act(async () => root.unmount());
  }
});

it("handles a denied browser storage getter", async () => {
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw Error("denied");
  });
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Harness account="account-a" />));
    expect(controller.storageError).toContain("unavailable");
    await act(async () => controller.setProtected(["123"], true));
    expect(controller.protectedIds.has("123")).toBe(true);
  } finally {
    await act(async () => root.unmount());
  }
});

it("loads saved search and restores a layout only through a draft callback", async () => {
  const onSearch = vi.fn();
  const onRestoreLayout = vi.fn();
  const snapshot = {
    steamId: "account-a",
    capacity: 50,
    items: [{ id: "123", position: 1, definition: 13, quality: 6, level: 1, customName: null }],
    definitions: {},
    warning: null,
  };
  function Tools() {
    controller = useInventoryPreferences(snapshot.steamId);
    return (
      <InventoryPolish
        snapshot={snapshot}
        query="scout"
        quality={6}
        sort="name"
        positions={{ "123": 1 }}
        preferences={controller}
        onSearch={onSearch}
        onRestoreLayout={onRestoreLayout}
      />
    );
  }
  const box = document.createElement("div");
  const root = createRoot(box);
  try {
    await act(async () => root.render(<Tools />));
    await act(async () => {
      controller.saveSearch("Scout", { query: "scout", quality: 6, sort: "name" });
      controller.saveLayout("Page two", { "123": 51 }, 100);
      controller.saveLayout("Another slot", { "123": 2 }, 50);
    });
    expect(onRestoreLayout).not.toHaveBeenCalled();
    await act(async () =>
      [...box.querySelectorAll("button")].find((button) => button.textContent === "Scout")?.click(),
    );
    expect(onSearch).toHaveBeenCalledWith({
      name: "Scout",
      query: "scout",
      quality: 6,
      sort: "name",
    });
    await act(async () => box.querySelector<HTMLInputElement>('input[value="layouts"]')?.click());
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[aria-label="Restore Page two as draft"]')?.click(),
    );
    expect(onRestoreLayout).not.toHaveBeenCalled();
    expect(box.querySelector('[role="alert"]')?.textContent).toContain("capacity");
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[aria-label="Restore Another slot as draft"]')?.click(),
    );
    expect(onRestoreLayout).toHaveBeenCalledWith({ "123": 2 });
    expect(box.querySelector('[role="status"]')?.textContent).toContain("Review before Apply");
  } finally {
    await act(async () => root.unmount());
  }
});
