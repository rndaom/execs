import { describe, expect, it } from "vitest";
import type { InventorySnapshot } from "./bridge";
import {
  compareInventoryItems,
  inventoryPage,
  itemDescriptionTag,
  itemLines,
  itemName,
  itemTitle,
  itemTypeLine,
  originalItemName,
  qualityColor,
} from "./inventory-ui";

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
  it("compares names and qualities without changing item positions", () => {
    const before = structuredClone(snapshot);
    for (const sort of ["name", "quality"] as const) {
      expect(
        [...snapshot.items]
          .sort((a, b) => compareInventoryItems(snapshot, a, b, sort))
          .map((item) => item.id),
      ).toEqual(["9007199254740993", "2"]);
    }
    expect(snapshot).toEqual(before);
    expect(inventoryPage(snapshot, "", null, 2).slots[0].position).toBe(51);
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
    expect(
      [...enriched.items]
        .sort((a, b) => compareInventoryItems(enriched, a, b, "type"))
        .map((item) => item.id),
    ).toEqual(["9007199254740993", "2"]);
  });
});

describe("TF2 item text", () => {
  const named = { ...snapshot.items[0], customDescription: "Found it under the bed." };
  it("quotes a Name Tag and keeps the original name visible", () => {
    expect(itemTitle(snapshot, named)).toBe("“Named gun”");
    expect(originalItemName(snapshot, named)).toBe("Strange Scattergun");
    expect(originalItemName(snapshot, snapshot.items[1])).toBeNull();
    const steam = {
      image: "preview-image-name",
      name: "''Named gun''",
      marketName: "Strange Scattergun",
      nameColor: "#CF6A32",
      typeLine: "Strange Scattergun - Kills: 4",
      lines: [
        { text: " ", color: null, user: false },
        { text: "''Found it under the bed.''", color: null, user: true },
        { text: " ", color: null, user: false },
      ],
      originalName: "Scattergun",
    };
    expect(itemTitle(snapshot, named, steam)).toBe("“Named gun”");
    expect(itemTypeLine(snapshot, named, steam)).toBe("Strange Scattergun - Kills: 4");
    expect(itemTypeLine(snapshot, snapshot.items[1])).toBe("Level 1 Primary");
    // Spacers never lead or trail, and Steam's '' quotes become TF2's.
    expect(itemLines(snapshot, named, steam)).toEqual([
      { text: "“Found it under the bed.”", color: null, user: true },
    ]);
    expect(itemDescriptionTag(named, steam)).toBe("“Found it under the bed.”");
  });
  it("uses installed details and the description tag without Steam", () => {
    expect(itemLines(snapshot, named).at(-1)).toEqual({
      text: "“Found it under the bed.”",
      color: null,
      user: true,
    });
    expect(itemDescriptionTag(snapshot.items[1])).toBeNull();
    expect(itemTitle(snapshot, snapshot.items[1], undefined)).toBe("Scattergun");
  });
  it("finds items by their description tag", () => {
    const tagged = { ...snapshot, items: [named, snapshot.items[1]] };
    expect(inventoryPage(tagged, "under the bed", null, 1).matchCount).toBe(1);
  });
});
