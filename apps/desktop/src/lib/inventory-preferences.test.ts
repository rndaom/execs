import { describe, expect, it } from "vitest";
import type { InventorySnapshot } from "./bridge";
import {
  emptyInventoryPreferences,
  inventoryPreferencesKey,
  readInventoryPreferences,
  restoreInventoryLayout,
  saveNamedInventoryEntry,
  setInventoryFlags,
  validInventoryPositions,
  validInventoryPreferences,
  writeInventoryPreferences,
} from "./inventory-preferences";

const account = "76561198000000001";
const largeId = "18446744073709551615";
function snapshot(positions: Record<string, number>, capacity = 50): InventorySnapshot {
  return {
    steamId: account,
    capacity,
    items: Object.entries(positions).map(([id, position]) => ({
      id,
      position,
      definition: 5000,
      quality: 6,
      level: 1,
      customName: null,
    })),
    definitions: {},
    warning: null,
  };
}
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("account inventory preferences", () => {
  it("round trips 64-bit IDs as strings and never carries preferences across accounts", () => {
    const storage = memoryStorage();
    const preferences = {
      ...emptyInventoryPreferences(account),
      protectedIds: [largeId],
      favoriteIds: ["123"],
    };
    expect(writeInventoryPreferences(storage, preferences)).toBeNull();
    expect(readInventoryPreferences(storage, account).preferences).toEqual(preferences);
    expect(readInventoryPreferences(storage, "76561198000000002").preferences.protectedIds).toEqual(
      [],
    );
    storage.setItem(inventoryPreferencesKey("other"), JSON.stringify(preferences));
    expect(readInventoryPreferences(storage, "other").error).toContain("could not be read");
  });

  it("rejects malformed, oversized, future-version and corrupted protection data", () => {
    const storage = memoryStorage();
    const empty = emptyInventoryPreferences(account);
    for (const source of [
      "{",
      " ".repeat(2_000_001),
      JSON.stringify({ ...empty, version: 2 }),
      JSON.stringify({ ...empty, protectedIds: [123] }),
      JSON.stringify({ ...empty, favoriteIds: ["123", "123"] }),
    ]) {
      storage.setItem(inventoryPreferencesKey(account), source);
      const result = readInventoryPreferences(storage, account);
      expect(result.error).toContain("protections cannot be checked");
      expect(result.preferences).toEqual(empty);
    }
  });

  it("handles storage access and quota errors without throwing", () => {
    const storage = {
      getItem: () => {
        throw Error("denied");
      },
      setItem: () => {
        throw Error("quota");
      },
    };
    expect(readInventoryPreferences(storage, account).error).toContain("could not be read");
    expect(readInventoryPreferences(null, account).error).toContain("unavailable");
    expect(writeInventoryPreferences(storage, emptyInventoryPreferences(account))).toContain(
      "session only",
    );
  });

  it("bounds flags and saved entries and refuses silent same-name replacement", () => {
    expect(setInventoryFlags(["1"], ["1", largeId], true)).toEqual(["1", largeId]);
    expect(setInventoryFlags(["1", largeId], ["1"], false)).toEqual([largeId]);
    expect(() => setInventoryFlags([], ["__proto__"], true)).toThrow("identity");
    expect(() =>
      setInventoryFlags(
        [],
        Array.from({ length: 10_001 }, (_, index) => String(index + 1)),
        true,
      ),
    ).toThrow("Too many");
    expect(saveNamedInventoryEntry([], { name: " Scout " }, 2)).toEqual([{ name: "Scout" }]);
    expect(() => saveNamedInventoryEntry([{ name: "Scout" }], { name: "Scout" }, 2)).toThrow(
      "already saved",
    );
    expect(() => saveNamedInventoryEntry([{ name: "Scout" }], { name: "Heavy" }, 1)).toThrow(
      "limit",
    );
    expect(() => saveNamedInventoryEntry([], { name: "bad\nname" }, 2)).toThrow("control");
  });

  it("validates layout identity, positions and independent history outcome labels", () => {
    expect(validInventoryPositions({ "1": 1, "2": 0, "3": 0 }, 50)).toBe(true);
    for (const positions of [
      { "1": 1, "2": 1 },
      { "1": 51 },
      { "1": -1 },
      { "1": 1.5 },
      { nope: 1 },
    ])
      expect(validInventoryPositions(positions, 50)).toBe(false);
    const preferences = emptyInventoryPreferences(account);
    for (const outcome of ["confirmed", "simulated", "partial", "unknown", "refused"] as const) {
      expect(
        validInventoryPreferences(
          {
            ...preferences,
            history: [{ at: 1, kind: "move", outcome, summary: "Two items", itemIds: [largeId] }],
          },
          account,
        ),
      ).toBe(true);
    }
    expect(
      validInventoryPreferences(
        {
          ...preferences,
          history: [
            {
              at: Number.MAX_SAFE_INTEGER,
              kind: "craft",
              outcome: "success",
              summary: "x",
              itemIds: [],
            },
          ],
        },
        account,
      ),
    ).toBe(false);
  });
});

describe("saved layouts restore into drafts", () => {
  it("restores a swap without mutating the baseline or saved layout", () => {
    const current = { "1": 1, "2": 2 };
    const saved = { name: "Swap", capacity: 50, positions: { "1": 2, "2": 1 } };
    const result = restoreInventoryLayout(saved, snapshot(current), current, new Set());
    expect(result.positions).toEqual(saved.positions);
    expect(current).toEqual({ "1": 1, "2": 2 });
    expect(result.positions).not.toBe(saved.positions);
  });

  it("skips departed items and retains newly acquired, unplaced and protected items", () => {
    const current = { "1": 3, "2": 2, "3": 0, "4": 4 };
    const saved = { name: "Earlier", capacity: 50, positions: { "1": 1, "2": 6, "3": 0, "5": 5 } };
    const result = restoreInventoryLayout(saved, snapshot(current), current, new Set(["2"]));
    expect(result).toEqual({
      positions: { "1": 1, "2": 2, "3": 0, "4": 4 },
      missing: 1,
      retained: 3,
    });
  });

  it("refuses protected/new-item collisions and smaller capacity without changing any positions", () => {
    const current = { "1": 1, "2": 2 };
    const saved = { name: "Swap", capacity: 50, positions: { "1": 2, "2": 1 } };
    expect(() => restoreInventoryLayout(saved, snapshot(current), current, new Set(["2"]))).toThrow(
      "conflicts",
    );
    expect(() =>
      restoreInventoryLayout(
        { ...saved, positions: { "1": 2 } },
        snapshot(current),
        current,
        new Set(),
      ),
    ).toThrow("conflicts");
    expect(() =>
      restoreInventoryLayout(
        { ...saved, positions: { "1": 50, "2": 2 } },
        snapshot(current, 20),
        current,
        new Set(),
      ),
    ).toThrow("capacity");
    expect(current).toEqual({ "1": 1, "2": 2 });
  });

  it("refuses a draft that omits present items or includes foreign identities", () => {
    const current = { "1": 1, "2": 2 };
    const saved = { name: "Earlier", capacity: 50, positions: current };
    expect(() => restoreInventoryLayout(saved, snapshot(current), { "1": 1 }, new Set())).toThrow(
      "Refresh",
    );
    expect(() =>
      restoreInventoryLayout(saved, snapshot(current), { "1": 1, "3": 2 }, new Set()),
    ).toThrow("Refresh");
  });
});
