import { describe, expect, it } from "vitest";
import { inventoryCraftBaseline } from "./inventory-crafting";
import { createInventorySimulation, inventoryFixture } from "./inventory-simulation";

describe("inventory simulation authority", () => {
  it("crafts exact fixture ingredients once and preserves the new result on refresh", async () => {
    const api = createInventorySimulation();
    const baseline = await api.getInventory();
    const inputIds = baseline.items
      .filter((item) => item.definition === 5000)
      .map((item) => item.id);
    const request = {
      steamId: baseline.steamId,
      baseline: inventoryCraftBaseline(baseline),
      recipe: "combine_scrap" as const,
      inputIds,
      protectedIds: [],
    };
    const result = await api.craftInventory(request);
    expect(result.status).toBe("simulated");
    expect(result.consumedIds).toEqual(inputIds);
    expect(result.acquiredIds).toHaveLength(1);
    const refreshed = await api.getInventory();
    expect(refreshed.items).toHaveLength(baseline.items.length - 2);
    expect(refreshed.items.some((item) => inputIds.includes(item.id))).toBe(false);
    expect(refreshed.items.find((item) => result.acquiredIds.includes(item.id))?.definition).toBe(
      5001,
    );
    await expect(api.craftInventory(request)).rejects.toThrow("backpack changed");
  });
  it("applies a reviewed swap, preserves item identities and rejects replay", async () => {
    const api = createInventorySimulation();
    const baseline = await api.getInventory();
    const request = {
      steamId: baseline.steamId,
      baseline,
      protectedIds: [],
      moves: [
        { id: "9007199254740993", from: 1, to: 3 },
        { id: "9007199254740995", from: 3, to: 1 },
      ],
    };
    const result = await api.applyInventoryLayout(request);
    expect(result.status).toBe("simulated");
    expect(result.snapshot?.items.find((item) => item.id === "9007199254740993")?.position).toBe(3);
    expect(result.snapshot?.items.map((item) => item.id).sort()).toEqual(
      baseline.items.map((item) => item.id).sort(),
    );
    await expect(api.applyInventoryLayout(request)).rejects.toThrow("backpack changed");
  });

  it("refuses collisions, protected moves and account mismatches without partial mutation", async () => {
    const api = createInventorySimulation();
    const baseline = await api.getInventory();
    const request = {
      steamId: baseline.steamId,
      baseline,
      protectedIds: [],
      moves: [{ id: "9007199254740993", from: 1, to: 3 }],
    };
    await expect(api.applyInventoryLayout(request)).rejects.toThrow("same backpack slot");
    await expect(
      api.applyInventoryLayout({ ...request, protectedIds: ["9007199254740993"] }),
    ).rejects.toThrow("protected");
    await expect(api.applyInventoryLayout({ ...request, steamId: "other" })).rejects.toThrow(
      "backpack changed",
    );
    expect(await api.getInventory()).toEqual(baseline);
  });

  it("does not share mutable snapshot objects with renderer or other sessions", async () => {
    const seed = inventoryFixture();
    const first = createInventorySimulation(seed);
    const second = createInventorySimulation(seed);
    const view = await first.getInventory();
    view.items[0].position = 300;
    expect((await first.getInventory()).items[0].position).toBe(1);
    const baseline = await first.getInventory();
    const result = await first.applyInventoryLayout({
      steamId: baseline.steamId,
      baseline,
      protectedIds: [],
      moves: [{ id: "9007199254740993", from: 1, to: 300 }],
    });
    if (result.snapshot) result.snapshot.items[0].position = 200;
    expect((await first.getInventory()).items[0].position).toBe(300);
    expect((await second.getInventory()).items[0].position).toBe(1);
  });
});
