import type { CrosshairRecord } from "./bridge";

export const EXECS_CROSSHAIRS_PACK = "execs-crosshairs";
export const EXECS_CROSSHAIRS_PREFIX = `tf/custom/${EXECS_CROSSHAIRS_PACK}/`;
export const CROSSHAIR_THUMBNAIL_DIR = "materials/vgui/replay/thumbnails";
export const CROSSHAIR_SCRIPTS_DIR = "scripts";
export const CROSSHAIR_CANVAS_SIZE = 64;

export const CROSSHAIR_SHAPES = ["dot", "cross", "plus-gap", "circle", "t"] as const;
export const CUSTOM_CROSSHAIR_SHAPE = "custom";
export type CrosshairShape = (typeof CROSSHAIR_SHAPES)[number] | typeof CUSTOM_CROSSHAIR_SHAPE;

export const TF2_CLASSES = [
  "scout",
  "soldier",
  "pyro",
  "demoman",
  "heavy",
  "engineer",
  "medic",
  "sniper",
  "spy",
] as const;

export type Tf2Class = (typeof TF2_CLASSES)[number];

export type WeaponCatalogEntry = {
  script: string;
  label: string;
  classId: Tf2Class;
  slot: "primary" | "secondary" | "melee" | "pda" | "other";
};

