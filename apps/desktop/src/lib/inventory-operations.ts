import type { Api } from "./api";
import type {
  InventoryExecutedOperation,
  InventoryPreparedOperation,
  InventoryPrepareRequest,
} from "./bridge";
import { BridgeError } from "./bridge";

export type InventoryLiveApi = Pick<Api, "prepareInventoryOperation" | "executeInventoryOperation">;

/** Called only after the user's exact review confirmation. Preparing never sends a
 * mutation; a changed context or invalid token cannot reach execute. */
export async function executeReviewedInventoryOperation(
  api: Partial<InventoryLiveApi>,
  request: InventoryPrepareRequest,
  contextIsCurrent: () => boolean,
): Promise<InventoryExecutedOperation> {
  const refused = (message: string): InventoryExecutedOperation => ({
    operationId: crypto.randomUUID(),
    kind: request.kind,
    status: "refused",
    snapshot: null,
    consumedIds: [],
    acquiredIds: [],
    deletedIds: [],
    message,
  });
  if (!api.prepareInventoryOperation || !api.executeInventoryOperation)
    return refused("This connection does not support live inventory operations.");
  if (!contextIsCurrent()) return refused("The inventory context changed. Review again.");
  let prepared: InventoryPreparedOperation;
  try {
    prepared = await api.prepareInventoryOperation(request);
  } catch (error) {
    return refused(error instanceof Error ? error.message : String(error));
  }
  if (!contextIsCurrent())
    return refused("The account or selection changed before sending. Review again.");
  if (
    !prepared ||
    prepared.steamId !== request.steamId ||
    prepared.kind !== request.kind ||
    typeof prepared.token !== "string" ||
    !prepared.token ||
    prepared.token.length > 256 ||
    !Number.isSafeInteger(prepared.expiresAt) ||
    prepared.expiresAt <= Date.now()
  )
    return refused("The operation review expired or did not match this account. Review again.");
  // From this point a rejection can be an uncertain send. Callers must not retry.
  try {
    return await api.executeInventoryOperation(prepared.token);
  } catch (error) {
    if (error instanceof BridgeError && error.code === "InventoryOperationRefused")
      return refused(error.message);
    throw error;
  }
}
