import { describe, expect, it } from "vitest";
import type { InventorySnapshot } from "./bridge";
import {
  type CraftRecipeId,
  craftPlans,
  type InventoryCraftEligibility,
  type InventoryCraftRequest,
  inventoryCraftBaseline,
  MAX_CRAFT_BATCH,
  METAL_RECIPES,
  selectedMetalRecipe,
  simulateInventoryCraft,
  validateInventoryCraft,
  verifyInventoryCraftResult,
} from "./inventory-crafting";

function snapshot(
  definition = 5000,
  count = 3,
): InventorySnapshot & { craftingEligibility: Record<string, InventoryCraftEligibility> } {
  const items = Array.from({ length: count }, (_, index) => ({
    id: (9007199254740993n + BigInt(index)).toString(),
    definition,
    position: index + 1,
    quality: 6,
    level: 1,
    customName: null,
  }));
  return {
    steamId: "76561198000000000",
    capacity: 50,
    warning: null,
    definitions: {},
    items,
    craftingEligibility: Object.fromEntries(
      items.map((item) => [item.id, { craftable: true, tradable: true, customized: false }]),
    ),
  };
}
function request(
  before: InventorySnapshot,
  recipe: CraftRecipeId = "combine_scrap",
): InventoryCraftRequest {
  return {
    steamId: before.steamId,
    baseline: inventoryCraftBaseline(before),
    recipe,
    inputIds: before.items.map((item) => item.id),
    protectedIds: [],
  };
}

