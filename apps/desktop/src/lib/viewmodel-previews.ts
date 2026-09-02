import type { ViewmodelClass } from "./viewmodel-ui";

/**
 * The "visual image guide" from Yttrium's CompVMInstaller: one in-game
 * first-person screenshot per option (the weapon out) and one blank per class
 * (what you see once it is hidden). Hovering an option shows the picture for
 * its current state; toggling swaps between the two.
 *
 * The images are fetched on demand from the same pinned commit the animation
 * sources come from — never vendored. Names below are the upstream resource
 * stems (`Project/CompVMInstaller/Resources/<name>.jpg`).
 */
export const VIEWMODEL_PREVIEW_CREDIT =
  "Preview screenshots by yttrium and Oblique (CompVMInstaller), fetched from the original project. Team Fortress 2 © Valve Corporation.";

export type ViewmodelSlot = "primary" | "secondary" | "melee" | "pda";

export const VIEWMODEL_SLOT_LABELS: Record<ViewmodelSlot, string> = {
  primary: "Primary",
  secondary: "Secondary",
  melee: "Melee",
  pda: "PDA",
};

export type ViewmodelGroupPreview = {
  /** Upstream screenshot stem shown while the group is visible. */
  image: string;
  slot: ViewmodelSlot;
  /** The weapons the group covers, as CompVMInstaller's tooltips list them. */
  weapons: string;
};

const BLANK_STEMS: Record<ViewmodelClass, string> = {
  scout: "scout_blank",
  soldier: "soldier_blank",
  pyro: "pyro_blank",
  demoman: "demo_blank",
  heavy: "heavy_blank",
  engineer: "engineer_blank",
  medic: "medic_blank",
  sniper: "sniper_blank",
  spy: "spy_blank",
};

/** The empty first-person view for a class — every hidden option shows this. */
export function viewmodelBlankStem(classId: ViewmodelClass): string {
  return BLANK_STEMS[classId];
}

const PRIMARY_INSPECT = "Inspect animations for primary weapons.";
const SECONDARY_INSPECT = "Inspect animations for secondary weapons.";

