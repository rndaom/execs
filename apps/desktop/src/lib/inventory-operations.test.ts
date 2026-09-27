import { expect, it, vi } from "vitest";
import type { InventoryExecutedOperation, InventoryPrepareRequest } from "./bridge";
import { BridgeError } from "./bridge";
import { executeReviewedInventoryOperation } from "./inventory-operations";
import { inventoryFixture } from "./inventory-simulation";

function request(): InventoryPrepareRequest {
  const baseline = inventoryFixture();
  return {
    kind: "delete",
    steamId: baseline.steamId,
    baseline,
    itemId: baseline.items[0].id,
    protectedIds: [],
  };
}
function apiFor(operation: InventoryPrepareRequest) {
  return {
    prepareInventoryOperation: vi.fn().mockResolvedValue({
      token: "one-use",
      kind: operation.kind,
      steamId: operation.steamId,
      expiresAt: Date.now() + 120_000,
      summary: "Exact reviewed item",
    }),
    executeInventoryOperation: vi
      .fn()
      .mockResolvedValue({ kind: "delete", status: "confirmed" } as InventoryExecutedOperation),
  };
}
it("prepares the full opaque baseline and executes only its one-use token", async () => {
  const operation = request();
  operation.baseline.items[0].rawItem = "opaque-native-record";
  const api = apiFor(operation);
  await executeReviewedInventoryOperation(api, operation, () => true);
  expect(api.prepareInventoryOperation).toHaveBeenCalledWith(operation);
  expect(api.executeInventoryOperation).toHaveBeenCalledExactlyOnceWith("one-use");
});
it("refuses changed account, expired or foreign review without execute", async () => {
  const operation = request();
  for (const changed of [
    { steamId: "another-account" },
    { kind: "craft" },
    { expiresAt: 1 },
    { token: "" },
  ]) {
    const api = apiFor(operation);
    api.prepareInventoryOperation.mockResolvedValue({
      token: "token",
      kind: operation.kind,
      steamId: operation.steamId,
      expiresAt: Date.now() + 120_000,
      ...changed,
    });
    expect((await executeReviewedInventoryOperation(api, operation, () => true)).status).toBe(
      "refused",
    );
    expect(api.executeInventoryOperation).not.toHaveBeenCalled();
  }
  const api = apiFor(operation);
  const current = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
  expect((await executeReviewedInventoryOperation(api, operation, current)).status).toBe("refused");
  expect(api.executeInventoryOperation).not.toHaveBeenCalled();
});
it("separates harmless prepare refusal from an uncertain execute failure", async () => {
  const operation = request();
  const api = apiFor(operation);
  api.prepareInventoryOperation.mockRejectedValueOnce(Error("Game is running"));
  expect((await executeReviewedInventoryOperation(api, operation, () => true)).status).toBe(
    "refused",
  );
  expect(api.executeInventoryOperation).not.toHaveBeenCalled();
  api.executeInventoryOperation.mockRejectedValueOnce(Error("Disconnected after send"));
  await expect(executeReviewedInventoryOperation(api, operation, () => true)).rejects.toThrow(
    "Disconnected",
  );
  expect(api.executeInventoryOperation).toHaveBeenCalledTimes(1);
});

it("recognizes only the native pre-dispatch refusal code after preparing", async () => {
  const operation = request();
  const api = apiFor(operation);
  api.executeInventoryOperation.mockRejectedValueOnce(
    new BridgeError("Review expired", "InventoryOperationRefused"),
  );
  expect(await executeReviewedInventoryOperation(api, operation, () => true)).toMatchObject({
    status: "refused",
    snapshot: null,
    message: "Review expired",
  });
  api.executeInventoryOperation.mockRejectedValueOnce(
    new BridgeError("Read failed", "InventoryConnection"),
  );
  await expect(executeReviewedInventoryOperation(api, operation, () => true)).rejects.toThrow(
    "Read failed",
  );
});
