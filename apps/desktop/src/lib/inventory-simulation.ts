import {
  BridgeError,
  type InventoryExecutedOperation,
  type InventoryLayoutRequest,
  type InventoryOperationResult,
  type InventoryPreparedOperation,
  type InventoryPrepareRequest,
  type InventorySnapshot,
} from "./bridge";
import {
  type InventoryCraftRequest,
  inventoryCraftBaseline,
  type MetalRecipeId,
  simulateInventoryCraft,
} from "./inventory-crafting";
import { simulateInventoryDelete } from "./inventory-deletion";

export function inventoryFixture(): InventorySnapshot {
  const metals = [5000, 5000, 5000, 5001, 5001, 5001, 5002];
  const items = [
    { id: "preview-1", definition: 13, position: 1, quality: 6, level: 1, customName: null },
    {
      id: "preview-paint",
      definition: 17286,
      position: 2,
      quality: 15,
      level: 1,
      customName: null,
    },
    { id: "preview-kit", definition: 6526, position: 3, quality: 6, level: 1, customName: null },
    {
      id: "preview-2",
      definition: 13,
      position: 51,
      quality: 11,
      level: 10,
      customName: "A familiar scattergun",
    },
    { id: "preview-3", definition: 5002, position: 0, quality: 6, level: 1, customName: null },
    ...metals.map((definition, index) => ({
      id: `preview-metal-${index + 1}`,
      definition,
      position: index + 4,
      quality: 6,
      level: 1,
      customName: null,
    })),
  ];
  const ids = new Map(
    items.map((item, index) => [item.id, (9007199254740993n + BigInt(index)).toString()]),
  );
  const fixtureId = (key: string) => {
    const id = ids.get(key);
    if (!id) throw new Error(`Missing fixture item: ${key}`);
    return id;
  };
  const fixtureItems = items.map((item) => ({ ...item, id: fixtureId(item.id) }));
  return {
    steamId: "Preview data",
    personaName: "Test backpack",
    avatar: null,
    capacity: 300,
    warning: null,
    items: fixtureItems,
    definitions: {
      13: { name: "Scattergun", kind: "Scattergun", classes: ["scout"], icon: null },
      5000: { name: "Scrap Metal", kind: "Crafting Item", classes: [], icon: null },
      5001: { name: "Reclaimed Metal", kind: "Crafting Item", classes: [], icon: null },
      5002: { name: "Refined Metal", kind: "Crafting Item", classes: [], icon: null },
      17286: { name: "War Paint", kind: "War Paint", classes: [], icon: null },
      6526: { name: "Killstreak Kit", kind: "Tool", classes: [], icon: null },
    },
    itemDescriptions: {
      [fixtureId("preview-paint")]: {
        name: "Skull Cracked War Paint",
        kind: "War Paint",
        classes: [],
        icon: null,
        details: ["Minimal Wear", "Pattern preview unavailable"],
      },
      [fixtureId("preview-kit")]: {
        name: "Professional Killstreak Kit · Rocket Launcher",
        kind: "Tool",
        classes: [],
        icon: null,
        details: ["Sheen: Team Shine", "Killstreaker: Fire Horns"],
      },
    },
    craftingEligibility: Object.fromEntries(
      fixtureItems.map((item) => [
        item.id,
        {
          craftable: item.definition >= 5000 && item.definition <= 5002,
          tradable: true,
          customized: Boolean(item.customName) || item.quality !== 6,
          deletable: true,
        },
      ]),
    ),
  };
}

function reject(message: string): never {
  throw new BridgeError(message, "InventoryConflict");
}

function layoutIdentity(snapshot: InventorySnapshot): string {
  return JSON.stringify([
    snapshot.steamId,
    snapshot.capacity,
    snapshot.items
      .map((item) => [item.id, item.position])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ]);
}

