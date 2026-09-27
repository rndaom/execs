// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InventoryPane } from "./InventoryPane";
import type { Api } from "./lib/api";
import { createInventorySimulation } from "./lib/inventory-simulation";
import { createPreviewApi } from "./lib/preview-bridge";

const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);
const scrollIntoView = vi.fn();
function element<T extends HTMLElement>(box: HTMLElement, selector: string): T {
  const found = box.querySelector<T>(selector);
  if (!found) throw Error(`Missing ${selector}`);
  return found;
}
async function clickButton(box: HTMLElement, name: string) {
  const found = [...box.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === name || button.getAttribute("aria-label") === name,
  );
  if (!found) throw Error(`Missing button ${name}`);
  await act(async () => found.click());
}
async function sortBackpack(box: HTMLElement, value: string) {
  await act(async () => {
    const select = element<HTMLSelectElement>(box, "#inventory-sort");
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function dragTransfer() {
  return {
    effectAllowed: "none",
    dropEffect: "none",
    setData: vi.fn(),
    getData: vi.fn().mockReturnValue("draft"),
  };
}
async function dispatchDrag(target: HTMLElement, type: string, transfer = dragTransfer()) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  await act(async () => target.dispatchEvent(event));
  return event;
}
async function fixtureInteraction(
  run: (context: {
    box: HTMLDivElement;
    api: Api;
    root: ReturnType<typeof createRoot>;
  }) => Promise<void>,
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const api = createPreviewApi("settings-inventory");
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  try {
    await act(async () =>
      root.render(<InventoryPane api={api} active running={false} busy={false} />),
    );
    await run({ box, api, root });
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
}
beforeEach(() => {
  scrollIntoView.mockClear();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
});
afterEach(() => {
  localStorage.clear();
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
});

it("drags the complete selected group onto empty slots without applying or exporting item IDs", async () => {
  await fixtureInteraction(async ({ box, api }) => {
    const apply = vi.spyOn(api, "applyInventoryLayout");
    const first = element<HTMLButtonElement>(box, '[aria-label="Scattergun, Unique, slot 1"]');
    const second = element<HTMLButtonElement>(
      box,
      '[aria-label="Skull Cracked War Paint, Decorated, slot 2"]',
    );
    await act(async () => first.click());
    await act(async () =>
      second.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true })),
    );
    expect(first.draggable).toBe(true);
    const transfer = dragTransfer();
    await dispatchDrag(first, "dragstart", transfer);
    const target = element<HTMLButtonElement>(box, '[aria-label="Empty slot 11"]');
    expect((await dispatchDrag(target, "dragover", transfer)).defaultPrevented).toBe(true);
    await dispatchDrag(target, "drop", transfer);
    expect(
      element(box, '[aria-label="Scattergun, Unique, slot 11"]').getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      element(box, '[aria-label="Skull Cracked War Paint, Decorated, slot 12"]').getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(transfer.setData).toHaveBeenCalledExactlyOnceWith(
      "application/x-execs-inventory",
      "draft",
    );
    expect(apply).not.toHaveBeenCalled();
    expect(
      (await api.getInventory()).items.find((item) => item.definition === 17286)?.position,
    ).toBe(2);
    await clickButton(box, "Undo draft");
    expect(element(box, '[aria-label="Scattergun, Unique, slot 1"]')).toBeTruthy();
    expect(element(box, '[aria-label="Skull Cracked War Paint, Decorated, slot 2"]')).toBeTruthy();
  });
});

it.each(["name", "quality", "type"])(
  "sorts by %s into real slots, then drags and applies those exact positions",
  async (order) => {
    await fixtureInteraction(async ({ box, api }) => {
      const before = await api.getInventory();
      const apply = vi.spyOn(api, "applyInventoryLayout");
      const prepare = vi.spyOn(api, "prepareInventoryOperation");
      await sortBackpack(box, order);
      expect(box.querySelectorAll('[aria-label="Backpack items"] > button')).toHaveLength(50);
      expect(element<HTMLInputElement>(box, '[aria-label="Backpack page"]').value).toBe("1");
      expect(box.textContent).toContain("Backpack sorted in the draft");
      expect((await api.getInventory()).items).toEqual(before.items);
      await clickButton(box, "Undo draft");
      expect(element(box, '[aria-label="Scattergun, Unique, slot 1"]')).toBeTruthy();
      await clickButton(box, "Redo draft");
      const source = element<HTMLButtonElement>(box, '[aria-label="Backpack items"] > button');
      const name = source.getAttribute("aria-label")?.replace(/, slot \d+$/, "");
      const transfer = dragTransfer();
      await dispatchDrag(source, "dragstart", transfer);
      await dispatchDrag(element(box, '[aria-label="Empty slot 40"]'), "drop", transfer);
      expect(element(box, `[aria-label="${name}, slot 40"]`)).toBeTruthy();
      const expected = [
        ...box.querySelectorAll<HTMLButtonElement>(
          '[aria-label="Backpack items"] > button[draggable="true"]',
        ),
      ].map((button) => button.getAttribute("aria-label"));
      const review = [...box.querySelectorAll("button")].find((button) =>
        /^Review \d+ changes$/.test(button.textContent?.trim() ?? ""),
      );
      expect(review).toBeTruthy();
      await act(async () => review?.click());
      expect(prepare).not.toHaveBeenCalled();
      expect(apply).not.toHaveBeenCalled();
      await clickButton(box, "Apply simulation");
      const after = await api.getInventory();
      expect(after.items).not.toEqual(before.items);
      expect(
        [
          ...box.querySelectorAll<HTMLButtonElement>(
            '[aria-label="Backpack items"] > button[draggable="true"]',
          ),
        ].map((button) => button.getAttribute("aria-label")),
      ).toEqual(expected);
      expect(after.items.some((item) => item.position === 40)).toBe(true);
      expect(element<HTMLButtonElement>(box, '[aria-label="Undo draft"]').disabled).toBe(true);
    });
  },
);

it("disables sorting during TF2 and prevents dragging compressed filter results", async () => {
  await fixtureInteraction(async ({ box, api, root }) => {
    await act(async () => root.render(<InventoryPane api={api} active running busy={false} />));
    expect(element<HTMLSelectElement>(box, "#inventory-sort").disabled).toBe(true);
    await act(async () =>
      root.render(<InventoryPane api={api} active running={false} busy={false} />),
    );
    await act(async () => {
      const select = element<HTMLSelectElement>(box, "#inventory-quality");
      select.value = "6";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const source = element<HTMLButtonElement>(box, '[aria-label="Scattergun, Unique, slot 1"]');
    expect(source.draggable).toBe(false);
    expect((await dispatchDrag(source, "dragstart")).defaultPrevented).toBe(true);
    await sortBackpack(box, "type");
    expect(element<HTMLSelectElement>(box, "#inventory-quality").value).toBe("all");
    expect(box.querySelectorAll('[aria-label="Backpack items"] > button')).toHaveLength(50);
    expect(
      box.querySelector('[aria-label="Backpack items"] > button[draggable="true"]'),
    ).toBeTruthy();
  });
});

it("reviews one-item deletion, cancels without sending, and records only the confirmed simulation", async () => {
  await fixtureInteraction(async ({ box, api }) => {
    const prepare = vi.spyOn(api, "prepareInventoryOperation");
    const execute = vi.spyOn(api, "executeInventoryOperation");
    const before = await api.getInventory();
    await clickButton(box, "Scattergun, Unique, slot 1");
    await clickButton(box, "Delete selected");
    expect(box.textContent).toContain("Permanently delete this one item");
    expect(document.activeElement?.textContent).toBe("Cancel");
    await clickButton(box, "Cancel");
    expect(prepare).not.toHaveBeenCalled();
    await clickButton(box, "Delete selected");
    await clickButton(box, "Simulate deletion");
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await api.getInventory()).items).toHaveLength(before.items.length - 1);
    expect(box.querySelector('[aria-label="Scattergun, Unique, slot 1"]')).toBeNull();
    expect(box.textContent).toContain("Deleted the selected fixture item");
    expect(box.textContent).toContain("Delete");
  });
});

it("clears a native pending operation after reconciliation despite an optional metadata warning", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const api = createPreviewApi("settings-inventory");
  const snapshot = await api.getInventory();
  api.getInventoryCapabilities = vi
    .fn()
    .mockResolvedValue({ organizer: "live", crafting: "live", deletion: "live", reason: null });
  api.getInventory = vi.fn().mockResolvedValue({
    ...snapshot,
    pendingOperation: { operationId: "pending", kind: "layout", message: "Unconfirmed" },
  });
  api.reconcileInventoryOperation = vi.fn().mockResolvedValue({
    operationId: "pending",
    kind: "layout",
    status: "confirmed",
    snapshot: { ...snapshot, warning: "Optional artwork is unavailable", pendingOperation: null },
    message: "Confirmed after reconnect",
    consumedIds: [],
    acquiredIds: [],
    deletedIds: [],
  });
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  try {
    await act(async () =>
      root.render(<InventoryPane api={api} active running={false} busy={false} />),
    );
    expect(box.textContent).toContain("An operation has an unconfirmed outcome");
    await clickButton(box, "Refresh and discard old plan");
    expect(api.reconcileInventoryOperation).toHaveBeenCalledWith(snapshot.steamId);
    expect(box.textContent).not.toContain("An operation has an unconfirmed outcome");
    expect(box.textContent).toContain("Optional artwork is unavailable");
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("ignores external drops and cancels an internal drag when TF2 starts", async () => {
  await fixtureInteraction(async ({ box, api, root }) => {
    const apply = vi.spyOn(api, "applyInventoryLayout");
    const target = element<HTMLButtonElement>(box, '[aria-label="Empty slot 11"]');
    expect((await dispatchDrag(target, "dragover")).defaultPrevented).toBe(false);
    await dispatchDrag(target, "drop");
    expect(element<HTMLButtonElement>(box, '[aria-label="Undo draft"]').disabled).toBe(true);
    const source = element<HTMLButtonElement>(box, '[aria-label="Scattergun, Unique, slot 1"]');
    const transfer = dragTransfer();
    await dispatchDrag(source, "dragstart", transfer);
    await act(async () => root.render(<InventoryPane api={api} active running busy={false} />));
    expect(source.draggable).toBe(false);
    expect((await dispatchDrag(target, "dragover", transfer)).defaultPrevented).toBe(false);
    await dispatchDrag(target, "drop", transfer);
    expect(element(box, '[aria-label="Scattergun, Unique, slot 1"]')).toBeTruthy();
    expect(apply).not.toHaveBeenCalled();
  });
});

it("refuses protected drag sources and unplaced drops on occupied slots", async () => {
  await fixtureInteraction(async ({ box }) => {
    const source = element<HTMLButtonElement>(box, '[aria-label="Scattergun, Unique, slot 1"]');
    await act(async () => source.click());
    await clickButton(box, "Protect selected");
    expect(source.draggable).toBe(false);
    expect((await dispatchDrag(source, "dragstart")).defaultPrevented).toBe(true);
    const unplaced = element<HTMLButtonElement>(
      box,
      '[aria-label="Refined Metal, Unique, unplaced"]',
    );
    const transfer = dragTransfer();
    await dispatchDrag(unplaced, "dragstart", transfer);
    await dispatchDrag(
      element(box, '[aria-label="Skull Cracked War Paint, Decorated, slot 2"]'),
      "drop",
      transfer,
    );
    expect(box.textContent).toContain("An unplaced item needs an empty destination slot");
    expect(element(box, '[aria-label="Refined Metal, Unique, unplaced"]')).toBeTruthy();
    expect(element<HTMLButtonElement>(box, '[aria-label="Undo draft"]').disabled).toBe(true);
  });
});

it("navigates ten-column rows by keyboard, changes pages and clears selection", async () => {
  await fixtureInteraction(async ({ box }) => {
    const source = element<HTMLButtonElement>(box, '[aria-label="Scattergun, Unique, slot 1"]');
    await act(async () => {
      source.click();
      source.focus();
    });
    async function key(value: string) {
      await act(async () =>
        document.activeElement?.dispatchEvent(
          new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }),
        ),
      );
    }
    await key("ArrowDown");
    expect(document.activeElement).toBe(element(box, '[aria-label="Empty slot 11"]'));
    await key("ArrowRight");
    expect(document.activeElement).toBe(element(box, '[aria-label="Empty slot 12"]'));
    await key("ArrowUp");
    expect(document.activeElement).toBe(
      element(box, '[aria-label="Skull Cracked War Paint, Decorated, slot 2"]'),
    );
    await key("PageUp");
    expect(element<HTMLInputElement>(box, '[aria-label="Backpack page"]').value).toBe("6");
    expect(document.activeElement).toBe(element(box, '[aria-label="Empty slot 252"]'));
    await key("PageDown");
    expect(element<HTMLInputElement>(box, '[aria-label="Backpack page"]').value).toBe("1");
    expect(document.activeElement).toBe(
      element(box, '[aria-label="Skull Cracked War Paint, Decorated, slot 2"]'),
    );
    await key("Escape");
    expect(
      element(box, '[aria-label="Scattergun, Unique, slot 1"]').getAttribute("aria-pressed"),
    ).toBe("false");
    await key("PageDown");
    expect(element<HTMLInputElement>(box, '[aria-label="Backpack page"]').value).toBe("2");
    expect(document.activeElement).toBe(element(box, '[aria-label="Empty slot 52"]'));
    expect(box.querySelectorAll('[aria-label="Backpack items"] > button')).toHaveLength(50);
    await key("PageUp");
    expect(element<HTMLInputElement>(box, '[aria-label="Backpack page"]').value).toBe("1");
    expect(document.activeElement).toBe(
      element(box, '[aria-label="Skull Cracked War Paint, Decorated, slot 2"]'),
    );
  });
});

it("wraps the page buttons between the first and last backpack pages", async () => {
  await fixtureInteraction(async ({ box }) => {
    expect(element<HTMLInputElement>(box, '[aria-label="Backpack page"]').value).toBe("1");
    await clickButton(box, "Previous page");
    expect(element<HTMLInputElement>(box, '[aria-label="Backpack page"]').value).toBe("6");
    expect(element(box, '[aria-label="Empty slot 300"]')).toBeTruthy();
    await clickButton(box, "Next page");
    expect(element<HTMLInputElement>(box, '[aria-label="Backpack page"]').value).toBe("1");
    expect(element(box, '[aria-label="Scattergun, Unique, slot 1"]')).toBeTruthy();
  });
});

it("keeps turning pages during one held drag and preserves the source for a cross-page drop", async () => {
  await fixtureInteraction(async ({ box, api }) => {
    vi.useFakeTimers();
    const transfer = dragTransfer();
    const source = element(box, '[aria-label="Scattergun, Unique, slot 1"]');
    await dispatchDrag(source, "dragstart", transfer);
    scrollIntoView.mockClear();
    const next = element<HTMLButtonElement>(box, '[aria-label="Next page"]');
    expect((await dispatchDrag(next, "dragover", transfer)).defaultPrevented).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(649));
    expect(element<HTMLInputElement>(box, '[aria-label="Backpack page"]').value).toBe("1");
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(element<HTMLInputElement>(box, '[aria-label="Backpack page"]').value).toBe("2");
    for (const page of [3, 4]) {
      await act(async () => vi.advanceTimersByTimeAsync(650));
      expect(element<HTMLInputElement>(box, '[aria-label="Backpack page"]').value).toBe(
        String(page),
      );
      expect(source.isConnected).toBe(true);
      expect(element(box, "[data-inventory-drag-source]")).toBe(source);
      expect(source.tabIndex).toBe(-1);
      expect(source.getAttribute("aria-hidden")).toBe("true");
    }
    expect(scrollIntoView).not.toHaveBeenCalled();
    await dispatchDrag(next, "dragleave", transfer);
    await act(async () => vi.advanceTimersByTimeAsync(1300));
    expect(element<HTMLInputElement>(box, '[aria-label="Backpack page"]').value).toBe("4");
    await dispatchDrag(element(box, '[aria-label="Empty slot 152"]'), "drop", transfer);
    expect(box.querySelector("[data-inventory-drag-source]")).toBeNull();
    expect(
      element(box, '[aria-label="Scattergun, Unique, slot 152"]').getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      (await api.getInventory()).items.find((item) => item.definition === 13 && item.quality === 6)
        ?.position,
    ).toBe(1);
    expect(element<HTMLButtonElement>(box, '[aria-label="Undo draft"]').disabled).toBe(false);
  });
});

