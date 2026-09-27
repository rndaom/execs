import { describe, expect, it } from "vitest";
import type { InventorySnapshot } from "./bridge";
import {
  inventoryLayout,
  inventoryLayoutChanges,
  moveInventoryItems,
  pushInventoryLayout,
  redoInventoryLayout,
  restoreInventoryLayout,
  sortInventoryLayout,
  undoInventoryLayout,
  validateInventoryLayout,
  verifyInventoryLayoutResult,
} from "./inventory-organizer";

const snapshot: InventorySnapshot = {
  steamId: "account",
  capacity: 100,
  definitions: {},
  warning: null,
  items: [
    {
      id: "18446744073709551615",
      position: 1,
      definition: 1,
      quality: 6,
      level: 1,
      customName: null,
    },
    { id: "2", position: 2, definition: 1, quality: 6, level: 1, customName: null },
    { id: "3", position: 51, definition: 1, quality: 6, level: 1, customName: null },
    { id: "4", position: 0, definition: 1, quality: 6, level: 1, customName: null },
  ],
};
const first = snapshot.items[0].id;
describe("backpack draft planner", () => {
  it("sorts across pages into actual slots, includes unplaced items and preserves protected slots", () => {
    const named = {
      ...snapshot,
      items: snapshot.items.map((item, index) => ({
        ...item,
        customName: ["Zulu", "Beta", "Alpha", "Delta"][index],
      })),
    };
    const layout = inventoryLayout(named);
    const next = sortInventoryLayout(named, layout, "name", new Set(["2"]));
    expect(next).toEqual({ [first]: 4, "2": 2, "3": 1, "4": 3 });
    expect(layout).toEqual(inventoryLayout(named));
    const history = pushInventoryLayout({ past: [], present: layout, future: [] }, next);
    expect(undoInventoryLayout(history).present).toEqual(layout);
    expect(redoInventoryLayout(undoInventoryLayout(history)).present).toEqual(next);
    expect(sortInventoryLayout(named, next, "name", new Set(["2"]))).toEqual(next);
  });
  it("sorts qualities and item types with names as tie breakers and current draft slots for equal items", () => {
    const described = {
      ...snapshot,
      items: snapshot.items.map((item, index) => ({ ...item, quality: [11, 6, 5, 6][index] })),
      itemDescriptions: {
        [first]: { name: "Zulu", kind: "Weapon", classes: [], icon: null, details: [] },
        "2": { name: "Alpha", kind: "Weapon", classes: [], icon: null, details: [] },
        "3": { name: "Metal", kind: "Crafting", classes: [], icon: null, details: [] },
        "4": { name: "Alpha", kind: "Weapon", classes: [], icon: null, details: [] },
      },
    };
    const layout = { [first]: 51, "2": 5, "3": 6, "4": 1 };
    expect(sortInventoryLayout(described, layout, "type")).toEqual({
      "3": 1,
      "4": 2,
      "2": 3,
      [first]: 4,
    });
    expect(sortInventoryLayout(described, layout, "quality")).toEqual({
      [first]: 1,
      "4": 2,
      "2": 3,
      "3": 4,
    });
  });
  it("refuses sorting an overfull backpack without changing any positions", () => {
    const full = {
      ...snapshot,
      capacity: 3,
      items: snapshot.items.map((item, i) => ({ ...item, position: i < 3 ? i + 1 : 0 })),
    };
    const layout = inventoryLayout(full);
    expect(() => sortInventoryLayout(full, layout, "name")).toThrow("Not enough backpack space");
    expect(layout).toEqual(inventoryLayout(full));
  });
  it("requires the exact account, identities and all final positions before claiming success", () => {
    const moves = [{ id: first, from: 1, to: 10 }];
    const next = {
      ...snapshot,
      items: snapshot.items.map((item) => ({
        ...item,
        position: item.id === first ? 10 : item.position,
      })),
    };
    const result = {
      operationId: "test",
      kind: "layout" as const,
      status: "simulated" as const,
      snapshot: next,
      message: "Done",
    };
    expect(verifyInventoryLayoutResult(snapshot, moves, result).status).toBe("simulated");
    expect(
      verifyInventoryLayoutResult(snapshot, moves, { ...result, status: "confirmed" }).status,
    ).toBe("unknown");
    expect(
      verifyInventoryLayoutResult(snapshot, moves, {
        ...result,
        snapshot: {
          ...next,
          craftingEligibility: { [first]: { craftable: true, tradable: true, customized: false } },
        },
      }).status,
    ).toBe("unknown");
    expect(
      verifyInventoryLayoutResult(snapshot, moves, {
        ...result,
        snapshot: {
          ...next,
          itemDescriptions: {
            [first]: { name: "Changed", kind: "Item", classes: [], icon: null, details: [] },
          },
        },
      }).status,
    ).toBe("unknown");
    for (const invalid of [
      null,
      { ...next, steamId: "foreign" },
      { ...next, capacity: 101 },
      snapshot,
      { ...next, items: next.items.slice(1) },
      { ...next, items: next.items.map((item) => ({ ...item, definition: 22 })) },
    ]) {
      const checked = verifyInventoryLayoutResult(snapshot, moves, {
        ...result,
        snapshot: invalid,
      });
      expect(checked.status).toBe("unknown");
      expect(checked.snapshot).toBeNull();
    }
    expect(
      verifyInventoryLayoutResult(snapshot, moves, { ...result, status: "partial", snapshot })
        .status,
    ).toBe("partial");
    expect(
      verifyInventoryLayoutResult(snapshot, moves, { ...result, status: "partial", snapshot })
        .snapshot,
    ).toBeNull();
  });
  it("moves across pages with exact string IDs and reviews both swap participants", () => {
    const layout = inventoryLayout(snapshot);
    const next = moveInventoryItems(snapshot, layout, [first], 51);
    expect(inventoryLayoutChanges(snapshot, next)).toEqual([
      { id: first, from: 1, to: 51 },
      { id: "3", from: 51, to: 1 },
    ]);
    expect(layout[first]).toBe(1);
  });
  it("batches in backpack order, skips occupied slots and allows vacated selected slots", () => {
    const next = moveInventoryItems(snapshot, inventoryLayout(snapshot), ["4", "3", first], 2);
    expect(next).toEqual({ [first]: 3, "2": 2, "3": 4, "4": 5 });
  });
  it("refuses full tails without mutating the draft", () => {
    const layout = inventoryLayout(snapshot);
    expect(() => moveInventoryItems(snapshot, layout, [first, "2"], 100)).toThrow("Not enough");
    expect(layout[first]).toBe(1);
  });
  it("places new items only in empty slots", () => {
    expect(() => moveInventoryItems(snapshot, inventoryLayout(snapshot), ["4"], 1)).toThrow(
      "empty",
    );
    expect(moveInventoryItems(snapshot, inventoryLayout(snapshot), ["4"], 50)["4"]).toBe(50);
  });
  it("refuses protected selection, protected swap targets and protected saved-layout changes", () => {
    const layout = inventoryLayout(snapshot);
    expect(() => moveInventoryItems(snapshot, layout, [first], 2, new Set([first]))).toThrow(
      "Unprotect",
    );
    expect(() => moveInventoryItems(snapshot, layout, [first], 2, new Set(["2"]))).toThrow(
      "protected",
    );
    const next = moveInventoryItems(snapshot, layout, [first], 10);
    expect(() => restoreInventoryLayout(snapshot, layout, next, new Set([first]))).toThrow(
      "protected",
    );
  });
  it("rejects identity, collision and capacity violations", () => {
    const layout = inventoryLayout(snapshot);
    for (const destination of [0, 101, NaN, 1.5])
      expect(() => moveInventoryItems(snapshot, layout, [first], destination)).toThrow();
    expect(() => moveInventoryItems(snapshot, layout, ["foreign"], 10)).toThrow("no longer");
    expect(() => moveInventoryItems(snapshot, layout, [first, first], 10)).toThrow("distinct");
    expect(() => validateInventoryLayout(snapshot, { ...layout, "2": 1 })).toThrow("same");
    expect(() => validateInventoryLayout(snapshot, { ...layout, foreign: 4 })).toThrow(
      "identities",
    );
    expect(() =>
      inventoryLayout({ ...snapshot, items: [...snapshot.items, snapshot.items[0]] }),
    ).toThrow("identities");
  });
  it("undo and redo restore local positions; a new edit discards redo", () => {
    const initial = { past: [], present: inventoryLayout(snapshot), future: [] };
    const moved = pushInventoryLayout(
      initial,
      moveInventoryItems(snapshot, initial.present, [first], 10),
    );
    const undone = undoInventoryLayout(moved);
    expect(undone.present).toEqual(initial.present);
    expect(redoInventoryLayout(undone).present).toEqual(moved.present);
    expect(
      pushInventoryLayout(undone, moveInventoryItems(snapshot, undone.present, [first], 20)).future,
    ).toEqual([]);
  });
});