/** A separate authoritative fixture keeps optimistic renderer edits from becoming success. */
export function createInventorySimulation(seed: InventorySnapshot = inventoryFixture()) {
  let snapshot = structuredClone(seed);
  let sequence = 0;
  const prepared = new Map<string, { request: InventoryPrepareRequest; expiresAt: number }>();
  const simulator = {
    async getInventory() {
      return structuredClone(snapshot);
    },
    async getInventoryCapabilities() {
      return {
        organizer: "simulation" as const,
        crafting: "simulation" as const,
        deletion: "simulation" as const,
        reason: "Test backpack only. No changes are sent to Steam.",
      };
    },
    async applyInventoryLayout(request: InventoryLayoutRequest): Promise<InventoryOperationResult> {
      if (
        request.steamId !== snapshot.steamId ||
        layoutIdentity(request.baseline) !== layoutIdentity(snapshot)
      ) {
        reject("The backpack changed. Refresh and review the arrangement again.");
      }
      if (!request.moves.length || request.moves.length > 100_000)
        reject("Choose a bounded set of moves.");
      const items = new Map(snapshot.items.map((item) => [item.id, item]));
      const protectedIds = new Set(request.protectedIds);
      const moved = new Set<string>();
      const targets = new Map<string, number>();
      for (const move of request.moves) {
        const item = items.get(move.id);
        if (
          !item ||
          moved.has(move.id) ||
          item.position !== move.from ||
          protectedIds.has(move.id)
        ) {
          reject(
            "A moved item is missing, protected, repeated, or no longer in its original slot.",
          );
        }
        if (
          !Number.isSafeInteger(move.to) ||
          move.to < 1 ||
          move.to > snapshot.capacity ||
          move.to === move.from
        ) {
          reject("Each destination must be a different valid backpack slot.");
        }
        moved.add(move.id);
        targets.set(move.id, move.to);
      }
      const occupied = new Set<number>();
      const next = snapshot.items.map((item) => ({
        ...item,
        position: targets.get(item.id) ?? item.position,
      }));
      for (const item of next) {
        if (item.position === 0) continue;
        if (occupied.has(item.position)) reject("Two items cannot occupy the same backpack slot.");
        occupied.add(item.position);
      }
      snapshot = { ...snapshot, items: next };
      return {
        operationId: `simulation-layout-${++sequence}`,
        kind: "layout",
        status: "simulated",
        snapshot: structuredClone(snapshot),
        message: `Simulated ${request.moves.length} moves. Steam was not changed.`,
      };
    },
    async craftInventory(request: InventoryCraftRequest) {
      const result = simulateInventoryCraft(structuredClone(snapshot), request);
      if (result.status !== "simulated" || !result.snapshot)
        throw new Error("Invalid simulated craft result");
      snapshot = structuredClone(result.snapshot);
      return structuredClone(result);
    },
    async prepareInventoryOperation(
      request: InventoryPrepareRequest,
    ): Promise<InventoryPreparedOperation> {
      if (
        request.steamId !== snapshot.steamId ||
        JSON.stringify(request.baseline) !== JSON.stringify(snapshot)
      )
        reject("The backpack changed. Refresh and review again.");
      if (request.kind === "layout") {
        await createInventorySimulation(snapshot).applyInventoryLayout({
          ...request,
          moves: request.moves ?? [],
        });
      } else if (request.kind === "craft") {
        simulateInventoryCraft(snapshot, {
          steamId: request.steamId,
          baseline: inventoryCraftBaseline(snapshot),
          recipe: request.recipe as MetalRecipeId,
          inputIds: request.inputIds ?? [],
          protectedIds: request.protectedIds,
        });
      } else {
        simulateInventoryDelete(snapshot, { ...request, itemId: request.itemId ?? "" });
      }
      for (const [token, value] of prepared)
        if (value.expiresAt <= Date.now()) prepared.delete(token);
      if (prepared.size >= 20) reject("Too many pending reviews. Close them and try again later.");
      const token = crypto.randomUUID();
      const expiresAt = Date.now() + 120_000;
      prepared.set(token, { request: structuredClone(request), expiresAt });
      return {
        token,
        kind: request.kind,
        steamId: request.steamId,
        expiresAt,
        summary: "Reviewed fixture operation. Steam will not change.",
      };
    },
    async executeInventoryOperation(token: string): Promise<InventoryExecutedOperation> {
      const entry = prepared.get(token);
      prepared.delete(token);
      if (!entry || entry.expiresAt <= Date.now())
        reject("This review expired or was already used.");
      const request = entry.request;
      if (JSON.stringify(request.baseline) !== JSON.stringify(snapshot))
        reject("The backpack changed after review.");
      const empty = {
        consumedIds: [] as string[],
        acquiredIds: [] as string[],
        deletedIds: [] as string[],
      };
      if (request.kind === "layout")
        return {
          ...empty,
          ...(await simulator.applyInventoryLayout({ ...request, moves: request.moves ?? [] })),
        };
      if (request.kind === "craft")
        return {
          ...empty,
          ...(await simulator.craftInventory({
            steamId: request.steamId,
            baseline: inventoryCraftBaseline(snapshot),
            recipe: request.recipe as MetalRecipeId,
            inputIds: request.inputIds ?? [],
            protectedIds: request.protectedIds,
          })),
        };
      const result = simulateInventoryDelete(snapshot, {
        ...request,
        itemId: request.itemId ?? "",
      });
      if (!result.snapshot) throw Error("A simulated deletion did not return its snapshot.");
      snapshot = structuredClone(result.snapshot);
      return { ...empty, ...result };
    },
    async reconcileInventoryOperation(_steamId: string): Promise<InventoryExecutedOperation> {
      return {
        operationId: crypto.randomUUID(),
        kind: "layout",
        status: "refused",
        snapshot: null,
        consumedIds: [],
        acquiredIds: [],
        deletedIds: [],
        message: "No pending fixture operation needs reconciliation.",
      };
    },
  };
  return simulator;
}
