import { describe, expect, it } from "vitest";
import type { InventorySnapshot } from "./bridge";
import { inventoryPage, itemName, qualityColor } from "./inventory-ui";

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
  it("uses installed quality colors and falls back to known TF2 colors", () => {
    expect(qualityColor(snapshot, 6)).toBe("#FFD700");
    expect(qualityColor({ ...snapshot, qualityColors: { "6": "#123456" } }, 6)).toBe("#123456");
    expect(qualityColor(snapshot, 99)).toBeUndefined();
  });
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
  it("sorts a compact view without moving slots or mutating the snapshot", () => {
    const before = structuredClone(snapshot);
    const byName = inventoryPage(snapshot, "", null, 1, "name");
    expect(byName.slots.map((slot) => slot.item?.id)).toEqual(["9007199254740993", "2"]);
    expect(byName.pages).toBe(1);
    expect(byName.slots.map((slot) => slot.position)).toEqual([51, 0]);
    expect(
      inventoryPage(snapshot, "", null, 1, "quality").slots.map((slot) => slot.item?.quality),
    ).toEqual([11, 6]);
    expect(snapshot).toEqual(before);
    expect(inventoryPage(snapshot, "", null, 2, "position").slots[0].position).toBe(51);
  });
  it("searches per-instance paint and kit details and honors missing variant artwork", () => {
    const enriched = {
      ...snapshot,
      itemDescriptions: {
        "2": {
          name: "Mercenary Grade War Paint",
          kind: "War Paint",
          classes: [],
          icon: null,
          details: ["War paint: Autumn", "Minimal Wear"],
        },
      },
    };
    expect(itemName(enriched, enriched.items[1])).toBe("Mercenary Grade War Paint");
    expect(inventoryPage(enriched, "autumn", null, 1).slots[0].item?.id).toBe("2");
    expect(inventoryPage(enriched, "minimal wear", null, 1).matchCount).toBe(1);
    expect(inventoryPage(enriched, "", null, 1, "type").slots.map((slot) => slot.item?.id)).toEqual(
      ["9007199254740993", "2"],
    );
  });
});
