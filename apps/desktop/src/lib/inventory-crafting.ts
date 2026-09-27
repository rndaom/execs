import type { InventoryItem, InventoryOperationResult, InventorySnapshot } from "./bridge";

/** These are local recipe keys, never GC recipe indices or wildcard recipes. */
export const METAL_RECIPES = [
  {
    id: "combine_scrap",
    name: "Combine scrap",
    input: 5000,
    inputCount: 3,
    output: 5001,
    outputCount: 1,
  },
  {
    id: "combine_reclaimed",
    name: "Combine reclaimed",
    input: 5001,
    inputCount: 3,
    output: 5002,
    outputCount: 1,
  },
  {
    id: "smelt_reclaimed",
    name: "Smelt reclaimed",
    input: 5001,
    inputCount: 1,
    output: 5000,
    outputCount: 3,
  },
  {
    id: "smelt_refined",
    name: "Smelt refined",
    input: 5002,
    inputCount: 1,
    output: 5001,
    outputCount: 3,
  },
] as const;
export type MetalRecipeId = (typeof METAL_RECIPES)[number]["id"];
export type MetalRecipe = (typeof METAL_RECIPES)[number];
/** Three Refined Metal for one random hat. The coordinator picks the hat. */
export const HAT_RECIPE = {
  id: "craft_hat",
  name: "Random hat",
  input: 5002,
  inputCount: 3,
  output: null,
  outputCount: 1,
} as const;
export const CRAFT_RECIPES = [...METAL_RECIPES, HAT_RECIPE] as const;
export type CraftRecipe = (typeof CRAFT_RECIPES)[number];
export type CraftRecipeId = CraftRecipe["id"];
/** One review runs at most this many crafts, one after another. */
export const MAX_CRAFT_BATCH = 100;
/** A way to craft the selection: whole crafts in slot order, plus what stays unused. */
export type CraftPlan = {
  recipe: CraftRecipe;
  batches: string[][];
  unused: string[];
};
export type InventoryCraftEligibility = {
  /** Missing, incomplete, or unqualified native evidence stays null. */
  craftable: boolean | null;
  tradable: boolean | null;
  customized: boolean | null;
};
export type InventoryCraftRequest = {
  steamId: string;
  baseline: string;
  recipe: CraftRecipeId;
  inputIds: string[];
  protectedIds: string[];
};
export type InventoryCraftResult = InventoryOperationResult & {
  kind: "craft";
  consumedIds: string[];
  acquiredIds: string[];
};

export const METAL_NAMES: Record<number, string> = {
  5000: "Scrap Metal",
  5001: "Reclaimed Metal",
  5002: "Refined Metal",
};

/** Resolve only an exact, unique metal conversion; never infer eligible substitutes. */
export function selectedMetalRecipe(
  snapshot: InventorySnapshot,
  selectedIds: readonly string[],
): MetalRecipe | null {
  if (new Set(selectedIds).size !== selectedIds.length) return null;
  const items = selectedIds.map((id) => snapshot.items.find((item) => item.id === id));
  const matches = METAL_RECIPES.filter(
    (recipe) =>
      items.length === recipe.inputCount &&
      items.every((item) => item?.definition === recipe.input),
  );
  return matches.length === 1 ? matches[0] : null;
}
/** Every recipe the selection could run, in the order the Craft sheet offers them. */
export function craftPlans(
  snapshot: InventorySnapshot,
  selectedIds: readonly string[],
): CraftPlan[] {
  if (!selectedIds.length || new Set(selectedIds).size !== selectedIds.length) return [];
  const byId = new Map(snapshot.items.map((item) => [item.id, item]));
  const items = selectedIds.map((id) => byId.get(id));
  if (items.some((item) => !item)) return [];
  const definition = items[0]?.definition;
  if (!items.every((item) => item?.definition === definition)) return [];
  const ordered = (items as InventoryItem[])
    .slice()
    .sort(
      (a, b) =>
        (a.position || Number.MAX_SAFE_INTEGER) - (b.position || Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id),
    )
    .map((item) => item.id);
  // Combining and hats come first: they are what a pile of metal is usually for.
  const order: CraftRecipeId[] = [
    "combine_scrap",
    "combine_reclaimed",
    "craft_hat",
    "smelt_reclaimed",
    "smelt_refined",
  ];
  return order.flatMap((id) => {
    const recipe = CRAFT_RECIPES.find((entry) => entry.id === id);
    if (!recipe || recipe.input !== definition) return [];
    const count = Math.min(Math.floor(ordered.length / recipe.inputCount), MAX_CRAFT_BATCH);
    if (count < 1) return [];
    const used = count * recipe.inputCount;
    return [
      {
        recipe,
        batches: Array.from({ length: count }, (_, index) =>
          ordered.slice(index * recipe.inputCount, (index + 1) * recipe.inputCount),
        ),
        unused: ordered.slice(used),
      },
    ];
  });
}