it("carries a selected group through repeated backward paging, wrapping and reversing direction", async () => {
  await fixtureInteraction(async ({ box, api }) => {
    vi.useFakeTimers();
    const apply = vi.spyOn(api, "applyInventoryLayout");
    const source = element(box, '[aria-label="Scattergun, Unique, slot 1"]');
    await act(async () => source.click());
    await act(async () =>
      element(box, '[aria-label="Skull Cracked War Paint, Decorated, slot 2"]').dispatchEvent(
        new MouseEvent("click", { bubbles: true, ctrlKey: true }),
      ),
    );
    const transfer = dragTransfer();
    await dispatchDrag(source, "dragstart", transfer);
    await dispatchDrag(element(box, '[aria-label="Previous page"]'), "dragover", transfer);
    for (const page of [6, 5]) {
      await act(async () => vi.advanceTimersByTimeAsync(650));
      expect(element<HTMLInputElement>(box, '[aria-label="Backpack page"]').value).toBe(
        String(page),
      );
    }
    await dispatchDrag(element(box, '[aria-label="Next page"]'), "dragover", transfer);
    for (const page of [6, 1, 2]) {
      await act(async () => vi.advanceTimersByTimeAsync(650));
      expect(element<HTMLInputElement>(box, '[aria-label="Backpack page"]').value).toBe(
        String(page),
      );
      expect(source.isConnected).toBe(true);
    }
    const target = element(box, '[aria-label="Empty slot 52"]');
    await dispatchDrag(target, "dragover", transfer);
    await act(async () => vi.advanceTimersByTimeAsync(1300));
    expect(element<HTMLInputElement>(box, '[aria-label="Backpack page"]').value).toBe("2");
    await dispatchDrag(target, "drop", transfer);
    for (const name of [
      "Scattergun, Unique, slot 52",
      "Skull Cracked War Paint, Decorated, slot 53",
    ]) {
      expect(element(box, `[aria-label="${name}"]`).getAttribute("aria-pressed")).toBe("true");
    }
    expect(apply).not.toHaveBeenCalled();
    expect(box.querySelector("[data-inventory-drag-source]")).toBeNull();
  });
});

