import type { InventoryItem, InventorySnapshot } from "./bridge";

export const INVENTORY_PAGE_SIZE = 50;
export type InventorySort = "position" | "name" | "quality" | "type";
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
// The installed schema is authoritative. These known TF2 quality colors keep
// borders visible when an older/partial snapshot has no schema color table.
export const QUALITY_COLORS: Record<number, string> = {
  0: "#B2B2B2",
  1: "#4D7455",
  3: "#476291",
  5: "#8650AC",
  6: "#FFD700",
  7: "#70B04A",
  8: "#A50F79",
  9: "#70B04A",
  11: "#CF6A32",
  13: "#38F3AB",
  14: "#AA0000",
  15: "#FAFAFA",
};
export function qualityColor(snapshot: InventorySnapshot, quality: number): string | undefined {
  return snapshot.qualityColors?.[quality] ?? QUALITY_COLORS[quality];
}
export function itemName(snapshot: InventorySnapshot, item: InventoryItem): string {
  return item.customName || itemDescription(snapshot, item)?.name || `Item #${item.definition}`;
}
export function itemDescription(snapshot: InventorySnapshot, item: InventoryItem) {
  return snapshot.itemDescriptions?.[item.id] ?? snapshot.definitions[item.definition];
}
export function inventoryPage(
  snapshot: InventorySnapshot,
  query: string,
  quality: number | null,
  page: number,
  sort: InventorySort = "position",
) {
  const needle = query.trim().toLocaleLowerCase();
  const filtered = needle.length > 0 || quality !== null || sort !== "position";
  const matches = snapshot.items
    .filter((item) => {
      const definition = itemDescription(snapshot, item);
      return (
        (quality === null || item.quality === quality) &&
        (!needle ||
          [
            itemName(snapshot, item),
            definition?.name,
            definition?.kind,
            ...(snapshot.itemDescriptions?.[item.id]?.details ?? []),
            ...(definition?.classes ?? []),
            item.id,
            String(item.definition),
            QUALITY_NAMES[item.quality],
          ].some((part) => part?.toLocaleLowerCase().includes(needle)))
      );
    })
    .sort((a, b) => {
      const names = () =>
        itemName(snapshot, a).localeCompare(itemName(snapshot, b), undefined, {
          numeric: true,
          sensitivity: "base",
        });
      const order =
        sort === "name"
          ? names()
          : sort === "quality"
            ? (QUALITY_NAMES[a.quality] ?? String(a.quality)).localeCompare(
                QUALITY_NAMES[b.quality] ?? String(b.quality),
              ) || names()
            : sort === "type"
              ? (itemDescription(snapshot, a)?.kind ?? "").localeCompare(
                  itemDescription(snapshot, b)?.kind ?? "",
                ) || names()
              : 0;
      return (
        order ||
        (a.position || Number.MAX_SAFE_INTEGER) - (b.position || Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id)
      );
    });
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
