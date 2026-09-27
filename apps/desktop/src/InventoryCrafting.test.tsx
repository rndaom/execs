// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { InventoryCrafting } from "./InventoryCrafting";
import type { InventorySnapshot } from "./lib/bridge";
import {
  type InventoryCraftRequest,
  type InventoryCraftResult,
  simulateInventoryCraft,
} from "./lib/inventory-crafting";
import { createInventorySimulation } from "./lib/inventory-simulation";

afterEach(() => vi.unstubAllGlobals());

it("uses a native review token for live crafting and accepts only a verified confirmed result", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const simulation = createInventorySimulation();
  const snapshot = await simulation.getInventory();
  const selectedIds = snapshot.items
    .filter((item) => item.definition === 5000)
    .slice(0, 3)
    .map((item) => item.id);
  const api = {
    craftInventory: vi.fn(simulation.craftInventory),
    prepareInventoryOperation: vi.fn(simulation.prepareInventoryOperation),
    executeInventoryOperation: vi.fn(async (token: string) => ({
      ...(await simulation.executeInventoryOperation(token)),
      status: "confirmed" as const,
    })),
  };
  const onResult = vi.fn();
  const box = document.createElement("div");
  const root = createRoot(box);
  try {
    await act(async () =>
      root.render(
        <InventoryCrafting
          snapshot={snapshot}
          selectedIds={selectedIds}
          protectedIds={new Set()}
          capability="live"
          api={api}
          onResult={onResult}
        />,
      ),
    );
    expect(api.prepareInventoryOperation).not.toHaveBeenCalled();
    const button = box.querySelector("button");
    expect(button?.textContent).toBe("Craft items permanently");
    await act(async () => button?.click());
    expect(api.prepareInventoryOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "craft",
        baseline: snapshot,
        inputIds: selectedIds,
        recipe: "combine_scrap",
      }),
    );
    expect(api.executeInventoryOperation).toHaveBeenCalledTimes(1);
    expect(api.craftInventory).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: "confirmed", consumedIds: selectedIds }),
      "combine_scrap",
    );
  } finally {
    await act(async () => root.unmount());
  }
});

function fixture(): InventorySnapshot {
  const items = ["9007199254740993", "9007199254740994", "9007199254740995"].map((id, index) => ({
    id,
    definition: 5000,
    position: index === 2 ? 51 : index + 1,
    quality: 6,
    level: 1,
    customName: null,
  }));
  return {
    steamId: "76561198000000000",
    capacity: 100,
    warning: null,
    items,
    definitions: {
      "5000": { name: "Scrap Metal", kind: "Crafting Item", classes: [], icon: null },
    },
    craftingEligibility: Object.fromEntries(
      items.map((item) => [item.id, { craftable: true, tradable: true, customized: false }]),
    ),
  };
}

async function harness() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const snapshot = fixture();
  const craftInventory = vi.fn(async (request: InventoryCraftRequest) =>
    simulateInventoryCraft(snapshot, request),
  );
  const onResult = vi.fn();
  const onBusyChange = vi.fn();
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  let props = {
    snapshot,
    selectedIds: snapshot.items.map((item) => item.id),
    protectedIds: new Set<string>(),
    capability: "simulation" as "simulation" | "unavailable",
    disabled: false,
    api: { craftInventory },
    onResult,
    onBusyChange,
  };
  async function render(change: Partial<typeof props> = {}) {
    props = { ...props, ...change };
    await act(async () => root.render(<InventoryCrafting {...props} />));
  }
  function button(label: string) {
    const button = [...box.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === label,
    );
    if (!button) throw new Error(`Missing button: ${label}`);
    return button;
  }
  async function click(label: string) {
    await act(async () => button(label).click());
  }
  async function close() {
    await act(async () => root.unmount());
    box.remove();
  }
  async function hide() {
    await act(async () => root.render(null));
  }
  await render();
  return {
    snapshot,
    box,
    render,
    button,
    click,
    close,
    hide,
    craftInventory,
    onResult,
    onBusyChange,
  };
}

it("shows every exact off-page ingredient by slot and closing sends nothing", async () => {
  const h = await harness();
  try {
    const list = h.box.querySelector('[aria-label="Exact crafting ingredients"]');
    expect(list?.children).toHaveLength(3);
    // Item numbers are not something a player reads; slots are.
    for (const item of h.snapshot.items) expect(list?.textContent).not.toContain(item.id);
    expect(list?.textContent).toContain("Scrap Metal");
    expect(list?.textContent).toContain("Slot 51");
    expect(h.box.textContent).toContain("no Undo");
    expect(h.box.querySelector('[role="dialog"]')).toBeNull();
    expect([...h.box.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "Simulate craft",
    ]);

    await h.hide();
    expect(h.craftInventory).not.toHaveBeenCalled();
  } finally {
    await h.close();
  }
});