/** Filenames only — Valve script bodies are read from the user's local TF2 install. */
export const WEAPON_CATALOG: WeaponCatalogEntry[] = [
  { script: "tf_weapon_scattergun", label: "Scattergun", classId: "scout", slot: "primary" },
  { script: "tf_weapon_handgun_scout_primary", label: "Shortstop", classId: "scout", slot: "primary" },
  { script: "tf_weapon_pep_brawler_blaster", label: "Baby Face's Blaster", classId: "scout", slot: "primary" },
  { script: "tf_weapon_soda_popper", label: "Soda Popper", classId: "scout", slot: "primary" },
  { script: "tf_weapon_pistol_scout", label: "Pistol", classId: "scout", slot: "secondary" },
  { script: "tf_weapon_lunchbox_drink", label: "Bonk / Crit-a-Cola", classId: "scout", slot: "secondary" },
  { script: "tf_weapon_jar_milk", label: "Mad Milk", classId: "scout", slot: "secondary" },
  { script: "tf_weapon_handgun_scout_secondary", label: "Winger / Pocket Pistol", classId: "scout", slot: "secondary" },
  { script: "tf_weapon_bat", label: "Bat", classId: "scout", slot: "melee" },
  { script: "tf_weapon_bat_fish", label: "Holy Mackerel", classId: "scout", slot: "melee" },
  { script: "tf_weapon_bat_giftwrap", label: "Wrap Assassin", classId: "scout", slot: "melee" },
  { script: "tf_weapon_bat_wood", label: "Sandman", classId: "scout", slot: "melee" },
  { script: "tf_weapon_rocketlauncher", label: "Rocket Launcher", classId: "soldier", slot: "primary" },
  { script: "tf_weapon_rocketlauncher_directhit", label: "Direct Hit", classId: "soldier", slot: "primary" },
  { script: "tf_weapon_rocketlauncher_airstrike", label: "Air Strike", classId: "soldier", slot: "primary" },
  { script: "tf_weapon_particle_cannon", label: "Cow Mangler", classId: "soldier", slot: "primary" },
  { script: "tf_weapon_shotgun_soldier", label: "Shotgun", classId: "soldier", slot: "secondary" },
  { script: "tf_weapon_raygun", label: "Righteous Bison", classId: "soldier", slot: "secondary" },
  { script: "tf_weapon_buff_item", label: "Banners", classId: "soldier", slot: "secondary" },
  { script: "tf_weapon_parachute", label: "B.A.S.E. Jumper", classId: "soldier", slot: "secondary" },
  { script: "tf_weapon_shovel", label: "Shovel", classId: "soldier", slot: "melee" },
  { script: "tf_weapon_katana", label: "Half-Zatoichi", classId: "soldier", slot: "melee" },
  { script: "tf_weapon_flamethrower", label: "Flamethrower", classId: "pyro", slot: "primary" },
  { script: "tf_weapon_rocketlauncher_fireball", label: "Dragon's Fury", classId: "pyro", slot: "primary" },
  { script: "tf_weapon_flaregun", label: "Flare Gun", classId: "pyro", slot: "secondary" },
  { script: "tf_weapon_flaregun_revenge", label: "Manmelter", classId: "pyro", slot: "secondary" },
  { script: "tf_weapon_shotgun_pyro", label: "Shotgun", classId: "pyro", slot: "secondary" },
  { script: "tf_weapon_jar_gas", label: "Gas Passer", classId: "pyro", slot: "secondary" },
  { script: "tf_weapon_rocketpack", label: "Thermal Thruster", classId: "pyro", slot: "secondary" },
  { script: "tf_weapon_fireaxe", label: "Fire Axe", classId: "pyro", slot: "melee" },
  { script: "tf_weapon_breakable_sign", label: "Neon Annihilator", classId: "pyro", slot: "melee" },
  { script: "tf_weapon_slap", label: "Hot Hand", classId: "pyro", slot: "melee" },
  { script: "tf_weapon_grenadelauncher", label: "Grenade Launcher", classId: "demoman", slot: "primary" },
  { script: "tf_weapon_cannon", label: "Loose Cannon", classId: "demoman", slot: "primary" },
  { script: "tf_weapon_pipebomblauncher", label: "Stickybomb Launcher", classId: "demoman", slot: "secondary" },
  { script: "tf_weapon_parachute_secondary", label: "B.A.S.E. Jumper", classId: "demoman", slot: "secondary" },
  { script: "tf_weapon_bottle", label: "Bottle", classId: "demoman", slot: "melee" },
  { script: "tf_weapon_sword", label: "Eyelander", classId: "demoman", slot: "melee" },
  { script: "tf_weapon_stickbomb", label: "Ullapool Caber", classId: "demoman", slot: "melee" },
  { script: "tf_weapon_minigun", label: "Minigun", classId: "heavy", slot: "primary" },
  { script: "tf_weapon_shotgun_hwg", label: "Shotgun", classId: "heavy", slot: "secondary" },
  { script: "tf_weapon_lunchbox", label: "Sandvich", classId: "heavy", slot: "secondary" },
  { script: "tf_weapon_fists", label: "Fists", classId: "heavy", slot: "melee" },
  { script: "tf_weapon_shotgun_primary", label: "Shotgun", classId: "engineer", slot: "primary" },
  { script: "tf_weapon_sentry_revenge", label: "Frontier Justice", classId: "engineer", slot: "primary" },
  { script: "tf_weapon_drg_pomson", label: "Pomson", classId: "engineer", slot: "primary" },
  { script: "tf_weapon_shotgun_building_rescue", label: "Rescue Ranger", classId: "engineer", slot: "primary" },
  { script: "tf_weapon_pistol", label: "Pistol", classId: "engineer", slot: "secondary" },
  { script: "tf_weapon_mechanical_arm", label: "Short Circuit", classId: "engineer", slot: "secondary" },
  { script: "tf_weapon_laser_pointer", label: "Wrangler", classId: "engineer", slot: "secondary" },
  { script: "tf_weapon_wrench", label: "Wrench", classId: "engineer", slot: "melee" },
  { script: "tf_weapon_robot_arm", label: "Gunslinger", classId: "engineer", slot: "melee" },
  { script: "tf_weapon_pda_engineer_build", label: "Build PDA", classId: "engineer", slot: "pda" },
  { script: "tf_weapon_pda_engineer_destroy", label: "Destroy PDA", classId: "engineer", slot: "pda" },
  { script: "tf_weapon_builder", label: "Toolbox", classId: "engineer", slot: "pda" },
  { script: "tf_weapon_syringegun_medic", label: "Syringe Gun", classId: "medic", slot: "primary" },
  { script: "tf_weapon_crossbow", label: "Crusader's Crossbow", classId: "medic", slot: "primary" },
  { script: "tf_weapon_medigun", label: "Medi Gun", classId: "medic", slot: "secondary" },
  { script: "tf_weapon_bonesaw", label: "Bonesaw", classId: "medic", slot: "melee" },
  { script: "tf_weapon_sniperrifle", label: "Sniper Rifle", classId: "sniper", slot: "primary" },
  { script: "tf_weapon_sniperrifle_decap", label: "Bazaar Bargain", classId: "sniper", slot: "primary" },
  { script: "tf_weapon_sniperrifle_classic", label: "Classic", classId: "sniper", slot: "primary" },
  { script: "tf_weapon_compound_bow", label: "Huntsman", classId: "sniper", slot: "primary" },
  { script: "tf_weapon_charged_smg", label: "Cleaner's Carbine", classId: "sniper", slot: "secondary" },
  { script: "tf_weapon_smg", label: "SMG", classId: "sniper", slot: "secondary" },
  { script: "tf_weapon_jar", label: "Jarate", classId: "sniper", slot: "secondary" },
  { script: "tf_weapon_club", label: "Kukri", classId: "sniper", slot: "melee" },
  { script: "tf_weapon_revolver", label: "Revolver", classId: "spy", slot: "primary" },
  { script: "tf_weapon_knife", label: "Knife", classId: "spy", slot: "melee" },
  { script: "tf_weapon_pda_spy", label: "Disguise Kit", classId: "spy", slot: "pda" },
  { script: "tf_weapon_invis", label: "Invis Watch", classId: "spy", slot: "pda" },
  { script: "tf_weapon_sapper", label: "Sapper", classId: "spy", slot: "pda" },
  { script: "tf_weapon_builder_spy", label: "Red-Tape Recorder", classId: "spy", slot: "pda" },
];