/** Group id (see viewmodel-groups.ts) → preview image and blurb. */
export const VIEWMODEL_GROUP_PREVIEWS: Record<string, ViewmodelGroupPreview> = {
  "scout/scatterguns": {
    image: "scout_scattergun",
    slot: "primary",
    weapons: "Scattergun, Baby Face's Blaster, Back Scatter",
  },
  "scout/double-barrels": {
    image: "scout_fan",
    slot: "primary",
    weapons: "Force-A-Nature, Soda Popper",
  },
  "scout/shortstop": { image: "scout_shortstop", slot: "primary", weapons: "Shortstop" },
  "scout/shortstop-push": {
    image: "scout_push",
    slot: "primary",
    weapons: "The shove on the Shortstop's alternate fire",
  },
  "scout/primary-inspect": {
    image: "scout_scattergun_inspect",
    slot: "primary",
    weapons: PRIMARY_INSPECT,
  },
  "scout/pistols": {
    image: "scout_pistol",
    slot: "secondary",
    weapons: "Pistol, Winger, Pretty Boy's Pocket Pistol",
  },
  "scout/throwables": {
    image: "scout_milk",
    slot: "secondary",
    weapons: "Mad Milk, Flying Guillotine",
  },
  "scout/drinks": {
    image: "scout_drink",
    slot: "secondary",
    weapons: "Bonk! Atomic Punch, Crit-a-Cola",
  },
  "scout/secondary-inspect": {
    image: "scout_pistol_inspect",
    slot: "secondary",
    weapons: SECONDARY_INSPECT,
  },
  "scout/melee": { image: "scout_melee", slot: "melee", weapons: "Every Scout melee weapon" },

  "sniper/rifles": {
    image: "sniper_sniperrifle",
    slot: "primary",
    weapons: "Sniper Rifle, Machina, Hitman's Heatmaker, Bazaar Bargain, Classic",
  },
  "sniper/huntsman": { image: "sniper_huntsman", slot: "primary", weapons: "Huntsman" },
  "sniper/primary-inspect": {
    image: "sniper_sniperrifle_inspect",
    slot: "primary",
    weapons: PRIMARY_INSPECT,
  },
  "sniper/smgs": {
    image: "sniper_smg",
    slot: "secondary",
    weapons: "Submachine Gun, Cleaner's Carbine",
  },
  "sniper/throwables": { image: "sniper_jarate", slot: "secondary", weapons: "Jarate" },
  "sniper/secondary-inspect": {
    image: "sniper_smg_inspect",
    slot: "secondary",
    weapons: SECONDARY_INSPECT,
  },
  "sniper/melee": { image: "sniper_melee", slot: "melee", weapons: "Every Sniper melee weapon" },

  "soldier/rockets": {
    image: "soldier_rocketlauncher",
    slot: "primary",
    weapons: "Rocket Launcher, Direct Hit, Black Box, Air Strike, Cow Mangler",
  },
  "soldier/primary-inspect": {
    image: "soldier_rocketlauncher_inspect",
    slot: "primary",
    weapons: PRIMARY_INSPECT,
  },
  "soldier/shotguns": {
    image: "soldier_shotgun",
    slot: "secondary",
    weapons: "Shotgun, Reserve Shooter, Panic Attack",
  },
  "soldier/banners": {
    image: "soldier_banner",
    slot: "secondary",
    weapons: "Buff Banner, Battalion's Backup, Concheror",
  },
  "soldier/bison": { image: "soldier_bison", slot: "secondary", weapons: "Righteous Bison" },
  "soldier/secondary-inspect": {
    image: "soldier_shotgun_inspect",
    slot: "secondary",
    weapons: SECONDARY_INSPECT,
  },
  "soldier/melee": { image: "soldier_melee", slot: "melee", weapons: "Every Soldier melee weapon" },

  "demoman/grenades": {
    image: "demo_grenadelauncher",
    slot: "primary",
    weapons: "Grenade Launcher, Loch-n-Load, Loose Cannon, Iron Bomber",
  },
  "demoman/primary-inspect": {
    image: "demo_grenadelauncher_inspect",
    slot: "primary",
    weapons: PRIMARY_INSPECT,
  },
  "demoman/stickybombs": {
    image: "demo_stickybomb",
    slot: "secondary",
    weapons: "Stickybomb Launcher, Scottish Resistance, Sticky Jumper, Quickiebomb Launcher",
  },
  "demoman/secondary-inspect": {
    image: "demo_stickybomb_inspect",
    slot: "secondary",
    weapons: SECONDARY_INSPECT,
  },
  "demoman/melee": { image: "demo_melee", slot: "melee", weapons: "Every Demoman melee weapon" },

  "medic/primaries": {
    image: "medic_syringegun",
    slot: "primary",
    weapons: "Syringe Gun, Blutsauger, Crusader's Crossbow, Overdose",
  },
  "medic/primary-inspect": {
    image: "medic_syringegun",
    slot: "primary",
    weapons: PRIMARY_INSPECT,
  },
  "medic/mediguns": {
    image: "medic_medigun",
    slot: "secondary",
    weapons: "Medi Gun, Kritzkrieg, Quick-Fix, Vaccinator",
  },
  "medic/secondary-inspect": {
    image: "medic_medigun_inspect",
    slot: "secondary",
    weapons: SECONDARY_INSPECT,
  },
  "medic/melee": { image: "medic_melee", slot: "melee", weapons: "Every Medic melee weapon" },

  "heavy/miniguns": {
    image: "heavy_minigun",
    slot: "primary",
    weapons: "Minigun, Natascha, Brass Beast, Tomislav, Huo-Long Heater",
  },
  "heavy/primary-inspect": {
    image: "heavy_minigun_inspect",
    slot: "primary",
    weapons: PRIMARY_INSPECT,
  },
  "heavy/shotguns": {
    image: "heavy_shotgun",
    slot: "secondary",
    weapons: "Shotgun, Family Business, Panic Attack",
  },
  "heavy/consumables": {
    image: "heavy_sandvich",
    slot: "secondary",
    weapons: "Sandvich, Dalokohs Bar, Buffalo Steak Sandvich",
  },
  "heavy/secondary-inspect": {
    image: "heavy_shotgun_inspect",
    slot: "secondary",
    weapons: SECONDARY_INSPECT,
  },
  "heavy/melee": { image: "heavy_fists", slot: "melee", weapons: "Every Heavy melee weapon" },

  "pyro/flamethrowers": {
    image: "pyro_flamethrower",
    slot: "primary",
    weapons: "Flame Thrower, Backburner, Degreaser, Phlogistinator, Dragon's Fury",
  },
  "pyro/primary-inspect": {
    image: "pyro_flamethrower_inspect",
    slot: "primary",
    weapons: PRIMARY_INSPECT,
  },
  "pyro/shotguns": {
    image: "pyro_shotgun",
    slot: "secondary",
    weapons: "Shotgun, Reserve Shooter, Panic Attack",
  },
  "pyro/flare-guns": {
    image: "pyro_flaregun",
    slot: "secondary",
    weapons: "Flare Gun, Detonator, Manmelter, Scorch Shot",
  },
  "pyro/thermal-thruster": {
    image: "pyro_thermalthruster",
    slot: "secondary",
    weapons: "Thermal Thruster",
  },
  "pyro/gas-passer": { image: "pyro_gaspasser", slot: "secondary", weapons: "Gas Passer" },
  "pyro/secondary-inspect": {
    image: "pyro_shotgun_inspect",
    slot: "secondary",
    weapons: SECONDARY_INSPECT,
  },
  "pyro/melee": { image: "pyro_melee", slot: "melee", weapons: "Every Pyro melee weapon" },

  "spy/revolvers": {
    image: "spy_revolver",
    slot: "primary",
    weapons: "Revolver, Ambassador, L'Etranger, Enforcer, Diamondback",
  },
  "spy/primary-inspect": {
    image: "spy_revolver_inspect",
    slot: "primary",
    weapons: PRIMARY_INSPECT,
  },
  "spy/sappers": { image: "spy_sapper", slot: "secondary", weapons: "Sapper, Red-Tape Recorder" },
  "spy/melee": {
    image: "spy_knife",
    slot: "melee",
    weapons: "Knife, Your Eternal Reward, Conniver's Kunai, Big Earner, Spy-cicle",
  },
  "spy/melee-inspect": {
    image: "spy_knife_inspect",
    slot: "melee",
    weapons: "Inspect animations for knives.",
  },

  "engineer/shotguns": {
    image: "engineer_shotgun",
    slot: "primary",
    weapons: "Shotgun, Frontier Justice, Widowmaker, Rescue Ranger, Panic Attack",
  },
  "engineer/pomson": { image: "engineer_pomson", slot: "primary", weapons: "Pomson 6000" },
  "engineer/primary-inspect": {
    image: "engineer_shotgun_inspect",
    slot: "primary",
    weapons: PRIMARY_INSPECT,
  },
  "engineer/pistols": { image: "engineer_pistol", slot: "secondary", weapons: "Pistol" },
  "engineer/wrangler": { image: "engineer_wrangler", slot: "secondary", weapons: "Wrangler" },
  "engineer/secondary-inspect": {
    image: "engineer_pistol_inspect",
    slot: "secondary",
    weapons: SECONDARY_INSPECT,
  },
  "engineer/wrenches": {
    image: "engineer_wrench",
    slot: "melee",
    weapons: "Wrench, Southern Hospitality, Jag, Eureka Effect",
  },
  "engineer/gunslinger": { image: "engineer_gunslinger", slot: "melee", weapons: "Gunslinger" },
  "engineer/melee-inspect": {
    image: "engineer_wrench_inspect",
    slot: "melee",
    weapons: "Inspect animations for wrenches.",
  },
  "engineer/pda": {
    image: "engineer_pda_build",
    slot: "pda",
    weapons: "Construction and Destruction PDAs",
  },
  "engineer/toolbox": {
    image: "engineer_toolbox",
    slot: "pda",
    weapons: "The carried toolbox while placing or hauling a building",
  },
};

