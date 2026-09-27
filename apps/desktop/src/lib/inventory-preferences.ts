import type { InventorySnapshot } from "./bridge";
import type { InventorySort } from "./inventory-ui";

export const INVENTORY_PREFERENCES_LIMITS = {
  items: 10_000,
  searches: 20,
  layouts: 12,
  history: 50,
  characters: 2_000_000,
} as const;
export type InventorySearch = { query: string; quality: number | null; sort: InventorySort };
export type SavedInventorySearch = InventorySearch & { name: string };
export type SavedInventoryLayout = {
  name: string;
  capacity: number;
  positions: Record<string, number>;
};
export type InventoryOperation = {
  kind: "move" | "craft" | "delete";
  outcome: "confirmed" | "simulated" | "partial" | "unknown" | "refused";
  summary: string;
  itemIds: readonly string[];
};
export type InventoryPreferences = {
  version: 1;
  account: string;
  protectedIds: string[];
  favoriteIds: string[];
  searches: SavedInventorySearch[];
  layouts: SavedInventoryLayout[];
  history: (InventoryOperation & { at: number })[];
};
export type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function emptyInventoryPreferences(account: string): InventoryPreferences {
  return {
    version: 1,
    account,
    protectedIds: [],
    favoriteIds: [],
    searches: [],
    layouts: [],
    history: [],
  };
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= max &&
    [...value].every(
      (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
    )
  );
}
function itemId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,19}$/.test(value);
}
function ids(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= INVENTORY_PREFERENCES_LIMITS.items &&
    value.every(itemId) &&
    new Set(value).size === value.length
  );
}
function name(value: unknown): value is string {
  return text(value, 60) && value.length > 0 && value === value.trim();
}
export function validInventoryPositions(
  value: unknown,
  capacity: number,
): value is Record<string, number> {
  if (
    !record(value) ||
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    capacity > INVENTORY_PREFERENCES_LIMITS.items
  )
    return false;
  const entries = Object.entries(value);
  if (entries.length > INVENTORY_PREFERENCES_LIMITS.items) return false;
  const occupied = new Set<number>();
  for (const [id, position] of entries) {
    if (
      !itemId(id) ||
      typeof position !== "number" ||
      !Number.isInteger(position) ||
      position < 0 ||
      position > capacity
    )
      return false;
    if (position > 0) {
      if (occupied.has(position)) return false;
      occupied.add(position);
    }
  }
  return true;
}
export function validInventoryPreferences(
  value: unknown,
  account: string,
): value is InventoryPreferences {
  if (
    !record(value) ||
    value.version !== 1 ||
    value.account !== account ||
    !text(account, 64) ||
    !account ||
    !ids(value.protectedIds) ||
    !ids(value.favoriteIds)
  )
    return false;
  if (
    !Array.isArray(value.searches) ||
    value.searches.length > INVENTORY_PREFERENCES_LIMITS.searches ||
    !Array.isArray(value.layouts) ||
    value.layouts.length > INVENTORY_PREFERENCES_LIMITS.layouts ||
    !Array.isArray(value.history) ||
    value.history.length > INVENTORY_PREFERENCES_LIMITS.history
  )
    return false;
  if (
    !value.searches.every(
      (s) =>
        record(s) &&
        name(s.name) &&
        text(s.query, 200) &&
        (s.quality === null ||
          (Number.isInteger(s.quality) && Number(s.quality) >= 0 && Number(s.quality) <= 255)) &&
        ["position", "name", "quality", "type"].includes(String(s.sort)),
    )
  )
    return false;
  if (
    !value.layouts.every(
      (l) =>
        record(l) &&
        name(l.name) &&
        typeof l.capacity === "number" &&
        validInventoryPositions(l.positions, l.capacity),
    )
  )
    return false;
  if (
    new Set(value.searches.map((s) => s.name)).size !== value.searches.length ||
    new Set(value.layouts.map((l) => l.name)).size !== value.layouts.length
  )
    return false;
  if (
    new Set(value.history.map((entry) => (record(entry) ? entry.at : null))).size !==
    value.history.length
  )
    return false;
  return value.history.every(
    (h) =>
      record(h) &&
      ["move", "craft", "delete"].includes(String(h.kind)) &&
      ["confirmed", "simulated", "partial", "unknown", "refused"].includes(String(h.outcome)) &&
      text(h.summary, 240) &&
      ids(h.itemIds) &&
      Number.isSafeInteger(h.at) &&
      Number(h.at) >= 0 &&
      Number(h.at) <= 8_640_000_000_000_000,
  );
}
export function inventoryPreferencesKey(account: string): string {
  return `execs:inventory-preferences:v1:${encodeURIComponent(account)}`;
}
export function readInventoryPreferences(storage: PreferenceStorage | null, account: string) {
  const empty = emptyInventoryPreferences(account);
  if (!account) return { preferences: empty, error: null };
  if (!storage)
    return {
      preferences: empty,
      error:
        "Local storage is unavailable. Saved protections cannot be checked; changes last for this session only.",
    };
  try {
    const source = storage.getItem(inventoryPreferencesKey(account));
    if (source === null) return { preferences: empty, error: null };
    if (source.length > INVENTORY_PREFERENCES_LIMITS.characters) throw Error("Too large");
    const parsed: unknown = JSON.parse(source);
    if (!validInventoryPreferences(parsed, account)) throw Error("Invalid preferences");
    return { preferences: parsed, error: null };
  } catch {
    return {
      preferences: empty,
      error:
        "Saved inventory preferences could not be read. Saved protections cannot be checked; changes last for this session only.",
    };
  }
}
export function writeInventoryPreferences(
  storage: PreferenceStorage | null,
  preferences: InventoryPreferences,
): string | null {
  if (!validInventoryPreferences(preferences, preferences.account))
    return "Inventory preferences exceed their limits or contain invalid values.";
  try {
    const source = JSON.stringify(preferences);
    if (!storage || source.length > INVENTORY_PREFERENCES_LIMITS.characters)
      throw Error("Unavailable");
    storage.setItem(inventoryPreferencesKey(preferences.account), source);
    return null;
  } catch {
    return "Inventory preferences could not be saved. Changes last for this session only.";
  }
}
export function setInventoryFlags(
  current: readonly string[],
  selected: readonly string[],
  value: boolean,
): string[] {
  const next = new Set(current);
  for (const id of selected) {
    if (!itemId(id)) throw Error("Invalid item identity.");
    if (value) next.add(id);
    else next.delete(id);
  }
  if (next.size > INVENTORY_PREFERENCES_LIMITS.items)
    throw Error("Too many saved item preferences.");
  return [...next];
}
export function saveNamedInventoryEntry<T extends { name: string }>(
  entries: readonly T[],
  entry: T,
  limit: number,
): T[] {
  const cleaned = { ...entry, name: entry.name.trim() };
  if (!name(cleaned.name)) throw Error("Use a name of 1–60 characters without control characters.");
  if (entries.some((existing) => existing.name === cleaned.name))
    throw Error(
      "That name is already saved. Choose another name or remove the existing entry first.",
    );
  if (entries.length >= limit)
    throw Error(`The limit is ${limit} saved entries. Remove one before saving another.`);
  return [...entries, cleaned];
}

