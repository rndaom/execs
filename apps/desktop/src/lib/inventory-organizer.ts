import type { InventoryOperationResult, InventorySnapshot } from "./bridge";
import { compareInventoryItems, type InventorySort } from "./inventory-ui";

export type InventoryLayout = Record<string, number>;
export type InventoryMove = { id: string; from: number; to: number };
export type OrganizerHistory = {
  past: InventoryLayout[];
  present: InventoryLayout;
  future: InventoryLayout[];
};

/** Only accept a complete account-bound reconciliation; a claimed success also
 * needs every requested and untouched position to match the reviewed layout. */
export function verifyInventoryLayoutResult(
  baseline: InventorySnapshot,
  moves: readonly InventoryMove[],
  result: InventoryOperationResult,
  mode: "simulation" | "live" = "simulation",
): InventoryOperationResult {
  const unknown = (): InventoryOperationResult => ({
    ...result,
    status: "unknown",
    snapshot: null,
    message:
      "The arrangement result could not be verified. Refresh the backpack before another attempt; do not replay this operation.",
  });
  if (result.status === "partial") return { ...result, snapshot: null };
  if (result.status === "refused") return { ...result, snapshot: null };
  if (result.status !== (mode === "live" ? "confirmed" : "simulated")) return unknown();
  const next = result.snapshot;
  if (
    !next ||
    result.kind !== "layout" ||
    next.steamId !== baseline.steamId ||
    next.capacity !== baseline.capacity
  )
    return unknown();
  try {
    inventoryLayout(next);
  } catch {
    return unknown();
  }
  const identity = (snapshot: InventorySnapshot) =>
    JSON.stringify(
      [...snapshot.items]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(
          ({ position: _position, rawPosition: _rawPosition, rawItem: _rawItem, ...item }) => item,
        ),
    );
  if (identity(next) !== identity(baseline)) return unknown();
  const metadata = ({ items: _items, ...remaining }: InventorySnapshot) =>
    JSON.stringify(remaining);
  if (mode === "simulation" && metadata(next) !== metadata(baseline)) return unknown();
  {
    const expected = inventoryLayout(baseline);
    for (const move of moves) expected[move.id] = move.to;
    if (next.items.some((item) => expected[item.id] !== item.position)) return unknown();
  }
  return result;
}

export function inventoryLayout(snapshot: InventorySnapshot): InventoryLayout {
  const layout = Object.fromEntries(snapshot.items.map((item) => [item.id, item.position]));
  validateInventoryLayout(snapshot, layout);
  return layout;
}

export function validateInventoryLayout(snapshot: InventorySnapshot, layout: InventoryLayout) {
  if (
    !snapshot.steamId ||
    !Number.isInteger(snapshot.capacity) ||
    snapshot.capacity < 1 ||
    snapshot.capacity > 10000
  )
    throw Error("Invalid backpack account or capacity.");
  const ids = new Set(snapshot.items.map((item) => item.id));
  if (ids.size !== snapshot.items.length || ids.has("") || Object.keys(layout).length !== ids.size)
    throw Error("Backpack item identities changed or are duplicated.");
  const occupied = new Set<number>();
  for (const id of ids) {
    const slot = layout[id];
    if (
      !Object.hasOwn(layout, id) ||
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot > snapshot.capacity
    )
      throw Error("Every item needs a valid backpack slot.");
    if (slot > 0 && occupied.has(slot))
      throw Error("Two items cannot occupy the same backpack slot.");
    if (slot > 0) occupied.add(slot);
  }
}

export function inventoryLayoutChanges(
  snapshot: InventorySnapshot,
  layout: InventoryLayout,
): InventoryMove[] {
  validateInventoryLayout(snapshot, layout);
  return snapshot.items
    .filter((item) => layout[item.id] !== item.position)
    .map((item) => ({ id: item.id, from: item.position, to: layout[item.id] }));
}

/** Single moves swap occupied slots. Batches fill available slots from the destination,
 * retaining backpack order (unplaced items last, then exact string ID). */