/** Fixture hats the simulator can award. Live hats come from the coordinator. */
export const SIMULATED_HATS: Record<number, string> = {
  30001: "Modest Pile of Hat",
  30002: "Towering Pillar of Hats",
  30003: "Noble Amassment of Hats",
};

const MAX_ITEM_ID = 18446744073709551615n;
function validId(id: string): boolean {
  return /^[1-9][0-9]{0,19}$/.test(id) && BigInt(id) <= MAX_ITEM_ID;
}

/** Exact comparison token for the simulator/UI. Native authority must issue its own review. */
export function inventoryCraftBaseline(snapshot: InventorySnapshot): string {
  return JSON.stringify([
    snapshot.steamId,
    snapshot.capacity,
    snapshot.warning,
    snapshot.craftingRevision ?? null,
    snapshot.cacheVersion ?? null,
    [...snapshot.items]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((item) => [
        item,
        snapshot.craftingEligibility?.[item.id]?.craftable ?? null,
        snapshot.craftingEligibility?.[item.id]?.tradable ?? null,
        snapshot.craftingEligibility?.[item.id]?.customized ?? null,
      ]),
  ]);
}

function validateSnapshot(snapshot: InventorySnapshot): void {
  if (!snapshot.steamId) throw new Error("Refresh a complete backpack before crafting.");
  if (
    !Number.isInteger(snapshot.capacity) ||
    snapshot.capacity < 1 ||
    snapshot.capacity > 10000 ||
    snapshot.items.length > snapshot.capacity
  ) {
    throw new Error("Backpack capacity is invalid or exceeded.");
  }
  const ids = new Set<string>();
  const slots = new Set<number>();
  for (const item of snapshot.items) {
    if (!validId(item.id) || ids.has(item.id))
      throw new Error("Backpack item identities are invalid or duplicated.");
    if (
      !Number.isInteger(item.position) ||
      item.position < 0 ||
      item.position > snapshot.capacity ||
      (item.position > 0 && slots.has(item.position))
    ) {
      throw new Error("Backpack positions are invalid or duplicated.");
    }
    ids.add(item.id);
    if (item.position > 0) slots.add(item.position);
  }
}

export function craftingItemRefusal(
  snapshot: InventorySnapshot,
  item: InventoryItem,
  protectedIds: ReadonlySet<string>,
): string | null {
  if (protectedIds.has(item.id)) return "Protected or favorite item";
  if (item.customName || item.quality !== 6) return "Named or special-quality items are protected";
  const eligibility = snapshot.craftingEligibility?.[item.id];
  if (
    !eligibility ||
    eligibility.craftable === null ||
    eligibility.tradable === null ||
    eligibility.customized === null
  )
    return "Crafting restrictions have not been verified";
  if (eligibility.craftable !== true) return "Item cannot be used in crafting";
  if (eligibility.tradable !== true) return "Restricted metal is not supported by these recipes";
  if (eligibility.customized !== false) return "Customized items are protected";
  return null;
}

