import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * A promo backpack for the Inventory pane's simulator, built from the owner's
 * own Inventory art cache (`<data dir>/inventory-art`, Valve's public item
 * renders and Steam text for their items). No Steam name, avatar, account or
 * item ID reaches the page: IDs are synthetic, lines that name a player
 * ("Crafted by …") are dropped, and so is anything the player wrote: custom
 * names and description tags give way to the item's own name. Moves, sorts,
 * crafts and deletes run in the app's own simulator; Steam is never contacted.
 */
type CachedItem = {
  image: string;
  name: string;
  marketName: string | null;
  nameColor: string | null;
  typeLine: string;
  lines: { text: string; color: string | null; user: boolean }[];
  originalName?: string | null;
};

/** TF2 quality ids by Steam name colour. */
const QUALITY_BY_COLOUR: Record<string, number> = {
  "#B2B2B2": 0,
  "#4D7455": 1,
  "#476291": 3,
  "#8650AC": 5,
  "#7D6D00": 6,
  "#70B04A": 7,
  "#A50F79": 8,
  "#CF6A32": 11,
  "#38F3AB": 13,
  "#AA0000": 14,
  "#FAFAFA": 15,
};

/** Definitions the app's crafting recipes and sorting know by number. */
const KNOWN_DEFINITIONS: Record<string, number> = {
  "Scrap Metal": 5000,
  "Reclaimed Metal": 5001,
  "Refined Metal": 5002,
  "Mann Co. Supply Crate Key": 5021,
};

/** Page one, in slot order: a mixed-up backpack with something of every quality. */
const FIRST_PAGE = [
  "Unusual Nightcap",
  "Strange Sniper Rifle",
  "Haunted Freedom Feathers",
  "Dragon Slayer Sniper Rifle",
  "Mann Co. Supply Crate Key",
  "Strange Carbonado Botkiller Rocket Launcher Mk.I",
  "Genuine Jaunty Voyager",
  "Refined Metal",
  "Strange Balloonicorn",
  "Unusual Epilogue Locks",
  "Festivized Smissmas Sweater Rocket Launcher",
  "Scrap Metal",
  "Strange Kukri",
  "Haunted Idiot Box",
  "Tour of Duty Ticket",
  "Strange Leopard Printed Wrench",
  "Reclaimed Metal",
  "The Lone Star",
  "Strange Cardboard Boxed Medi Gun",
  "Scrap Metal",
  "Unusual Taunt: Scorcher's Solo",
  "Haunted Bonedolier",
  "Refined Metal",
  "Strange Bomb Carrier Minigun",
  "Scrap Metal",
  "Honcho's Headgear",
  "Festivized Smissmas Sweater Medi Gun",
  "Strange Scattergun",
  "The Spirit of Giving",
  "Reclaimed Metal",
  "Strange Lumbercap",
  "Mann Co. Supply Crate Key",
  "Haunted External Organ",
  "Strange Ambassador",
  "The Koala Compact",
  "Battle-Worn Robot Money Furnace",
  "Strange Rugged Rags",
  "Refined Metal",
  "Strange Kiss King",
  "Refined Metal",
  "Haunted Ethereal Hood",
  "Strange Natascha",
  "Festivized Smissmas Sweater Loose Cannon",
  "The Proof of Purchase",
  "Strange Eye-Catcher",
  "Reclaimed Metal",
  "Strange Boarder's Beanie",
  "Gift Wrap",
  "Strange Puffed Practitioner",
  "Scrap Metal",
];

/** The hat the simulated random-hat craft reveals. */
const REVEALED_HAT = "Noble Amassment of Hats";

const PLAYER_LINE = /^(Crafted by|Gift from|Made by|Signed by|Painted by|Created by)\b/i;

function kindOf(item: CachedItem): string {
  const type = item.typeLine.replace(/^Level \d+ /, "").replace(/ - .*$/, "");
  const strange = type.replace(/^(Strange|Unusual|Genuine|Haunted|Vintage) /, "");
  if (strange) return strange;
  if (/War Paint$/.test(item.name)) return "War Paint";
  return "Weapon";
}

export type PromoBackpack = ReturnType<typeof buildPromoBackpack>;