export function moveInventoryItems(
  snapshot: InventorySnapshot,
  layout: InventoryLayout,
  selected: readonly string[],
  destination: number,
  protectedIds: ReadonlySet<string> = new Set(),
): InventoryLayout {
  validateInventoryLayout(snapshot, layout);
  if (!Number.isInteger(destination) || destination < 1 || destination > snapshot.capacity)
    throw Error("Choose a destination within your backpack.");
  if (!selected.length || new Set(selected).size !== selected.length)
    throw Error("Select distinct items to move.");
  for (const id of selected) {
    if (!Object.hasOwn(layout, id)) throw Error("A selected item is no longer in this backpack.");
    if (protectedIds.has(id)) throw Error("Unprotect selected items before moving them.");
  }
  const next = { ...layout };
  if (selected.length === 1) {
    const id = selected[0];
    const occupant = Object.keys(layout).find((key) => layout[key] === destination && key !== id);
    if (occupant) {
      if (protectedIds.has(occupant)) throw Error("The destination contains a protected item.");
      if (layout[id] === 0) throw Error("An unplaced item needs an empty destination slot.");
      next[occupant] = layout[id];
    }
    next[id] = destination;
  } else {
    const selection = new Set(selected);
    const occupied = new Set(
      Object.entries(layout)
        .filter(([id]) => !selection.has(id))
        .map(([, slot]) => slot),
    );
    const ordered = [...selected].sort(
      (a, b) => (layout[a] || Infinity) - (layout[b] || Infinity) || a.localeCompare(b),
    );
    let slot = destination;
    for (const id of ordered) {
      while (occupied.has(slot) && slot <= snapshot.capacity) slot++;
      if (slot > snapshot.capacity)
        throw Error("Not enough empty slots after this destination. Choose an earlier slot.");
      next[id] = slot++;
    }
  }
  validateInventoryLayout(snapshot, next);
  return next;
}

/** Pack the whole backpack in sorted order, keeping protected slots fixed.
 * Ties use the current draft positions, so sorting composes with manual moves. */
export function sortInventoryLayout(
  snapshot: InventorySnapshot,
  layout: InventoryLayout,
  sort: Exclude<InventorySort, "position">,
  protectedIds: ReadonlySet<string> = new Set(),
): InventoryLayout {
  validateInventoryLayout(snapshot, layout);
  const next = { ...layout };
  const occupied = new Set(
    snapshot.items.filter((item) => protectedIds.has(item.id)).map((item) => layout[item.id]),
  );
  const ordered = snapshot.items
    .filter((item) => !protectedIds.has(item.id))
    .map((item) => ({ ...item, position: layout[item.id] }))
    .sort((a, b) => compareInventoryItems(snapshot, a, b, sort));
  let slot = 1;
  for (const item of ordered) {
    while (occupied.has(slot)) slot++;
    if (slot > snapshot.capacity) throw Error("Not enough backpack space to sort all items.");
    next[item.id] = slot++;
  }
  validateInventoryLayout(snapshot, next);
  return next;
}

export function restoreInventoryLayout(
  snapshot: InventorySnapshot,
  current: InventoryLayout,
  next: InventoryLayout,
  protectedIds: ReadonlySet<string>,
): InventoryLayout {
  validateInventoryLayout(snapshot, next);
  if ([...protectedIds].some((id) => Object.hasOwn(current, id) && next[id] !== current[id]))
    throw Error("This layout would move a protected item.");
  return { ...next };
}

export function pushInventoryLayout(
  history: OrganizerHistory,
  next: InventoryLayout,
): OrganizerHistory {
  if (Object.keys(next).every((id) => next[id] === history.present[id])) return history;
  return { past: [...history.past.slice(-49), history.present], present: next, future: [] };
}
export function undoInventoryLayout(history: OrganizerHistory): OrganizerHistory {
  const previous = history.past.at(-1);
  return previous
    ? {
        past: history.past.slice(0, -1),
        present: previous,
        future: [history.present, ...history.future],
      }
    : history;
}
export function redoInventoryLayout(history: OrganizerHistory): OrganizerHistory {
  const next = history.future[0];
  return next
    ? { past: [...history.past, history.present], present: next, future: history.future.slice(1) }
    : history;
}