/** Revalidate at confirmation and again inside the simulator; never select ingredients here. */
export function validateInventoryCraft(
  snapshot: InventorySnapshot,
  request: InventoryCraftRequest,
): { recipe: CraftRecipe; inputs: InventoryItem[] } {
  validateSnapshot(snapshot);
  if (request.steamId !== snapshot.steamId || request.baseline !== inventoryCraftBaseline(snapshot))
    throw new Error("The backpack changed. Review the ingredients again.");
  const recipe = CRAFT_RECIPES.find((candidate) => candidate.id === request.recipe);
  if (!recipe) throw new Error("This recipe is not supported.");
  if (
    request.inputIds.length !== recipe.inputCount ||
    new Set(request.inputIds).size !== request.inputIds.length
  )
    throw new Error(
      `Select exactly ${recipe.inputCount} distinct ${METAL_NAMES[recipe.input]} item${recipe.inputCount === 1 ? "" : "s"}.`,
    );
  const protectedIds = new Set(request.protectedIds);
  const inputs = request.inputIds.map((id) => {
    const item = snapshot.items.find((candidate) => candidate.id === id);
    if (!item) throw new Error(`Selected item ${id} is no longer in this backpack.`);
    if (item.definition !== recipe.input)
      throw new Error(`Item ${id} is not ${METAL_NAMES[recipe.input]}.`);
    const refusal = craftingItemRefusal(snapshot, item, protectedIds);
    if (refusal) throw new Error(`Item ${id}: ${refusal}.`);
    return item;
  });
  if (snapshot.items.length - inputs.length + recipe.outputCount > snapshot.capacity)
    throw new Error("There is not enough backpack space for the recipe output.");
  return { recipe, inputs };
}

/** Fixture-only transformation. This function has no transport and cannot consume Steam items. */
export function simulateInventoryCraft(
  snapshot: InventorySnapshot,
  request: InventoryCraftRequest,
): InventoryCraftResult {
  const { recipe } = validateInventoryCraft(snapshot, request);
  const next = structuredClone(snapshot);
  const consumed = new Set(request.inputIds);
  next.items = next.items.filter((item) => !consumed.has(item.id));
  next.craftingEligibility = { ...next.craftingEligibility };
  for (const id of consumed) {
    delete next.craftingEligibility[id];
    if (next.itemDescriptions) delete next.itemDescriptions[id];
  }
  const occupied = new Set(next.items.map((item) => item.position));
  let id = snapshot.items.reduce(
    (max, item) => (BigInt(item.id) > max ? BigInt(item.id) : max),
    0n,
  );
  // Never silently round uint64 identities or recycle a consumed ID.
  if (id + BigInt(recipe.outputCount) > MAX_ITEM_ID)
    throw new Error("The fixture has exhausted its item ID range.");
  const acquiredIds: string[] = [];
  for (let index = 0; index < recipe.outputCount; index++) {
    id += 1n;
    let position = 1;
    while (occupied.has(position)) position++;
    occupied.add(position);
    const itemId = id.toString();
    acquiredIds.push(itemId);
    const hats = Object.keys(SIMULATED_HATS).map(Number);
    const definition =
      recipe.output ?? hats[Math.min(hats.length - 1, Math.floor(Math.random() * hats.length))];
    if (recipe.output === null)
      next.definitions[definition] ??= {
        name: SIMULATED_HATS[definition],
        kind: "Hat",
        classes: [],
        icon: null,
      };
    next.items.push({
      id: itemId,
      definition,
      position,
      quality: 6,
      level: recipe.output === null ? 1 + Math.floor(Math.random() * 100) : 1,
      customName: null,
    });
    next.craftingEligibility[itemId] = {
      craftable: true,
      tradable: true,
      customized: false,
      deletable: true,
    };
  }
  if (recipe.output !== null)
    next.definitions[recipe.output] ??= {
      name: METAL_NAMES[recipe.output],
      kind: "Crafting Item",
      classes: [],
      icon: null,
    };
  next.craftingRevision = `simulation:${crypto.randomUUID()}`;
  const created =
    recipe.output === null
      ? (next.definitions[next.items[next.items.length - 1].definition]?.name ?? "a hat")
      : `${recipe.outputCount} ${METAL_NAMES[recipe.output]}`;
  return {
    operationId: crypto.randomUUID(),
    kind: "craft",
    status: "simulated",
    snapshot: next,
    message: `Simulation complete: created ${created}. Steam items were not changed.`,
    consumedIds: [...request.inputIds],
    acquiredIds,
  };
}