/** Preview details for a group id, with a safe fallback for an unknown id. */
export function viewmodelGroupPreview(groupId: string): ViewmodelGroupPreview | null {
  return VIEWMODEL_GROUP_PREVIEWS[groupId] ?? null;
}

/** The screenshot stem a group shows right now: its weapon, or the blank once hidden. */
export function viewmodelStemForGroup(
  classId: ViewmodelClass,
  groupId: string,
  hidden: boolean,
): string {
  if (hidden) {
    return viewmodelBlankStem(classId);
  }
  return viewmodelGroupPreview(groupId)?.image ?? viewmodelBlankStem(classId);
}

/** Slot order the pane lists groups in. */
export const VIEWMODEL_SLOTS: ViewmodelSlot[] = ["primary", "secondary", "melee", "pda"];

/** Real first-person renders from the Official TF2 Wiki, vendored — used only
 * where the CompVMInstaller screenshots cannot be fetched (browser preview). */
const FALLBACK_SHOTS = import.meta.glob("../assets/viewmodels/*.webp", {
  eager: true,
  import: "default",
}) as Record<string, string>;

export function viewmodelFallbackSrc(classId: ViewmodelClass, slot: ViewmodelSlot): string | null {
  return FALLBACK_SHOTS[`../assets/viewmodels/${classId}-${slot}.webp`] ?? null;
}
