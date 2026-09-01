import type { ViewmodelClass } from "./viewmodel-ui";

/** Slots with real first-person imagery (stock loadouts). */
export const VIEWMODEL_PREVIEW_SLOTS = ["primary", "secondary", "melee"] as const;

export type ViewmodelPreviewSlot = (typeof VIEWMODEL_PREVIEW_SLOTS)[number];

export const VIEWMODEL_PREVIEW_CREDIT =
  "Weapon imagery: Team Fortress 2 © Valve Corporation, via the Official TF2 Wiki.";

/** Real first-person renders (weapon + class hands) vendored from the Official
 * TF2 Wiki's transparent HLMV captures — one per class and slot. */
const SHOTS = import.meta.glob("../assets/viewmodels/*.webp", {
  eager: true,
  import: "default",
}) as Record<string, string>;

export function viewmodelPreviewSrc(
  classId: ViewmodelClass,
  slot: ViewmodelPreviewSlot,
): string | null {
  return SHOTS[`../assets/viewmodels/${classId}-${slot}.webp`] ?? null;
}

/** The visibility group holding the stock weapon each preview shows, so the
 * imagery can reflect what the current selection actually hides. Ids must match
 * `viewmodel-groups.ts`. */
export const VIEWMODEL_PREVIEW_GROUPS: Record<
  ViewmodelClass,
  Partial<Record<ViewmodelPreviewSlot, string>>
> = {
  scout: { primary: "scout/scatterguns", secondary: "scout/pistols", melee: "scout/melee" },
  soldier: { primary: "soldier/rockets", secondary: "soldier/shotguns", melee: "soldier/melee" },
  pyro: { primary: "pyro/flamethrowers", secondary: "pyro/shotguns", melee: "pyro/melee" },
  demoman: {
    primary: "demoman/grenades",
    secondary: "demoman/stickybombs",
    melee: "demoman/melee",
  },
  heavy: { primary: "heavy/miniguns", secondary: "heavy/shotguns", melee: "heavy/melee" },
  engineer: {
    primary: "engineer/shotguns",
    secondary: "engineer/pistols",
    melee: "engineer/wrenches",
  },
  medic: { primary: "medic/primaries", secondary: "medic/mediguns", melee: "medic/melee" },
  sniper: { primary: "sniper/rifles", secondary: "sniper/smgs", melee: "sniper/melee" },
  spy: { primary: "spy/revolvers", melee: "spy/melee" },
};

/** Whether the weapon in this preview is hidden by the current selection. */
export function previewSlotHidden(
  classId: ViewmodelClass,
  slot: ViewmodelPreviewSlot,
  hidden: Set<string>,
): boolean {
  const group = VIEWMODEL_PREVIEW_GROUPS[classId][slot];
  return group !== undefined && hidden.has(group);
}

/** Stock-loadout weapon names, for captions under the preview imagery. */
export const VIEWMODEL_PREVIEW_WEAPONS: Record<
  ViewmodelClass,
  Partial<Record<ViewmodelPreviewSlot, string>>
> = {
  scout: { primary: "Scattergun", secondary: "Pistol", melee: "Bat" },
  soldier: { primary: "Rocket Launcher", secondary: "Shotgun", melee: "Shovel" },
  pyro: { primary: "Flamethrower", secondary: "Shotgun", melee: "Fire Axe" },
  demoman: { primary: "Grenade Launcher", secondary: "Stickybomb Launcher", melee: "Bottle" },
  heavy: { primary: "Minigun", secondary: "Shotgun", melee: "Fists" },
  engineer: { primary: "Shotgun", secondary: "Pistol", melee: "Wrench" },
  medic: { primary: "Syringe Gun", secondary: "Medi Gun", melee: "Bonesaw" },
  sniper: { primary: "Sniper Rifle", secondary: "SMG", melee: "Kukri" },
  spy: { primary: "Revolver", melee: "Knife" },
};