/** A claimed success without exact consumed/new identities remains uncertain, never retryable. */
export function verifyInventoryCraftResult(
  before: InventorySnapshot,
  request: InventoryCraftRequest,
  result: InventoryCraftResult,
  mode: "simulation" | "live" = "simulation",
): InventoryCraftResult {
  if (result?.status === "refused")
    return { ...result, snapshot: null, consumedIds: [], acquiredIds: [] };
  try {
    if (result.status !== (mode === "live" ? "confirmed" : "simulated"))
      throw new Error("Unexpected or incomplete operation mode");
    const { recipe } = validateInventoryCraft(before, request);
    const after = result.snapshot;
    if (!after || after.steamId !== before.steamId || after.capacity !== before.capacity)
      throw new Error("Snapshot identity changed");
    validateSnapshot(after);
    const expectedConsumed = new Set(request.inputIds);
    const consumed = new Set(result.consumedIds);
    const acquired = new Set(result.acquiredIds);
    if (
      result.kind !== "craft" ||
      consumed.size !== result.consumedIds.length ||
      consumed.size !== expectedConsumed.size ||
      [...consumed].some((id) => !expectedConsumed.has(id)) ||
      acquired.size !== result.acquiredIds.length ||
      acquired.size !== recipe.outputCount
    )
      throw new Error("Craft identities did not reconcile");
    const previousIds = new Set(before.items.map((item) => item.id));
    if (
      [...acquired].some((id) => previousIds.has(id)) ||
      after.items.some((item) => consumed.has(item.id))
    )
      throw new Error("Consumed or reused item identity");
    const afterById = new Map(after.items.map((item) => [item.id, item]));
    for (const item of before.items.filter((item) => !consumed.has(item.id))) {
      const current = afterById.get(item.id);
      if (
        !current ||
        JSON.stringify(current) !== JSON.stringify(item) ||
        JSON.stringify(after.craftingEligibility?.[item.id] ?? null) !==
          JSON.stringify(before.craftingEligibility?.[item.id] ?? null) ||
        (mode === "simulation" &&
          JSON.stringify(after.itemDescriptions?.[item.id] ?? null) !==
            JSON.stringify(before.itemDescriptions?.[item.id] ?? null))
      )
        throw new Error("Unrelated item changed");
    }
    if (mode === "simulation") {
      // A simulated hat adds its own definition; existing ones must not change.
      for (const [definition, description] of Object.entries(before.definitions)) {
        if (JSON.stringify(after.definitions[definition]) !== JSON.stringify(description))
          throw new Error("Existing item definition changed");
      }
    }
    if (after.items.length !== before.items.length - consumed.size + acquired.size)
      throw new Error("Unexpected item count");
    for (const id of acquired) {
      const item = afterById.get(id);
      // The native review verified a hat against the installed hat list.
      if (
        !item ||
        (recipe.output === null
          ? item.definition in METAL_NAMES
          : item.definition !== recipe.output || craftingItemRefusal(after, item, new Set()))
      )
        throw new Error("Unexpected recipe output");
    }
    return result;
  } catch {
    return {
      operationId:
        typeof result?.operationId === "string" ? result.operationId : crypto.randomUUID(),
      kind: "craft",
      status: result?.status === "partial" ? "partial" : "unknown",
      snapshot: null,
      consumedIds: [],
      acquiredIds: [],
      message:
        "Crafting outcome could not be verified. Check the backpack before another attempt; do not repeat this craft.",
    };
  }
}