it("derives the output from selected metals and offers a choice only when there is one", async () => {
  const h = await harness();
  try {
    expect(h.box.querySelector("fieldset")).toBeNull();
    expect(h.box.textContent).toContain("3 Scrap Metal → 1 Reclaimed Metal");
    const refined = structuredClone(h.snapshot);
    refined.items[0].definition = 5002;
    await h.hide();
    await h.render({ snapshot: refined, selectedIds: [refined.items[0].id] });
    expect(h.box.querySelector("fieldset")).toBeNull();
    expect(h.box.textContent).toContain("1 Refined Metal → 3 Reclaimed Metal");

    await h.hide();
    await h.render({ selectedIds: refined.items.map((item) => item.id) });
    expect(h.button("Simulate craft").disabled).toBe(true);
    expect(h.box.textContent).toContain("Select Scrap, Reclaimed or Refined Metal of one kind.");

    // Three refined metal can be a random hat or three smelts; the hat comes first.
    const allRefined = structuredClone(h.snapshot);
    for (const item of allRefined.items) item.definition = 5002;
    await h.hide();
    await h.render({ snapshot: allRefined, selectedIds: allRefined.items.map((item) => item.id) });
    const choices = [...h.box.querySelectorAll("fieldset label")].map((label) => label.textContent);
    expect(choices).toEqual(["Random hat", "Smelt"]);
    expect(h.box.textContent).toContain("3 Refined Metal → 1 random hat");
    expect(h.box.textContent).toContain("premium TF2 account");
  } finally {
    await h.close();
  }
});

it("runs a batch of crafts one after another from each confirmed backpack", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const simulation = createInventorySimulation();
  const snapshot = await simulation.getInventory();
  const scrap = snapshot.items.filter((item) => item.definition === 5000).map((item) => item.id);
  expect(scrap).toHaveLength(9);
  const api = { craftInventory: vi.fn(simulation.craftInventory) };
  const onResult = vi.fn();
  const box = document.createElement("div");
  const root = createRoot(box);
  try {
    await act(async () =>
      root.render(
        <InventoryCrafting
          snapshot={snapshot}
          selectedIds={scrap.slice(0, 8)}
          protectedIds={new Set()}
          capability="simulation"
          api={api}
          onResult={onResult}
        />,
      ),
    );
    expect(box.textContent).toContain("6 Scrap Metal → 2 Reclaimed Metal");
    expect(box.textContent).toContain("2 crafts, one after another.");
    expect(box.textContent).toContain("2 Scrap Metal stay in your backpack.");
    const run = [...box.querySelectorAll("button")].find(
      (button) => button.textContent === "Simulate 2 crafts",
    );
    await act(async () => run?.click());
    expect(api.craftInventory).toHaveBeenCalledTimes(2);
    // The second craft starts from the backpack the first one produced.
    expect(api.craftInventory.mock.calls[1][0].baseline).not.toBe(
      api.craftInventory.mock.calls[0][0].baseline,
    );
    const [result, recipe] = onResult.mock.calls[0];
    expect(recipe).toBe("combine_scrap");
    expect(result.status).toBe("simulated");
    expect(result.consumedIds).toHaveLength(6);
    expect(result.acquiredIds).toHaveLength(2);
    expect(result.message).toContain("Simulated 2 crafts: 2 Reclaimed Metal.");
  } finally {
    await act(async () => root.unmount());
  }
});

it("submits once during a delayed result and publishes only verified simulated completion", async () => {
  const h = await harness();
  try {
    let finish: ((result: InventoryCraftResult) => void) | undefined;
    let sent: InventoryCraftRequest | undefined;
    h.craftInventory.mockImplementationOnce((request) => {
      sent = request;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });

    const confirm = h.button("Simulate craft");
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(h.craftInventory).toHaveBeenCalledTimes(1);
    expect(h.button("Crafting…").disabled).toBe(true);
    expect(h.box.textContent).toContain("Waiting for the crafting result");
    if (!sent || !finish) throw new Error("Craft did not start");
    const result = simulateInventoryCraft(h.snapshot, sent);
    await act(async () => finish?.(result));
    expect(h.onResult).toHaveBeenCalledWith(result, "combine_scrap");
    expect(h.onBusyChange.mock.calls).toEqual([[true], [false]]);
    expect(h.box.textContent).toContain("Steam items were not changed");
  } finally {
    await h.close();
  }
});

