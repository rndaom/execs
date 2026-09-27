import type { InventoryOperationResult, InventorySnapshot } from "./bridge";
import { inventoryLayout } from "./inventory-organizer";

export type InventoryDeleteRequest = {
  steamId: string;
  baseline: InventorySnapshot;
  itemId: string;
  protectedIds: string[];
};
export type InventoryDeleteResult = InventoryOperationResult & {
  kind: "delete";
  deletedIds: string[];
};

export function validateInventoryDelete(
  snapshot: InventorySnapshot,
  request: InventoryDeleteRequest,
): void {
  inventoryLayout(snapshot);
  if (
    snapshot.steamId !== request.steamId ||
    JSON.stringify(request.baseline) !== JSON.stringify(snapshot)
  )
    throw Error("The backpack changed or is incomplete. Refresh and review the item again.");
  if (
    !/^[1-9]\d{0,19}$/.test(request.itemId) ||
    !snapshot.items.some((item) => item.id === request.itemId)
  )
    throw Error("The selected item is no longer in this backpack.");
  if (request.protectedIds.includes(request.itemId))
    throw Error("Unfavorite and unprotect this item before deleting it.");
  if (snapshot.craftingEligibility?.[request.itemId]?.deletable !== true)
    throw Error(
      snapshot.craftingEligibility?.[request.itemId]?.reason ||
        "Deletion eligibility has not been verified for this item.",
    );
}

export function simulateInventoryDelete(
  snapshot: InventorySnapshot,
  request: InventoryDeleteRequest,
): InventoryDeleteResult {
  validateInventoryDelete(snapshot, request);
  const next = structuredClone(snapshot);
  next.items = next.items.filter((item) => item.id !== request.itemId);
  if (next.craftingEligibility) delete next.craftingEligibility[request.itemId];
  if (next.itemDescriptions) delete next.itemDescriptions[request.itemId];
  next.craftingRevision = `simulation:${crypto.randomUUID()}`;
  return {
    operationId: crypto.randomUUID(),
    kind: "delete",
    status: "simulated",
    snapshot: next,
    deletedIds: [request.itemId],
    message: "Deleted the selected fixture item. Steam was not changed.",
  };
}

export function verifyInventoryDeleteResult(
  before: InventorySnapshot,
  request: InventoryDeleteRequest,
  result: InventoryDeleteResult,
  mode: "simulation" | "live" = "simulation",
): InventoryDeleteResult {
  const unknown = (): InventoryDeleteResult => ({
    operationId: result?.operationId || crypto.randomUUID(),
    kind: "delete",
    status: "unknown",
    snapshot: null,
    deletedIds: [],
    message:
      "Deletion could not be verified. Reconcile the backpack before another operation; do not repeat this deletion.",
  });
  if (result?.status === "refused") return { ...result, snapshot: null, deletedIds: [] };
  try {
    validateInventoryDelete(before, request);
    const after = result.snapshot;
    if (
      result.kind !== "delete" ||
      result.status !== (mode === "live" ? "confirmed" : "simulated") ||
      !after ||
      after.steamId !== before.steamId ||
      after.capacity !== before.capacity ||
      result.deletedIds.length !== 1 ||
      result.deletedIds[0] !== request.itemId
    )
      return unknown();
    inventoryLayout(after);
    const survivors = before.items.filter((item) => item.id !== request.itemId);
    if (
      after.items.length !== survivors.length ||
      survivors.some((item) => {
        const actual = after.items.find((entry) => entry.id === item.id);
        return !actual || JSON.stringify(actual) !== JSON.stringify(item);
      })
    )
      return unknown();
    return result;
  } catch {
    return unknown();
  }
}
