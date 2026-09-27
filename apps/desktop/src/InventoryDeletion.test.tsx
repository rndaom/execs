// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { InventoryDeletion } from "./InventoryDeletion";
import type { InventoryPreparedOperation } from "./lib/bridge";
import { createInventorySimulation } from "./lib/inventory-simulation";

afterEach(() => vi.unstubAllGlobals());

it("requires explicit one-item confirmation and routes live mode through prepare and execute", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const simulation = createInventorySimulation();
  const snapshot = await simulation.getInventory();
  const api = {
    prepareInventoryOperation: vi.fn(simulation.prepareInventoryOperation),
    executeInventoryOperation: vi.fn(async (token: string) => ({
      ...(await simulation.executeInventoryOperation(token)),
      status: "confirmed" as const,
    })),
  };
  const onResult = vi.fn();
  const onBusyChange = vi.fn();
  const box = document.createElement("div");
  const root = createRoot(box);
  try {
    await act(async () =>
      root.render(
        <InventoryDeletion
          snapshot={snapshot}
          selectedIds={[snapshot.items[0].id]}
          protectedIds={new Set()}
          capability="live"
          api={api}
          onResult={onResult}
          onBusyChange={onBusyChange}
        />,
      ),
    );
    expect(box.textContent).toContain("Deletion cannot be undone");
    expect(box.textContent).toContain(snapshot.items[0].id);
    expect(api.prepareInventoryOperation).not.toHaveBeenCalled();
    const button = box.querySelector("button");
    await act(async () => {
      button?.click();
      button?.click();
    });
    expect(api.prepareInventoryOperation).toHaveBeenCalledTimes(1);
    expect(api.prepareInventoryOperation).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "delete", itemId: snapshot.items[0].id, baseline: snapshot }),
    );
    expect(api.executeInventoryOperation).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: "confirmed", deletedIds: [snapshot.items[0].id] }),
    );
    expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
  } finally {
    await act(async () => root.unmount());
  }
});

it("blocks protected, multi-selected and changed-account deletions before preparing", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const simulation = createInventorySimulation();
  const snapshot = await simulation.getInventory();
  const api = {
    prepareInventoryOperation: vi.fn(simulation.prepareInventoryOperation),
    executeInventoryOperation: vi.fn(simulation.executeInventoryOperation),
  };
  const box = document.createElement("div");
  const root = createRoot(box);
  const props = {
    snapshot,
    selectedIds: [snapshot.items[0].id],
    protectedIds: new Set([snapshot.items[0].id]),
    capability: "simulation" as const,
    api,
    onResult: vi.fn(),
    onBusyChange: vi.fn(),
  };
  try {
    await act(async () => root.render(<InventoryDeletion {...props} />));
    expect(box.querySelector("button")?.disabled).toBe(true);
    expect(box.textContent).toContain("Unfavorite and unprotect");
    await act(async () =>
      root.render(
        <InventoryDeletion
          {...props}
          selectedIds={snapshot.items.slice(0, 2).map((item) => item.id)}
        />,
      ),
    );
    expect(box.querySelector("button")?.disabled).toBe(true);
    await act(async () =>
      root.render(
        <InventoryDeletion {...props} snapshot={{ ...snapshot, steamId: "another-account" }} />,
      ),
    );
    expect(box.querySelector("button")?.disabled).toBe(true);
    expect(api.prepareInventoryOperation).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});

it("does not execute a late preparation after the account changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const simulation = createInventorySimulation();
  const snapshot = await simulation.getInventory();
  let resolve: (prepared: InventoryPreparedOperation) => void = () => {};
  const prepared = new Promise<InventoryPreparedOperation>((done) => {
    resolve = done;
  });
  const api = {
    prepareInventoryOperation: vi.fn().mockReturnValue(prepared),
    executeInventoryOperation: vi.fn(simulation.executeInventoryOperation),
  };
  const props = {
    snapshot,
    selectedIds: [snapshot.items[0].id],
    protectedIds: new Set<string>(),
    capability: "live" as const,
    api,
    onResult: vi.fn(),
    onBusyChange: vi.fn(),
  };
  const box = document.createElement("div");
  const root = createRoot(box);
  try {
    await act(async () => root.render(<InventoryDeletion {...props} />));
    await act(async () => box.querySelector("button")?.click());
    await act(async () =>
      root.render(
        <InventoryDeletion {...props} snapshot={{ ...snapshot, steamId: "changed-account" }} />,
      ),
    );
    await act(async () =>
      resolve({
        token: "old-account-token",
        kind: "delete",
        steamId: snapshot.steamId,
        expiresAt: Date.now() + 120_000,
        summary: "Old account",
      }),
    );
    expect(api.executeInventoryOperation).not.toHaveBeenCalled();
    expect(props.onResult).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});