it("invalidates a review when protection, selection or game lock changes", async () => {
  const h = await harness();
  try {
    await h.render({ protectedIds: new Set([h.snapshot.items[0].id]) });
    expect(h.button("Simulate craft").disabled).toBe(true);
    expect(h.box.textContent).toContain("protection changed");
    await h.hide();
    await h.render({ protectedIds: new Set() });

    await h.render({ disabled: true });
    expect(h.button("Simulate craft").disabled).toBe(true);
    await h.hide();
    await h.render({ disabled: false });

    await h.render({ selectedIds: h.snapshot.items.slice(0, 2).map((item) => item.id) });
    expect(h.button("Simulate craft").disabled).toBe(true);
    expect(h.craftInventory).not.toHaveBeenCalled();
  } finally {
    await h.close();
  }
});

it("locks an ambiguous outcome instead of offering a blind retry", async () => {
  const h = await harness();
  try {
    h.craftInventory.mockRejectedValueOnce(new Error("connection lost"));

    await h.click("Simulate craft");
    expect(h.onResult.mock.calls[0][0].status).toBe("unknown");
    expect(h.box.querySelector('[role="alert"]')?.textContent).toContain("do not repeat");
    expect(h.button("Simulate craft").disabled).toBe(true);
    expect(h.craftInventory).toHaveBeenCalledTimes(1);
  } finally {
    await h.close();
  }
});

it("blocks native capability and removes a review after account changes", async () => {
  const h = await harness();
  try {
    await h.render({ capability: "unavailable" });
    expect(h.button("Simulate craft").disabled).toBe(true);
    await h.render({ capability: "simulation" });
    await h.hide();
    await h.render();

    await h.render({ snapshot: { ...h.snapshot, steamId: "76561198000000001" } });
    expect(h.box.querySelector('[aria-label="Exact crafting ingredients"]')).toBeNull();
    expect(h.button("Simulate craft").disabled).toBe(true);
    expect(h.craftInventory).not.toHaveBeenCalled();
  } finally {
    await h.close();
  }
});

it("keeps unknown outcomes blocked through tab remount and account round trips", async () => {
  const h = await harness();
  try {
    h.craftInventory.mockRejectedValueOnce(new Error("lost result"));

    await h.click("Simulate craft");
    await h.hide();
    await h.render();
    expect(h.button("Simulate craft").disabled).toBe(true);
    await h.render({ snapshot: { ...h.snapshot, steamId: "different-account" } });
    await h.hide();
    await h.render();
    expect(h.button("Simulate craft").disabled).toBe(false);
    await h.render({ snapshot: h.snapshot });
    await h.hide();
    await h.render();
    expect(h.button("Simulate craft").disabled).toBe(true);
    expect(h.box.textContent).toContain("do not repeat");
  } finally {
    await h.close();
  }
});

it.each(["account", "api", "unmount"] as const)(
  "ignores deferred results after %s changes",
  async (change) => {
    const h = await harness();
    try {
      let finish: ((result: InventoryCraftResult) => void) | undefined;
      let sent: InventoryCraftRequest | undefined;
      h.craftInventory.mockImplementationOnce((request) => {
        sent = request;
        return new Promise((resolve) => {
          finish = resolve;
        });
      });

      await h.click("Simulate craft");
      if (change === "account")
        await h.render({ snapshot: { ...h.snapshot, steamId: "other-account" } });
      if (change === "api")
        await h.render({
          api: {
            craftInventory: vi.fn(async (request: InventoryCraftRequest) =>
              simulateInventoryCraft(h.snapshot, request),
            ),
          },
        });
      if (change === "unmount") await h.hide();
      if (!sent || !finish) throw new Error("Craft did not start");
      const result = simulateInventoryCraft(h.snapshot, sent);
      await act(async () => finish?.(result));
      expect(h.onResult).not.toHaveBeenCalled();
      expect(h.onBusyChange.mock.calls).toEqual([[true], [false]]);
    } finally {
      await h.close();
    }
  },
);

it("invalidates open confirmation after renaming an ingredient or replacing the API", async () => {
  const h = await harness();
  try {
    const changed = structuredClone(h.snapshot);
    changed.items[0].customName = "Keep this metal";
    await h.render({ snapshot: changed });
    expect(h.button("Simulate craft").disabled).toBe(true);
    await h.hide();
    await h.render({ snapshot: h.snapshot });

    const otherApi = {
      craftInventory: vi.fn(async (request: InventoryCraftRequest) =>
        simulateInventoryCraft(h.snapshot, request),
      ),
    };
    await h.render({ api: otherApi });
    expect(h.box.querySelector('[aria-label="Exact crafting ingredients"]')).toBeNull();
    expect(h.button("Simulate craft").disabled).toBe(true);
    expect(otherApi.craftInventory).not.toHaveBeenCalled();
    expect(h.craftInventory).not.toHaveBeenCalled();
  } finally {
    await h.close();
  }
});
