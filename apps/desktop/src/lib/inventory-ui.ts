import type { InventoryItem, InventorySnapshot, SteamItem, SteamItemLine } from "./bridge";

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
/** What TF2 shows as the item's name: a Name Tag in quotes, otherwise Valve's
 * full name ("Strange Professional Killstreak Rocket Launcher") when known. */
export function itemTitle(snapshot: InventorySnapshot, item: InventoryItem, steam?: SteamItem) {
  if (item.customName) return `“${item.customName}”`;
  return steam?.name || itemName(snapshot, item);
}
/** The item's own name under a Name Tag, or null when it was not renamed. */
export function originalItemName(
  snapshot: InventorySnapshot,
  item: InventoryItem,
  steam?: SteamItem,
): string | null {
  if (!item.customName) return null;
  if (steam?.marketName) return steam.marketName;
  const base = itemDescription(snapshot, item)?.name ?? steam?.originalName ?? null;
  const quality = item.quality === 6 ? "" : QUALITY_NAMES[item.quality];
  return base && quality ? `${quality} ${base}` : base;
}
/** TF2's second line, such as "Level 1 Rocket Launcher". */
export function itemTypeLine(
  snapshot: InventorySnapshot,
  item: InventoryItem,
  steam?: SteamItem,
): string {
  if (steam?.typeLine) return steam.typeLine;
  const kind = itemDescription(snapshot, item)?.kind;
  return `Level ${item.level}${kind ? ` ${kind}` : ""}`;
}
/** Description lines in TF2's order: Valve's own when known, otherwise what the
 * installed files say, with a description tag last in quotes. */
export function itemLines(
  snapshot: InventorySnapshot,
  item: InventoryItem,
  steam?: SteamItem,
): SteamItemLine[] {
  if (steam?.lines.length) {
    // Blank spacer lines stay as single gaps, never at either end.
    return steam.lines
      .filter(
        (line, index, all) =>
          line.text.trim() || (index > 0 && all[index - 1].text.trim() && index < all.length - 1),
      )
      .map((line) => (line.user ? { ...line, text: quoted(line.text) } : line));
  }
  const lines: SteamItemLine[] = (snapshot.itemDescriptions?.[item.id]?.details ?? []).map(
    (text) => ({ text, color: null, user: false }),
  );
  if (item.customDescription)
    lines.push({ text: quoted(item.customDescription), color: null, user: true });
  return lines;
}
/** Player text in TF2's quotes, whether or not Steam already added its own ''. */
function quoted(text: string): string {
  return `“${text.replace(/^''|''$/g, "").trim()}”`;
}
/** A player's description tag, from Steam's text or the item itself. */
export function itemDescriptionTag(item: InventoryItem, steam?: SteamItem): string | null {
  const tag = steam?.lines.find((line) => line.user)?.text ?? item.customDescription;
  return tag ? quoted(tag) : null;
}
/** Stable item order, shared by browsing and the physical layout planner. */
export function compareInventoryItems(
  snapshot: InventorySnapshot,
  a: InventoryItem,
  b: InventoryItem,
  sort: InventorySort,
): number {
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
      const definition = itemDescription(snapshot, item);
      return (
        (quality === null || item.quality === quality) &&
        (!needle ||
          [
            itemName(snapshot, item),
            item.customDescription,
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
    .sort((a, b) => compareInventoryItems(snapshot, a, b, "position"));
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
