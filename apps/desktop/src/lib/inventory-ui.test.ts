import { describe, expect, it } from "vitest";
import type { InventorySnapshot } from "./bridge";
import { inventoryPage, itemName } from "./inventory-ui";

const snapshot: InventorySnapshot = {
  steamId: "test",
  capacity: 101,
  warning: null,
  items: [
    {
      id: "9007199254740993",
      definition: 13,
      position: 51,
      quality: 11,
      level: 1,
      customName: "Named gun",
    },
    { id: "2", definition: 13, position: 0, quality: 6, level: 1, customName: null },
  ],
  definitions: { "13": { name: "Scattergun", kind: "Primary", classes: ["scout"], icon: null } },
};
describe("inventory browsing", () => {
  it("preserves empty slots, partial last pages, and unplaced items", () => {
    const page = inventoryPage(snapshot, "", null, 2);
    expect(page.slots[0].item?.id).toBe("9007199254740993");
    expect(page.slots[1]).toEqual({ position: 52, item: null });
    expect(page.unplaced).toHaveLength(1);
    expect(inventoryPage(snapshot, "", null, 999).slots).toEqual([{ position: 101, item: null }]);
  });
  it("searches inherited names and classes without changing positions", () => {
    expect(inventoryPage(snapshot, "scout", 11, 5).slots[0].position).toBe(51);
    expect(inventoryPage(snapshot, "scattergun", null, 1).matchCount).toBe(2);
    expect(inventoryPage(snapshot, "missing", null, 1).slots).toEqual([]);
    expect(snapshot.items[0].position).toBe(51);
    expect(itemName(snapshot, snapshot.items[0])).toBe("Named gun");
  });
});
