import type { ViewmodelSourceCatalog } from "./bridge";

type Group = ViewmodelSourceCatalog["groups"][number];
type Item = [id: number, schemaName: string, slot: string, itemClass?: string];

function group(id: string, cls: string, items: Item[], inspect = false): Group {
  return {
    id: `${cls}/${id}`,
    class: cls,
    items: items.map(([itemId, schemaName, slot, itemClass]) => ({
      id: itemId,
      schemaName,
      slot,
      itemClass,
    })),
    animations: [`@${id}`],
    inspect,
    overlaps: [],
    teamVariantsDiffer: false,
  };
}

const scattergun: Item[] = [
  [13, "TF_WEAPON_SCATTERGUN", "primary"],
  [772, "Baby Face's Blaster", "primary"],
  [1103, "The Back Scatter", "primary"],
];
const pistol: Item[] = [
  [23, "TF_WEAPON_PISTOL_SCOUT", "secondary"],
  [449, "The Winger", "secondary"],
  [773, "Pretty Boy's Pocket Pistol", "secondary"],
];
const drink: Item[] = [
  [46, "Bonk! Atomic Punch", "secondary", "tf_weapon_lunchbox_drink"],
  [163, "Crit-a-Cola", "secondary", "tf_weapon_lunchbox_drink"],
  [222, "Mad Milk", "secondary", "tf_weapon_jar_milk"],
];
const bat: Item[] = [
  [0, "TF_WEAPON_BAT", "melee"],
  [44, "The Sandman", "melee"],
  [221, "The Holy Mackerel", "melee"],
  [317, "The Candy Cane", "melee"],
  [325, "The Boston Basher", "melee"],
];

/**
 * A small browser-preview catalog shaped like a real install's Scout and Spy
 * groups. Real catalogs are derived from the player's own TF2 files.
 */
export const PREVIEW_VIEWMODEL_CATALOG: ViewmodelSourceCatalog = {
  status: "provisional",
  catalog: { patchVersion: "preview", catalogSha256: "preview" },
  sourceFingerprints: [{ id: "preview", sha256: "preview" }],
  groups: [
    group("sg", "scout", scattergun),
    group("db", "scout", [
      [45, "The Force-a-Nature", "primary"],
      [448, "The Soda Popper", "primary"],
    ]),
    group("ss", "scout", [[220, "The Shortstop", "primary"]]),
    group("p", "scout", pistol),
    group("ed", "scout", drink),
    group("cleave", "scout", [[812, "The Flying Guillotine", "secondary"]]),
    group("bm_draw", "scout", [[1121, "Mutated Milk", "secondary", "tf_weapon_jar_milk"]]),
    group("b", "scout", bat),
    group("hook", "scout", [[1152, "TF_WEAPON_GRAPPLINGHOOK", "action"]]),
    group("sg-inspect", "scout", scattergun, true),
    group("p-inspect", "scout", pistol, true),
    group("ed-inspect", "scout", drink, true),
    group(
      "breadmonster-inspect",
      "scout",
      [[1121, "Mutated Milk", "secondary", "tf_weapon_jar_milk"]],
      true,
    ),
    group("b-inspect", "scout", bat, true),
    group("rev", "spy", [
      [24, "TF_WEAPON_REVOLVER", "secondary"],
      [61, "The Ambassador", "secondary"],
    ]),
    group("knife", "spy", [
      [4, "TF_WEAPON_KNIFE", "melee"],
      [727, "The Black Rose", "melee"],
    ]),
  ],
  unresolvedItems: [],
  unresolvedRoleCount: 0,
  candidateRoleCount: 0,
};