it.each(["dragend", "drop"])("stops held-arrow paging on %s without moving items", async (type) => {
  await fixtureInteraction(async ({ box }) => {
    vi.useFakeTimers();
    const source = element(box, '[aria-label="Scattergun, Unique, slot 1"]');
    const next = element(box, '[aria-label="Next page"]');
    const transfer = dragTransfer();
    await dispatchDrag(source, "dragstart", transfer);
    await dispatchDrag(next, "dragover", transfer);
    await act(async () => vi.advanceTimersByTimeAsync(650));
    expect(source.isConnected).toBe(true);
    await dispatchDrag(type === "dragend" ? source : next, type, transfer);
    await act(async () => vi.advanceTimersByTimeAsync(1300));
    expect(element<HTMLInputElement>(box, '[aria-label="Backpack page"]').value).toBe("2");
    expect(box.querySelector("[data-inventory-drag-source]")).toBeNull();
    await clickButton(box, "Previous page");
    expect(element(box, '[aria-label="Scattergun, Unique, slot 1"]')).toBeTruthy();
    expect(element<HTMLButtonElement>(box, '[aria-label="Undo draft"]').disabled).toBe(true);
  });
});

it("crafts the three exact selected scrap items through the complete preview API", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const api = createPreviewApi("settings-inventory");
  const before = await api.getInventory();
  const craft = vi.spyOn(api, "craftInventory");
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  const button = (name: string) =>
    [...box.querySelectorAll("button")].find(
      (entry) => entry.textContent?.trim() === name || entry.getAttribute("aria-label") === name,
    );
  try {
    await act(async () =>
      root.render(<InventoryPane api={api} active running={false} busy={false} />),
    );
    for (const [index, item] of before.items.filter((item) => item.definition === 5000).entries()) {
      await act(async () =>
        box
          .querySelector<HTMLButtonElement>(
            `[aria-label="Scrap Metal, Unique, slot ${item.position}"]`,
          )
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: index > 0 })),
      );
    }
    await clickButton(box, "Craft selected");
    expect(button("Simulate craft")?.disabled).toBe(false);
    expect(box.querySelectorAll('[aria-label="Exact crafting ingredients"] li')).toHaveLength(3);
    for (const item of before.items.filter((item) => item.definition === 5000)) {
      expect(element(box, '[aria-label="Exact crafting ingredients"]').textContent).toContain(
        item.id,
      );
    }
    await act(async () => button("Simulate craft")?.click());
    expect(craft).toHaveBeenCalledOnce();
    const after = await api.getInventory();
    expect(after.items.filter((item) => item.definition === 5000)).toHaveLength(0);
    expect(after.items.filter((item) => item.definition === 5001)).toHaveLength(4);
    expect(box.textContent).toContain("0 selected");
    expect(box.textContent).toContain("Simulated");
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("cancels the exact crafting review without consuming selected ingredients", async () => {
  await fixtureInteraction(async ({ box, api }) => {
    const before = await api.getInventory();
    const craft = vi.spyOn(api, "craftInventory");
    for (const [index, item] of before.items.filter((item) => item.definition === 5000).entries()) {
      await act(async () =>
        element(box, `[aria-label="Scrap Metal, Unique, slot ${item.position}"]`).dispatchEvent(
          new MouseEvent("click", { bubbles: true, ctrlKey: index > 0 }),
        ),
      );
    }
    await clickButton(box, "Craft selected");
    expect(box.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(box.querySelectorAll('[aria-label="Exact crafting ingredients"] li')).toHaveLength(3);
    await clickButton(box, "Back to backpack");
    expect(box.querySelector('[role="dialog"]')).toBeNull();
    expect(craft).not.toHaveBeenCalled();
    expect(await api.getInventory()).toEqual(before);
    expect(element(box, '[aria-label="Backpack organizer"]').textContent).toContain("3 selected");
  });
});

it("reviews occupied-slot swaps and applies only through the simulation adapter", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const simulator = createInventorySimulation();
  const apply = vi.fn(simulator.applyInventoryLayout);
  const api = {
    ...simulator,
    applyInventoryLayout: apply,
    getInventoryIcons: vi.fn().mockResolvedValue({}),
  } as unknown as Api;
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  const button = (name: string) =>
    [...box.querySelectorAll("button")].find(
      (entry) => entry.textContent?.trim() === name || entry.getAttribute("aria-label") === name,
    );
  try {
    await act(async () =>
      root.render(
        <StrictMode>
          <InventoryPane api={api} active running={false} busy={false} />
        </StrictMode>,
      ),
    );
    await act(async () =>
      box
        .querySelector<HTMLButtonElement>(
          '[aria-label="Skull Cracked War Paint, Decorated, slot 2"]',
        )
        ?.click(),
    );
    await act(async () => button("Move selected in draft")?.click());
    expect(apply).not.toHaveBeenCalled();
    expect(
      box.querySelector('[aria-label="Skull Cracked War Paint, Decorated, slot 1"]'),
    ).not.toBeNull();
    await act(async () => button("Undo draft")?.click());
    expect(
      box.querySelector('[aria-label="Skull Cracked War Paint, Decorated, slot 2"]'),
    ).not.toBeNull();
    await act(async () => button("Redo draft")?.click());
    await act(async () => button("Review 2 changes")?.click());
    expect(box.querySelector('[role="dialog"]')?.textContent).toContain("Skull Cracked War Paint");
    expect(box.querySelector('[role="dialog"]')?.textContent).toContain("Scattergun");
    await act(async () => {
      button("Apply simulation")?.click();
      button("Apply simulation")?.click();
    });
    expect(apply).toHaveBeenCalledOnce();
    expect(apply.mock.calls[0][0].moves).toHaveLength(2);
    expect(box.textContent).toContain("Simulated 2 moves");
    expect(
      (await simulator.getInventory()).items.find((item) => item.definition === 17286)?.position,
    ).toBe(1);
    expect(button("Undo draft")?.disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("retains multi-selection across pages and refuses moving protected items", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const simulator = createInventorySimulation();
  const api = { ...simulator, getInventoryIcons: vi.fn().mockResolvedValue({}) } as unknown as Api;
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  const button = (name: string) =>
    [...box.querySelectorAll("button")].find(
      (entry) => entry.textContent?.trim() === name || entry.getAttribute("aria-label") === name,
    );
  try {
    await act(async () =>
      root.render(<InventoryPane api={api} active running={false} busy={false} />),
    );
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[aria-label="Scattergun, Unique, slot 1"]')?.click(),
    );
    await act(async () =>
      box
        .querySelector<HTMLButtonElement>(
          '[aria-label="Skull Cracked War Paint, Decorated, slot 2"]',
        )
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true })),
    );
    expect(box.textContent).toContain("2 selected");
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[aria-label="Next page"]')?.click(),
    );
    expect(box.textContent).toContain("2 outside this page or filter");
    await act(async () => button("Protect selected")?.click());
    await act(async () => button("Move selected in draft")?.click());
    expect(box.textContent).toContain("Unprotect selected items before moving");
    expect(button("Undo draft")?.disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("does not replay an unverified arrangement and requires a fresh read before a new draft", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const simulator = createInventorySimulation();
  const apply = vi.fn().mockResolvedValue({
    operationId: "bad",
    kind: "layout",
    status: "simulated",
    snapshot: null,
    message: "Unverified claim",
  });
  const getInventory = vi.fn(simulator.getInventory);
  const api = {
    ...simulator,
    getInventory,
    applyInventoryLayout: apply,
    getInventoryIcons: vi.fn().mockResolvedValue({}),
  } as unknown as Api;
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  const button = (name: string) =>
    [...box.querySelectorAll("button")].find(
      (entry) => entry.textContent?.trim() === name || entry.getAttribute("aria-label") === name,
    );
  try {
    await act(async () =>
      root.render(<InventoryPane api={api} active running={false} busy={false} />),
    );
    await act(async () =>
      box
        .querySelector<HTMLButtonElement>(
          '[aria-label="Skull Cracked War Paint, Decorated, slot 2"]',
        )
        ?.click(),
    );
    await act(async () => button("Move selected in draft")?.click());
    await act(async () => button("Review 2 changes")?.click());
    await act(async () => button("Apply simulation")?.click());
    expect(apply).toHaveBeenCalledOnce();
    expect(box.textContent).toContain("unconfirmed");
    expect(button("Review 2 changes")?.disabled).toBe(true);
    await act(async () =>
      root.render(<InventoryPane api={api} active={false} running={false} busy={false} />),
    );
    await act(async () =>
      root.render(<InventoryPane api={api} active running={false} busy={false} />),
    );
    expect(button("Review 2 changes")?.disabled).toBe(true);
    await act(async () => button("Refresh and discard old plan")?.click());
    expect(getInventory).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledOnce();
    expect(box.textContent).not.toContain("unconfirmed");
    expect(
      box.querySelector('[aria-label="Skull Cracked War Paint, Decorated, slot 2"]'),
    ).not.toBeNull();
    expect(button("Undo draft")?.disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("loads automatically and retains a clearly stale snapshot on a failed refresh", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const getInventory = vi.fn().mockResolvedValue({
    steamId: "test-account",
    personaName: "Test player",
    avatar: "data:image/png;base64,avatar",
    capacity: 50,
    items: [{ id: "123", definition: 13, position: 1, quality: 6, level: 1, customName: null }],
    definitions: { "13": { name: "Scattergun", kind: "Weapon", classes: ["scout"], icon: null } },
    warning: null,
  });
  const api = {
    getInventory,
    getInventoryIcons: vi.fn().mockResolvedValue({}),
    openExternal: vi.fn(),
  } as unknown as Api;
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  try {
    await act(async () =>
      root.render(<InventoryPane api={api} active running={false} busy={false} />),
    );
    expect(getInventory).toHaveBeenCalledTimes(1);
    expect(box.textContent).not.toContain("Refresh backpack");
    expect(box.textContent).toContain("Steam account test-account");
    expect(box.querySelector("header")?.textContent).toContain("Test player");
    expect(box.querySelector('img[alt="Steam avatar"]')?.getAttribute("src")).toBe(
      "data:image/png;base64,avatar",
    );
    expect(box.querySelectorAll('nav[aria-label="Backpack pages"]')).toHaveLength(1);
    expect(
      box.querySelector('[aria-label="Backpack items"]')?.classList.contains("inventory-grid"),
    ).toBe(true);
    expect(box.querySelectorAll('[aria-label="Backpack items"] > *')).toHaveLength(50);
    expect(
      box.querySelector<HTMLButtonElement>('[aria-label="Scattergun, Unique, slot 1"]')?.style
        .borderColor,
    ).toBe("rgb(255, 215, 0)");
    expect(
      box.querySelector<HTMLButtonElement>('[aria-label="Scattergun, Unique, slot 1"]')?.style
        .borderWidth,
    ).toBe("");
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[aria-label="Scattergun, Unique, slot 1"]')?.click(),
    );
    await clickButton(box, "Inspect");
    expect(box.querySelector('[aria-label="Item details"]')?.textContent).toContain("Item 123");
    expect(box.querySelector<HTMLElement>('[aria-label="Item details"]')?.style.borderColor).toBe(
      "rgb(255, 215, 0)",
    );
    await clickButton(box, "Close details");
    vi.useFakeTimers();
    getInventory.mockRejectedValueOnce(new Error("Steam disconnected"));
    // Return from the game requests a fresh snapshot without a refresh button.
    await act(async () => root.render(<InventoryPane api={api} active running busy={false} />));
    await act(async () =>
      root.render(<InventoryPane api={api} active running={false} busy={false} />),
    );
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(box.querySelector('[role="alert"]')?.textContent).toContain("Steam disconnected");
    expect(box.textContent).toContain("last confirmed snapshot");
    expect(box.textContent).toContain("Test player");
    expect(box.querySelector('img[alt="Steam avatar"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("loads an unplaced item's own artwork and keeps the preview while paging", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/png;base64,pixels",
  );
  const icon = "materials/backpack/kit.vtf";
  const getInventoryIcons = vi
    .fn()
    .mockResolvedValue({ [icon]: { width: 1, height: 1, rgba: [255, 255, 255, 255] } });
  const api = {
    getInventory: vi.fn().mockResolvedValue({
      steamId: "test-account",
      capacity: 100,
      warning: null,
      items: [{ id: "kit", definition: 1, position: 0, quality: 6, level: 1, customName: null }],
      definitions: { "1": { name: "Kit", kind: "Tool", classes: [], icon: null } },
      itemDescriptions: {
        kit: {
          name: "Rocket Launcher Kit",
          kind: "Tool",
          classes: [],
          icon,
          details: ["Sheen: Team Shine"],
        },
      },
    }),
    getInventoryIcons,
    openExternal: vi.fn(),
  } as unknown as Api;
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  try {
    await act(async () =>
      root.render(<InventoryPane api={api} active running={false} busy={false} />),
    );
    expect(getInventoryIcons).toHaveBeenCalledWith([icon]);
    await act(async () =>
      element<HTMLButtonElement>(
        box,
        '[aria-label="Rocket Launcher Kit, Unique, unplaced"]',
      ).click(),
    );
    await clickButton(box, "Inspect");
    expect(getInventoryIcons).toHaveBeenCalledWith([icon]);
    expect(box.querySelector('img[alt="Rocket Launcher Kit"]')?.getAttribute("src")).toBe(
      "data:image/png;base64,pixels",
    );
    expect(box.querySelector('[aria-label="Item details"]')?.textContent).toContain(
      "Sheen: Team Shine",
    );
    await clickButton(box, "Close details");
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[aria-label="Next page"]')?.click(),
    );
    await clickButton(box, "Inspect");
    expect(box.querySelector('img[alt="Rocket Launcher Kit"]')).not.toBeNull();
    expect(getInventoryIcons).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();
    await act(async () => root.render(<InventoryPane api={api} active running busy={false} />));
    await act(async () =>
      root.render(<InventoryPane api={api} active running={false} busy={false} />),
    );
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect((box.querySelector('[aria-label="Backpack page"]') as HTMLInputElement).value).toBe("2");
    expect(box.querySelector('img[alt="Rocket Launcher Kit"]')).not.toBeNull();
    expect(getInventoryIcons).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("keeps installed item artwork when an optional pattern cannot be decoded", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,ok");
  const icon = "materials/backpack/gun.vtf";
  const pattern = "materials/patterns/camo_jungle_green_02.vtf";
  const getInventoryIcons = vi.fn(async (paths: string[]) => {
    if (paths[0] === pattern) throw new Error("Pattern unavailable");
    return { [icon]: { width: 1, height: 1, rgba: [255, 255, 255, 255] } };
  });
  const api = {
    getInventory: vi.fn().mockResolvedValue({
      steamId: "test-account",
      capacity: 50,
      warning: null,
      items: [
        { id: "gun", definition: 1, position: 1, quality: 6, level: 1, customName: null },
        { id: "paint", definition: 2, position: 2, quality: 15, level: 1, customName: null },
      ],
      definitions: {
        "1": { name: "Gun", kind: "Weapon", classes: [], icon },
        "2": { name: "Paint", kind: "War Paint", classes: [], icon },
      },
      itemDescriptions: {
        paint: {
          name: "Paint",
          kind: "War Paint",
          classes: [],
          icon,
          patternIcon: pattern,
          details: ["Pattern swatch"],
        },
      },
    }),
    getInventoryIcons,
  } as unknown as Api;
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  try {
    await act(async () =>
      root.render(<InventoryPane api={api} active running={false} busy={false} />),
    );
    expect(getInventoryIcons).toHaveBeenCalledWith([icon]);
    expect(getInventoryIcons).toHaveBeenCalledWith([pattern]);
    expect(box.querySelector('img[src="data:image/png;base64,ok"]')).not.toBeNull();
    expect(box.textContent).not.toContain("Some item artwork is unavailable");
    expect(box.textContent).not.toContain("BridgeError");
    await act(async () =>
      box.querySelector<HTMLButtonElement>('[aria-label="Paint, Decorated, slot 2"]')?.click(),
    );
    await clickButton(box, "Inspect");
    expect(getInventoryIcons.mock.calls.filter(([paths]) => paths[0] === pattern)).toHaveLength(1);
    expect(box.querySelector('[aria-label="Item details"]')?.textContent).toContain(
      "Pattern swatch unavailable in installed TF2 files.",
    );
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("reveals the first slot only when the displayed page changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const getInventory = vi.fn().mockResolvedValue({
    steamId: "test-account",
    capacity: 100,
    warning: null,
    items: [{ id: "123", definition: 13, position: 51, quality: 6, level: 1, customName: null }],
    definitions: { "13": { name: "Scattergun", kind: "Weapon", classes: ["scout"], icon: null } },
  });
  const api = {
    getInventory,
    getInventoryIcons: vi.fn().mockResolvedValue({}),
    openExternal: vi.fn(),
  } as unknown as Api;
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  async function render(active = true, running = false) {
    await act(async () =>
      root.render(<InventoryPane api={api} active={active} running={running} busy={false} />),
    );
  }
  async function click(selector: string) {
    await act(async () =>
      box.querySelector<HTMLInputElement | HTMLButtonElement>(selector)?.click(),
    );
  }
  try {
    await render();
    expect(scrollIntoView).not.toHaveBeenCalled();
    await click('[aria-label="Next page"]');
    expect(box.querySelector<HTMLInputElement>('[aria-label="Backpack page"]')?.value).toBe("2");
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: "start", behavior: "instant" });
    expect(scrollIntoView.mock.contexts[0]).toBe(
      box.querySelector('[aria-label="Backpack items"]'),
    );
    await render(false);
    await render();
    vi.useFakeTimers();
    await render(true, true);
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(getInventory.mock.calls.length).toBeGreaterThan(1);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    await sortBackpack(box, "name");
    expect(box.querySelector<HTMLInputElement>('[aria-label="Backpack page"]')?.value).toBe("1");
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    await sortBackpack(box, "quality");
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("shows kit target art and an installed paint swatch without claiming rendered wear", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,art");
  const paths = {
    kit: "materials/backpack/kit.vtf",
    target: "materials/backpack/rocket.vtf",
    paint: "materials/patterns/camo.vtf",
    base: "materials/backpack/scattergun.vtf",
  };
  const api = {
    getInventory: vi.fn().mockResolvedValue({
      steamId: "test-account",
      capacity: 50,
      warning: null,
      items: [
        { id: "kit", definition: 1, position: 1, quality: 6, level: 1, customName: null },
        { id: "paint", definition: 2, position: 2, quality: 15, level: 1, customName: null },
      ],
      definitions: {
        "1": { name: "Kit", kind: "Tool", classes: [], icon: paths.kit },
        "2": { name: "Paint", kind: "Weapon", classes: [], icon: paths.paint },
      },
      itemDescriptions: {
        kit: {
          name: "Killstreak Kit · Rocket Launcher",
          kind: "Tool",
          classes: [],
          icon: paths.kit,
          targetIcon: paths.target,
          details: ["For Rocket Launcher"],
        },
        paint: {
          name: "Painted Scattergun",
          kind: "Weapon",
          classes: [],
          icon: paths.base,
          patternIcon: paths.paint,
          details: ["Well-Worn"],
        },
      },
    }),
    getInventoryIcons: vi.fn(async (requested: string[]) =>
      Object.fromEntries(
        requested.map((path) => [path, { width: 1, height: 1, rgba: [1, 2, 3, 255] }]),
      ),
    ),
  } as unknown as Api;
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  try {
    await act(async () =>
      root.render(<InventoryPane api={api} active running={false} busy={false} />),
    );
    expect(box.querySelector(".inventory-kit-target")).not.toBeNull();
    expect(box.querySelector(".inventory-paint-icon")).not.toBeNull();
    expect(box.querySelector(".inventory-paint-swatch")).not.toBeNull();
    expect(box.querySelector(".inventory-paint-only-swatch")).toBeNull();
    await act(async () =>
      box
        .querySelector<HTMLButtonElement>('[aria-label="Painted Scattergun, Decorated, slot 2"]')
        ?.click(),
    );
    await clickButton(box, "Inspect");
    expect(box.querySelector(".inventory-paint-swatch")).not.toBeNull();
    expect(box.querySelector('[aria-label="Item details"]')?.textContent).toContain("Well-Worn");
    expect(box.querySelector('[aria-label="Item details"]')?.textContent).toContain(
      "In-game mapping, wear and effects are not rendered.",
    );
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("retries an omitted path alone when an icon batch hits its native byte budget", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,art");
  const first = "materials/backpack/first.vtf";
  const second = "materials/backpack/second.vtf";
  const icon = { width: 1, height: 1, rgba: [1, 2, 3, 255] };
  const getInventoryIcons = vi.fn(async (paths: string[]) =>
    paths.length === 2 ? { [first]: icon } : { [paths[0]]: icon },
  );
  const api = {
    getInventory: vi.fn().mockResolvedValue({
      steamId: "test-account",
      capacity: 50,
      warning: null,
      items: [
        { id: "first", definition: 1, position: 1, quality: 6, level: 1, customName: null },
        { id: "second", definition: 2, position: 2, quality: 6, level: 1, customName: null },
      ],
      definitions: {
        "1": { name: "First", kind: "Weapon", classes: [], icon: first },
        "2": { name: "Second", kind: "Weapon", classes: [], icon: second },
      },
    }),
    getInventoryIcons,
  } as unknown as Api;
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  try {
    await act(async () =>
      root.render(<InventoryPane api={api} active running={false} busy={false} />),
    );
    expect(getInventoryIcons).toHaveBeenCalledWith([first, second]);
    expect(getInventoryIcons).toHaveBeenCalledWith([second]);
    expect(
      box.querySelectorAll('.inventory-item img[src="data:image/png;base64,art"]'),
    ).toHaveLength(2);
    expect(box.textContent).not.toContain("Some item artwork is unavailable");
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