export function buildPromoBackpack(dataDir: string) {
  const artDir = path.join(dataDir, "inventory-art");
  const cacheFile = existsSync(artDir)
    ? readdirSync(artDir).find((name) => /^\d+\.json$/.test(name))
    : undefined;
  if (!cacheFile) return null;
  const cached = Object.values(
    JSON.parse(readFileSync(path.join(artDir, cacheFile), "utf8")) as Record<string, CachedItem>,
  );

  // Page one as designed, then everything else in the cache's order.
  const pool = [...cached];
  const take = (name: string) => {
    const index = pool.findIndex((item) => item.name === name);
    return index === -1 ? null : pool.splice(index, 1)[0];
  };
  const ordered: (CachedItem | null)[] = FIRST_PAGE.map(take);
  ordered.push(...pool);

  const definitions: Record<number, { name: string; kind: string; classes: string[]; icon: null }> =
    {};
  const artByDefinition: Record<number, string> = {};
  let nextDefinition = 20000;
  const definitionFor = (item: CachedItem) => {
    const base = item.marketName ?? item.name;
    const known = KNOWN_DEFINITIONS[base];
    const existing = Object.entries(definitions).find(([, value]) => value.name === base);
    const id = known ?? (existing ? Number(existing[0]) : nextDefinition++);
    definitions[id] ??= { name: base, kind: kindOf(item), classes: [], icon: null };
    artByDefinition[id] ??= item.image;
    return id;
  };

  const items: {
    id: string;
    definition: number;
    position: number;
    quality: number;
    level: number;
    customName: string | null;
  }[] = [];
  const steam: Record<string, Omit<CachedItem, "originalName"> & { originalName: string | null }> =
    {};
  const eligibility: Record<
    string,
    { craftable: boolean; tradable: boolean; customized: boolean; deletable: boolean }
  > = {};
  let serial = 11_000_000_000n;
  ordered.forEach((item, index) => {
    if (!item) return;
    serial += 1n;
    const id = serial.toString();
    const definition = definitionFor(item);
    const quality = QUALITY_BY_COLOUR[(item.nameColor ?? "").toUpperCase()] ?? 6;
    // A player's own name for an item gives way to the item's real name.
    const renamed = /^''.*''$/.test(item.name);
    items.push({
      id,
      definition,
      position: index + 1,
      quality,
      level: Number(/^Level (\d+)/.exec(item.typeLine)?.[1] ?? 1),
      customName: null,
    });
    steam[id] = {
      image: item.image,
      name: renamed ? (item.originalName ?? item.marketName ?? "Item") : item.name,
      marketName: item.marketName,
      nameColor: item.nameColor,
      typeLine: item.typeLine,
      lines: item.lines.filter((line) => !line.user && !PLAYER_LINE.test(line.text.trim())),
      originalName: null,
    };
    eligibility[id] = {
      craftable: definition >= 5000 && definition <= 5002,
      tradable: true,
      customized: quality !== 6,
      deletable: true,
    };
  });

  const hat = cached.find((item) => item.name === REVEALED_HAT);
  const hatDefinition = hat ? definitionFor(hat) : null;

  return {
    // Everything past page one is protected, so sorting rearranges page one in
    // place and the app reports that protected items stayed put.
    protectedIds: items.filter((item) => item.position > 50).map((item) => item.id),
    snapshot: {
      steamId: "Promo backpack",
      personaName: "",
      avatar: null,
      capacity: 3000,
      warning: null,
      items,
      definitions,
      itemDescriptions: {},
      craftingEligibility: eligibility,
    },
    steam,
    artByDefinition,
    hat: hatDefinition === null ? null : { definition: hatDefinition, name: REVEALED_HAT },
  };
}

/** The cached PNG for a Steam image name, as the app stores it; 360 falls back to 192. */
export function promoArtFile(dataDir: string, image: string, size: number): string | null {
  const digest = createHash("sha256").update(image).digest("hex").slice(0, 32);
  for (const candidate of [size, 192]) {
    const file = path.join(dataDir, "inventory-art", "images", `${digest}-${candidate}.png`);
    if (existsSync(file)) return file;
  }
  return null;
}