describe("explicit metal crafting", () => {
  it("accepts an empty custom name when authoritative eligibility says uncustomized", () => {
    const before = snapshot();
    before.items[0].customName = "";
    expect(() => validateInventoryCraft(before, request(before))).not.toThrow();
    before.items[0].customName = "Named";
    expect(() => validateInventoryCraft(before, request(before))).toThrow(
      "Named or special-quality",
    );
  });
  it("accepts native confirmed results after the last consumed definition disappears", () => {
    const before = snapshot();
    before.definitions[5000] = {
      name: "Scrap Metal",
      kind: "Crafting Item",
      classes: [],
      icon: null,
    };
    const craft = request(before);
    const result = simulateInventoryCraft(before, craft);
    if (!result.snapshot) throw Error("Missing result");
    delete result.snapshot.definitions[5000];
    expect(
      verifyInventoryCraftResult(before, craft, { ...result, status: "confirmed" }, "live").status,
    ).toBe("confirmed");
    expect(verifyInventoryCraftResult(before, craft, result).status).toBe("unknown");
  });
  it("allows optional native metadata changes but rejects any unrelated raw item or eligibility change", () => {
    const before = snapshot();
    const extra = {
      ...before.items[0],
      id: "9",
      position: 9,
      rawItem: "original raw record",
      flags: 0,
    };
    before.items.push(extra);
    before.craftingEligibility[extra.id] = { craftable: true, tradable: true, customized: false };
    before.itemDescriptions = {
      "9": { name: "Scrap Metal", kind: "Crafting Item", classes: [], icon: null, details: [] },
    };
    const craft = { ...request(before), inputIds: before.items.slice(0, 3).map((item) => item.id) };
    const result = simulateInventoryCraft(before, craft);
    if (!result.snapshot) throw Error("Missing result");
    result.snapshot.itemDescriptions = {};
    result.snapshot.definitions = {};
    const confirmed = { ...result, status: "confirmed" as const };
    expect(verifyInventoryCraftResult(before, craft, confirmed, "live").status).toBe("confirmed");
    for (const change of [
      (after: InventorySnapshot) => {
        after.items[0].flags = 1;
      },
      (after: InventorySnapshot) => {
        after.items[0].rawItem = "changed raw record";
      },
      (after: InventorySnapshot) => {
        after.craftingEligibility = {};
      },
    ]) {
      const altered = structuredClone(confirmed);
      if (!altered.snapshot) throw Error("Missing result");
      change(altered.snapshot);
      expect(verifyInventoryCraftResult(before, craft, altered, "live").status).toBe("unknown");
    }
  });
  it("allows verified ingredients with an unrelated artwork warning but refuses missing eligibility", () => {
    const before = snapshot();
    before.warning = "Optional artwork could not be read";
    expect(() => validateInventoryCraft(before, request(before))).not.toThrow();
    const result = simulateInventoryCraft(before, request(before));
    expect(verifyInventoryCraftResult(before, request(before), result).status).toBe("simulated");
    delete before.craftingEligibility[before.items[0].id];
    expect(() => validateInventoryCraft(before, request(before))).toThrow(
      "restrictions have not been verified",
    );
  });
  it.each(METAL_RECIPES)("resolves $id directly from the complete selected set", (recipe) => {
    const before = snapshot(recipe.input, recipe.inputCount);
    expect(
      selectedMetalRecipe(
        before,
        before.items.map((item) => item.id),
      )?.id,
    ).toBe(recipe.id);
  });
  it("never chooses a recipe for mixed, missing, duplicate or excessive ingredients", () => {
    const before = snapshot();
    const ids = before.items.map((item) => item.id);
    for (const selected of [
      [],
      ids.slice(0, 2),
      [ids[0], ids[0], ids[1]],
      [ids[0], ids[1], "missing"],
      [...ids, "missing"],
    ]) {
      expect(selectedMetalRecipe(before, selected)).toBeNull();
    }
    before.items[1].definition = 5001;
    expect(selectedMetalRecipe(before, ids)).toBeNull();
  });
  it.each(METAL_RECIPES)("conserves metal value and exact uint64 identity for $id", (recipe) => {
    const before = snapshot(recipe.input, recipe.inputCount);
    const saved = structuredClone(before);
    const craft = request(before, recipe.id);
    const result = simulateInventoryCraft(before, craft);
    expect(result.status).toBe("simulated");
    expect(result.consumedIds).toEqual(craft.inputIds);
    expect(new Set(result.acquiredIds).size).toBe(recipe.outputCount);
    expect(result.acquiredIds.every((id) => !craft.inputIds.includes(id))).toBe(true);
    expect(result.snapshot?.items.map((item) => item.definition)).toEqual(
      Array(recipe.outputCount).fill(recipe.output),
    );
    const value = (state: InventorySnapshot) =>
      state.items.reduce((sum, item) => sum + 3 ** (item.definition - 5000), 0);
    if (!result.snapshot) throw new Error("Missing simulation output");
    expect(value(result.snapshot)).toBe(value(before));
    expect(verifyInventoryCraftResult(before, craft, result)).toBe(result);
    expect(before).toEqual(saved);
  });
  it("refuses stale identity, capacity, eligibility and position reviews", () => {
    const before = snapshot();
    const craft = request(before);
    const changes = [
      { ...before, steamId: "another" },
      { ...before, capacity: 51 },
      { ...before, craftingRevision: "new" },
      {
        ...before,
        items: before.items.map((item, index) => (index === 0 ? { ...item, position: 30 } : item)),
      },
      { ...before, craftingEligibility: {} },
    ];
    for (const changed of changes)
      expect(() => validateInventoryCraft(changed, craft)).toThrow(/changed/);
    expect(() =>
      validateInventoryCraft(before, {
        ...craft,
        inputIds: [craft.inputIds[0], craft.inputIds[0], craft.inputIds[2]],
      }),
    ).toThrow(/distinct/);
    expect(() =>
      validateInventoryCraft(before, { ...craft, inputIds: ["999", ...craft.inputIds.slice(1)] }),
    ).toThrow(/no longer/);
  });
  it("does not infer eligibility from names, quality or metal definitions", () => {
    const before = snapshot();
    const id = before.items[0].id;
    const cases = [
      undefined,
      { craftable: null, tradable: true, customized: false },
      { craftable: false, tradable: true, customized: false },
      { craftable: true, tradable: null, customized: false },
      { craftable: true, tradable: false, customized: false },
      { craftable: true, tradable: true, customized: null },
      { craftable: true, tradable: true, customized: true },
    ];
    for (const eligibility of cases) {
      const changed = structuredClone(before);
      if (eligibility) changed.craftingEligibility[id] = eligibility;
      else delete changed.craftingEligibility[id];
      expect(() => simulateInventoryCraft(changed, request(changed))).toThrow();
    }
    expect(() =>
      simulateInventoryCraft(before, { ...request(before), protectedIds: [id] }),
    ).toThrow(/Protected/);
    for (const modification of [
      { customName: "Treasured scrap" },
      { quality: 11 },
      { definition: 13 },
    ]) {
      const changed = structuredClone(before);
      Object.assign(changed.items[0], modification);
      expect(() => simulateInventoryCraft(changed, request(changed))).toThrow();
    }
  });
  it("refuses full output capacity, duplicate identities, occupied-slot collisions and incomplete snapshots", () => {
    const full = snapshot(5002, 1);
    full.capacity = 2;
    expect(() => simulateInventoryCraft(full, request(full, "smelt_refined"))).toThrow(/space/);
    const duplicate = snapshot();
    duplicate.items[1].id = duplicate.items[0].id;
    expect(() => simulateInventoryCraft(duplicate, request(duplicate))).toThrow(/duplicated/);
    const collision = snapshot();
    collision.items[1].position = collision.items[0].position;
    expect(() => simulateInventoryCraft(collision, request(collision))).toThrow(/positions/);
    const incomplete = { ...snapshot(), steamId: "" };
    expect(() => simulateInventoryCraft(incomplete, request(incomplete))).toThrow(/complete/);
  });
  it("never rounds large IDs or recycles inputs on uint64 overflow", () => {
    const before = snapshot(5002, 1);
    const oldId = before.items[0].id;
    before.items[0].id = "18446744073709551615";
    before.craftingEligibility[before.items[0].id] = before.craftingEligibility[oldId];
    delete before.craftingEligibility[oldId];
    expect(() => simulateInventoryCraft(before, request(before, "smelt_refined"))).toThrow(/range/);
  });
  it("preserves unrelated items and uses vacant output slots", () => {
    const before = snapshot(5002, 1);
    const extra = {
      id: "4",
      definition: 13,
      position: 2,
      quality: 11,
      level: 20,
      customName: "Favorite",
    };
    before.items.push(extra);
    const craft = { ...request(before, "smelt_refined"), inputIds: [before.items[0].id] };
    const result = simulateInventoryCraft(before, craft);
    expect(result.snapshot?.items.find((item) => item.id === "4")).toEqual(extra);
    expect(result.snapshot?.items.map((item) => item.position)).toEqual([2, 1, 3, 4]);
    expect(verifyInventoryCraftResult(before, craft, result)).toBe(result);
  });
  it("downgrades a claimed success when consumed IDs or output evidence is missing, duplicated or wrong", () => {
    const before = snapshot();
    const craft = request(before);
    const result = simulateInventoryCraft(before, craft);
    const missingOutput = structuredClone(result);
    const wrongOutput = structuredClone(result);
    if (!missingOutput.snapshot || !wrongOutput.snapshot || !result.snapshot)
      throw new Error("Missing simulation output");
    missingOutput.snapshot.items = [];
    wrongOutput.snapshot.items[0].definition = 5002;
    const changedAccount = { ...result, snapshot: { ...result.snapshot, steamId: "other" } };
    for (const invalid of [
      { ...result, consumedIds: [] },
      { ...result, acquiredIds: [...result.acquiredIds, ...result.acquiredIds] },
      { ...result, snapshot: null },
      missingOutput,
      wrongOutput,
      changedAccount,
    ]) {
      const verified = verifyInventoryCraftResult(before, craft, invalid);
      expect(verified.status).toBe("unknown");
      expect(verified.snapshot).toBeNull();
      expect(verified.message).toMatch(/do not repeat/);
    }
    const unknown = { ...result, status: "unknown" as const, snapshot: null };
    expect(verifyInventoryCraftResult(before, craft, unknown)).toMatchObject({
      status: "unknown",
      snapshot: null,
      consumedIds: [],
      acquiredIds: [],
    });
  });
  it("refuses live success in simulation and strips unverified snapshots on every non-success outcome", () => {
    const before = snapshot();
    const craft = request(before);
    const result = simulateInventoryCraft(before, craft);
    for (const status of ["confirmed", "partial", "unknown"] as const) {
      const received = {
        ...result,
        status,
        snapshot: { ...result.snapshot, steamId: "foreign-account" } as InventorySnapshot,
      };
      expect(verifyInventoryCraftResult(before, craft, received)).toMatchObject({
        status: status === "partial" ? "partial" : "unknown",
        snapshot: null,
        consumedIds: [],
        acquiredIds: [],
      });
    }
    expect(
      verifyInventoryCraftResult(before, craft, { ...result, status: "confirmed" }).status,
    ).toBe("unknown");
  });
  it("refuses collateral name, position, restriction and description changes", () => {
    const before = snapshot();
    const extra = { ...before.items[0], id: "9", position: 9 };
    before.items.push(extra);
    before.craftingEligibility[extra.id] = { craftable: true, tradable: true, customized: false };
    before.itemDescriptions = {
      "9": { name: "Scrap Metal", kind: "Crafting Item", classes: [], icon: null, details: [] },
    };
    const craft = { ...request(before), inputIds: before.items.slice(0, 3).map((item) => item.id) };
    const result = simulateInventoryCraft(before, craft);
    for (const alter of [
      (after: InventorySnapshot) => {
        after.items[0].customName = "changed";
      },
      (after: InventorySnapshot) => {
        after.items[0].position = 30;
      },
      (after: InventorySnapshot) => {
        after.craftingEligibility = {};
      },
      (after: InventorySnapshot) => {
        after.itemDescriptions = {};
      },
    ]) {
      const changed = structuredClone(result);
      if (!changed.snapshot) throw new Error("Missing simulation output");
      alter(changed.snapshot);
      expect(verifyInventoryCraftResult(before, craft, changed).status).toBe("unknown");
    }
  });
});

