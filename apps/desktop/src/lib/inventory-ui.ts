import type { InventoryItem, InventorySnapshot } from "./bridge";

export const INVENTORY_PAGE_SIZE = 50;
export const QUALITY_NAMES: Record<number, string> = {
  0: "Normal",
  1: "Genuine",
  3: "Vintage",
  5: "Unusual",
  6: "Unique",
  7: "Community",
  8: "Valve",
  9: "Self-made",
  11: "Strange",
  13: "Haunted",
  14: "Collector’s",
  15: "Decorated",
};
export function itemName(snapshot: InventorySnapshot, item: InventoryItem): string {
  return (
    item.customName || snapshot.definitions[item.definition]?.name || `Item #${item.definition}`
  );
}
export function inventoryPage(
  snapshot: InventorySnapshot,
  query: string,
  quality: number | null,
  page: number,
) {
  const needle = query.trim().toLocaleLowerCase();
  const filtered = needle.length > 0 || quality !== null;
  const matches = snapshot.items
    .filter((item) => {
      const definition = snapshot.definitions[item.definition];
      return (
        (quality === null || item.quality === quality) &&
        (!needle ||
          [
            itemName(snapshot, item),
            definition?.name,
            definition?.kind,
            ...(definition?.classes ?? []),
            item.id,
            String(item.definition),
            QUALITY_NAMES[item.quality],
          ].some((part) => part?.toLocaleLowerCase().includes(needle)))
      );
    })
    .sort(
      (a, b) =>
        (a.position || Number.MAX_SAFE_INTEGER) - (b.position || Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id),
    );
  const pages = Math.max(
    1,
    Math.ceil((filtered ? matches.length : snapshot.capacity) / INVENTORY_PAGE_SIZE),
  );
  const current = Math.min(pages, Math.max(1, Math.trunc(page) || 1));
  const start = (current - 1) * INVENTORY_PAGE_SIZE;
  const bySlot = new Map(
    snapshot.items.filter((item) => item.position > 0).map((item) => [item.position, item]),
  );
  const slots = filtered
    ? matches
        .slice(start, start + INVENTORY_PAGE_SIZE)
        .map((item) => ({ position: item.position, item }))
    : Array.from(
        { length: Math.min(INVENTORY_PAGE_SIZE, snapshot.capacity - start) },
        (_, index) => ({
          position: start + index + 1,
          item: bySlot.get(start + index + 1) ?? null,
        }),
      );
  return {
    filtered,
    pages,
    current,
    slots,
    matchCount: matches.length,
    unplaced: snapshot.items.filter((i) => i.position === 0),
  };
}