/** Restore only present identities. New items and protected items keep their current slots.
 * Conflicts refuse the complete restore; there is no guessed relocation or Steam write. */
export function restoreInventoryLayout(
  saved: SavedInventoryLayout,
  snapshot: InventorySnapshot,
  current: Readonly<Record<string, number>>,
  protectedIds: ReadonlySet<string>,
): { positions: Record<string, number>; missing: number; retained: number } {
  if (
    !validInventoryPositions(saved.positions, saved.capacity) ||
    !validInventoryPositions(current, snapshot.capacity)
  )
    throw Error("The saved layout or current draft is invalid.");
  const present = new Set(snapshot.items.map((item) => item.id));
  if (
    Object.keys(current).length !== present.size ||
    snapshot.items.some((item) => current[item.id] === undefined)
  )
    throw Error("Refresh the backpack before restoring a layout.");
  const positions: Record<string, number> = {};
  let retained = 0;
  for (const item of snapshot.items) {
    const savedPosition = saved.positions[item.id];
    if (protectedIds.has(item.id) || savedPosition === undefined || savedPosition === 0) {
      positions[item.id] = current[item.id];
      retained++;
    } else positions[item.id] = savedPosition;
  }
  if (!validInventoryPositions(positions, snapshot.capacity))
    throw Error(
      "This layout conflicts with a protected or newly acquired item, or the current backpack capacity. No draft changes were made.",
    );
  return {
    positions,
    missing: Object.keys(saved.positions).filter((id) => !present.has(id)).length,
    retained,
  };
}
