import { expect, it } from "vitest";
import {
  simulateInventoryDelete,
  validateInventoryDelete,
  verifyInventoryDeleteResult,
} from "./inventory-deletion";
import { createInventorySimulation, inventoryFixture } from "./inventory-simulation";

it("allows verified deletion with an unrelated metadata warning but refuses missing eligibility", () => {
  const baseline = inventoryFixture();
  baseline.warning = "Optional artwork could not be read";
  const request = {
    steamId: baseline.steamId,
    baseline,
    itemId: baseline.items[0].id,
    protectedIds: [],
  };
  expect(() => validateInventoryDelete(baseline, request)).not.toThrow();
  const result = simulateInventoryDelete(baseline, request);
  expect(verifyInventoryDeleteResult(baseline, request, result).status).toBe("simulated");
  const missing = { ...baseline, craftingEligibility: {} };
  expect(() => validateInventoryDelete(missing, { ...request, baseline: missing })).toThrow(
    "eligibility has not been verified",
  );
});

it("deletes exactly one reviewed fixture identity and retains every other item", () => {
  const baseline = inventoryFixture();
  const request = {
    steamId: baseline.steamId,
    baseline,
    itemId: baseline.items[0].id,
    protectedIds: [],
  };
  const result = simulateInventoryDelete(baseline, request);
  expect(result.deletedIds).toEqual([request.itemId]);
  expect(result.snapshot?.items).toEqual(baseline.items.slice(1));
  expect(baseline.items).toHaveLength(20);
  expect(verifyInventoryDeleteResult(baseline, request, result).status).toBe("simulated");
  expect(
    verifyInventoryDeleteResult(baseline, request, { ...result, status: "confirmed" }).status,
  ).toBe("unknown");
  expect(
    verifyInventoryDeleteResult(baseline, request, { ...result, status: "confirmed" }, "live")
      .status,
  ).toBe("confirmed");
});
it("refuses protected, foreign, missing, changed and incomplete items before deletion", () => {
  const baseline = inventoryFixture();
  const request = {
    steamId: baseline.steamId,
    baseline,
    itemId: baseline.items[0].id,
    protectedIds: [],
  };
  for (const invalid of [
    { ...request, protectedIds: [request.itemId] },
    { ...request, steamId: "foreign" },
    { ...request, itemId: "1" },
    { ...request, itemId: "" },
    { ...request, baseline: { ...baseline, capacity: 50 } },
  ])
    expect(() => validateInventoryDelete(baseline, invalid)).toThrow();
  expect(() => validateInventoryDelete({ ...baseline, warning: "Incomplete" }, request)).toThrow();
});
it("strips partial, wrong-ID and unrelated item changes instead of announcing success", () => {
  const baseline = inventoryFixture();
  const request = {
    steamId: baseline.steamId,
    baseline,
    itemId: baseline.items[0].id,
    protectedIds: [],
  };
  const result = simulateInventoryDelete(baseline, request);
  if (!result.snapshot) throw Error("Missing fixture deletion snapshot");
  const malformed = [
    { ...result, status: "partial" as const },
    { ...result, deletedIds: [baseline.items[1].id] },
    { ...result, snapshot: { ...result.snapshot, steamId: "foreign" } },
    {
      ...result,
      snapshot: {
        ...result.snapshot,
        items: result.snapshot.items.map((item, index) =>
          index === 0 ? { ...item, position: 100 } : item,
        ),
      },
    },
  ];
  for (const response of malformed)
    expect(verifyInventoryDeleteResult(baseline, request, response)).toMatchObject({
      status: "unknown",
      snapshot: null,
      deletedIds: [],
    });
});
it("simulator tokens are single use and stale prepares cannot delete after another operation", async () => {
  const api = createInventorySimulation();
  const baseline = await api.getInventory();
  const request = {
    kind: "delete" as const,
    steamId: baseline.steamId,
    baseline,
    itemId: baseline.items[0].id,
    protectedIds: [],
  };
  const first = await api.prepareInventoryOperation(request);
  const second = await api.prepareInventoryOperation({ ...request, itemId: baseline.items[1].id });
  expect((await api.executeInventoryOperation(first.token)).status).toBe("simulated");
  await expect(api.executeInventoryOperation(first.token)).rejects.toThrow("already used");
  await expect(api.executeInventoryOperation(second.token)).rejects.toThrow("changed");
  expect((await api.getInventory()).items.some((item) => item.id === baseline.items[1].id)).toBe(
    true,
  );
});