export const CROSSHAIR_CASUAL_COPY =
  "Per-weapon VTF crosshairs usually work on Valve Casual when they live under replay/thumbnails. Set the Gameplay stock crosshair file to Default/None or they will not show.";

export const CROSSHAIR_STOCK_OVERRIDE_NOTE =
  "Gameplay stock crosshair file overrides custom VTF. Set it to Default/None.";

export type CrosshairDraft = {
  shape: CrosshairShape;
  assignments: Record<string, CrosshairShape>;
  customRgba: number[] | null;
};

export function emptyCrosshairDraft(): CrosshairDraft {
  return { shape: "cross", assignments: {}, customRgba: null };
}

export function seedCrosshairDraft(record: CrosshairRecord | null | undefined): CrosshairDraft {
  const raw = record?.shape ?? "cross";
  const shape = isCrosshairShape(raw) ? raw : "cross";
  const assignments: Record<string, CrosshairShape> = {};
  for (const [script, value] of Object.entries(record?.assignments ?? {})) {
    if (isCrosshairShape(value)) {
      assignments[script] = value;
    }
  }
  return { shape, assignments, customRgba: null };
}

export function assignmentFor(draft: CrosshairDraft, script: string): CrosshairShape {
  return draft.assignments[script] ?? draft.shape;
}

export function weaponsForClass(classId: Tf2Class): WeaponCatalogEntry[] {
  return WEAPON_CATALOG.filter((weapon) => weapon.classId === classId);
}

export function isCrosshairShape(value: string): value is CrosshairShape {
  return value === CUSTOM_CROSSHAIR_SHAPE || CROSSHAIR_SHAPES.includes(value as (typeof CROSSHAIR_SHAPES)[number]);
}

/** Draw a first-party shape into a 64×64 RGBA buffer (row-major, unpremultiplied). */
export function renderCrosshairRgba(shape: CrosshairShape): Uint8ClampedArray {
  const size = CROSSHAIR_CANVAS_SIZE;
  const pixels = new Uint8ClampedArray(size * size * 4);
  const set = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= size || y >= size) {
      return;
    }
    const i = (y * size + x) * 4;
    pixels[i] = 255;
    pixels[i + 1] = 255;
    pixels[i + 2] = 255;
    pixels[i + 3] = 255;
  };
  const mid = Math.floor(size / 2);
  switch (shape) {
    case "dot":
      for (let y = mid - 1; y <= mid + 1; y += 1) {
        for (let x = mid - 1; x <= mid + 1; x += 1) {
          set(x, y);
        }
      }
      break;
    case "cross":
      for (let i = 8; i < size - 8; i += 1) {
        set(mid, i);
        set(i, mid);
      }
      break;
    case "plus-gap":
      for (let i = 8; i < mid - 3; i += 1) {
        set(mid, i);
        set(mid, size - 1 - i);
        set(i, mid);
        set(size - 1 - i, mid);
      }
      break;
    case "circle": {
      const r = 12;
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const dx = x - mid + 0.5;
          const dy = y - mid + 0.5;
          const d = Math.hypot(dx, dy);
          if (Math.abs(d - r) < 0.85) {
            set(x, y);
          }
        }
      }
      break;
    }
    case "t":
      for (let x = mid - 10; x <= mid + 10; x += 1) {
        set(x, mid - 8);
      }
      for (let y = mid - 8; y <= mid + 12; y += 1) {
        set(mid, y);
      }
      break;
    case "custom":
      break;
    default:
      break;
  }
  return pixels;
}

export function previewCrosshairRecord(): CrosshairRecord {
  return {
    id: EXECS_CROSSHAIRS_PACK,
    shape: "cross",
    assignments: { tf_weapon_scattergun: "dot" },
  };
}
