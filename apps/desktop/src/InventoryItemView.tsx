import { Cube } from "@phosphor-icons/react";
import type { CSSProperties, ReactNode } from "react";
import { Loading } from "./components/ui/Spinner";
import type { InventoryItem, InventorySnapshot, SteamItem } from "./lib/bridge";
import {
  itemDescription,
  itemLines,
  itemTitle,
  itemTypeLine,
  originalItemName,
  qualityColor,
} from "./lib/inventory-ui";

function WarPaintArtwork({
  itemIcon,
  pattern,
  large = false,
}: {
  itemIcon?: string;
  pattern?: string;
  large?: boolean;
}) {
  return (
    <div
      className={`inventory-paint-art ${large ? "inventory-paint-art-large" : ""}`}
      aria-hidden="true"
    >
      {itemIcon ? (
        <img draggable={false} src={itemIcon} alt="" className="inventory-paint-icon" />
      ) : pattern ? (
        <img draggable={false} src={pattern} alt="" className="inventory-paint-only-swatch" />
      ) : (
        <Cube size={large ? 40 : 28} className="text-ink-faint" />
      )}
      {itemIcon && pattern ? (
        <img draggable={false} src={pattern} alt="" className="inventory-paint-swatch" />
      ) : null}
    </div>
  );
}

/** A kit shows the weapon it applies to on the kit itself, as TF2 draws it. */
function KitArtwork({
  kit,
  target,
  large = false,
}: {
  kit: string;
  target?: string;
  large?: boolean;
}) {
  return (
    <span className={`inventory-kit-art ${large ? "inventory-kit-art-large" : ""}`}>
      <img draggable={false} src={kit} alt="" className="inventory-kit-icon" />
      {target ? (
        <img draggable={false} src={target} alt="" className="inventory-kit-target" />
      ) : null}
    </span>
  );
}

/**
 * Valve's own render when Steam has one (painted weapons, war paints, kits and
 * painted cosmetics look exactly as in game), otherwise the installed art.
 */
export function inventoryItemArt({
  snapshot,
  item,
  icons,
  steamImage,
  large = false,
  alt = "",
}: {
  snapshot: InventorySnapshot;
  item: InventoryItem;
  icons: Record<string, string>;
  steamImage?: string;
  large?: boolean;
  /** Tiles are labeled by their button; a large image names the item. */
  alt?: string;
}): ReactNode {
  if (steamImage)
    return (
      <img
        draggable={false}
        src={steamImage}
        alt={alt}
        className={large ? "inventory-detail-image" : "inventory-item-art"}
      />
    );
  const path = itemDescription(snapshot, item)?.icon;
  const specific = snapshot.itemDescriptions?.[item.id];
  if (specific?.patternIcon)
    return (
      <WarPaintArtwork
        itemIcon={path ? icons[path] : undefined}
        pattern={icons[specific.patternIcon]}
        large={large}
      />
    );
  if (!path || !icons[path]) return null;
  if (specific?.targetIcon)
    return <KitArtwork kit={icons[path]} target={icons[specific.targetIcon]} large={large} />;
  return (
    <img
      draggable={false}
      src={icons[path]}
      alt={alt}
      className={large ? "inventory-detail-image" : "inventory-item-art"}
    />
  );
}

/** The item's name, original name and TF2 type line, shared by hover and Inspect. */
export function InventoryItemHeading({
  snapshot,
  item,
  steam,
  size = "row",
}: {
  snapshot: InventorySnapshot;
  item: InventoryItem;
  steam?: SteamItem;
  size?: "row" | "section";
}) {
  const original = originalItemName(snapshot, item, steam);
  return (
    <>
      <p
        className={size === "section" ? "inventory-inspect-name" : "t-row"}
        style={{ color: qualityColor(snapshot, item.quality) }}
      >
        {itemTitle(snapshot, item, steam)}
      </p>
      {original ? <p className="inventory-inspect-original">{original}</p> : null}
      <p className="inventory-inspect-type">{itemTypeLine(snapshot, item, steam)}</p>
    </>
  );
}

/** Description lines in TF2's colors; a description tag stays in quotes. */
export function InventoryItemLines({
  snapshot,
  item,
  steam,
  limit,
}: {
  snapshot: InventorySnapshot;
  item: InventoryItem;
  steam?: SteamItem;
  limit?: number;
}) {
  const lines = itemLines(snapshot, item, steam);
  // A short list keeps the description tag, which is the player's own text.
  const shown =
    limit === undefined
      ? lines
      : [
          ...lines.filter((line) => !line.user && line.text.trim()).slice(0, limit),
          ...lines.filter((line) => line.user),
        ];
  if (!shown.length) return null;
  return (
    <ul className="inventory-inspect-lines">
      {shown.map((line, index) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: lines repeat and keep their order.
          key={index}
          data-user={line.user || undefined}
          data-gap={!line.text.trim() || undefined}
          style={line.color ? ({ color: line.color } as CSSProperties) : undefined}
        >
          {line.text.trim() ? line.text : null}
        </li>
      ))}
    </ul>
  );
}

export function InventoryInspect({
  snapshot,
  item,
  steam,
  art,
  artLoading,
  steamNote,
  flags,
}: {
  snapshot: InventorySnapshot;
  item: InventoryItem;
  steam?: SteamItem;
  art: ReactNode;
  artLoading: boolean;
  /** Why Valve's art and text are missing, when they are. */
  steamNote: string | null;
  flags: string[];
}) {
  const meta = [item.position ? `Slot ${item.position}` : "Not placed", ...flags];
  return (
    <section
      aria-label="Item details"
      className="inventory-inspect"
      style={{ "--quality": qualityColor(snapshot, item.quality) } as CSSProperties}
    >
      <div className="inventory-inspect-art">
        {art ?? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-faint">
            <Cube size={40} aria-hidden="true" />
            <span className="t-meta">
              {artLoading ? <Loading>Loading artwork…</Loading> : "Artwork unavailable"}
            </span>
          </div>
        )}
      </div>
      <div className="inventory-inspect-text">
        <InventoryItemHeading snapshot={snapshot} item={item} steam={steam} size="section" />
        <InventoryItemLines snapshot={snapshot} item={item} steam={steam} />
      </div>
      <p className="inventory-inspect-meta">{meta.join(" · ")}</p>
      {steamNote ? <p className="inventory-inspect-note">{steamNote}</p> : null}
    </section>
  );
}