describe("crafting plans", () => {
  it("splits a pile into whole crafts in slot order and names what stays", () => {
    const before = snapshot(5000, 17);
    before.items.reverse();
    const [plan, ...others] = craftPlans(
      before,
      before.items.map((item) => item.id),
    );
    expect(others).toHaveLength(0);
    expect(plan.recipe.id).toBe("combine_scrap");
    expect(plan.batches).toHaveLength(5);
    expect(plan.batches[0]).toEqual(
      before.items
        .filter((item) => item.position <= 3)
        .sort((a, b) => a.position - b.position)
        .map((item) => item.id),
    );
    expect(plan.unused).toHaveLength(2);
  });
  it("offers a hat or smelting for refined metal, and nothing for mixed metal", () => {
    const refined = snapshot(5002, 3);
    expect(
      craftPlans(
        refined,
        refined.items.map((item) => item.id),
      ).map((p) => p.recipe.id),
    ).toEqual(["craft_hat", "smelt_refined"]);
    const mixed = snapshot(5000, 3);
    mixed.items[0].definition = 5001;
    expect(
      craftPlans(
        mixed,
        mixed.items.map((item) => item.id),
      ),
    ).toEqual([]);
    const reclaimed = snapshot(5001, 1);
    expect(craftPlans(reclaimed, [reclaimed.items[0].id]).map((p) => p.recipe.id)).toEqual([
      "smelt_reclaimed",
    ]);
  });
  it("bounds one review to a fixed number of crafts", () => {
    const pile = snapshot(5000, (MAX_CRAFT_BATCH + 5) * 3);
    pile.capacity = 1000;
    const [plan] = craftPlans(
      pile,
      pile.items.map((item) => item.id),
    );
    expect(plan.batches).toHaveLength(MAX_CRAFT_BATCH);
  });
  it("simulates a random hat and verifies it without a fixed output", () => {
    const before = snapshot(5002, 3);
    const craft = request(before, "craft_hat");
    const result = simulateInventoryCraft(before, craft);
    expect(result.acquiredIds).toHaveLength(1);
    expect(verifyInventoryCraftResult(before, craft, result).status).toBe("simulated");
  });
});
