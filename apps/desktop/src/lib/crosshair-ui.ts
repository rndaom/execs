import type { CrosshairRecord } from "./bridge";
import { migrateCommunityName } from "./community-crosshairs";

export const EXECS_CROSSHAIRS_PACK = "execs-crosshairs";
export const CROSSHAIR_CANVAS_SIZE = 64;

export const CROSSHAIR_SHAPES = ["dot", "cross", "plus-gap", "circle", "t"] as const;
export const CUSTOM_CROSSHAIR_SHAPE = "custom";
/** Name of the parametric-designer library entry. */
export const DESIGNED_CROSSHAIR_NAME = "designed";
export type BuiltinCrosshairShape =
  | (typeof CROSSHAIR_SHAPES)[number]
  | typeof CUSTOM_CROSSHAIR_SHAPE;
/** Any pack crosshair name: builtin shape, "custom", or a library entry. */
export type CrosshairShape = string;

/** Names must survive VPK paths, VMT text, and material lookups unescaped. */
export function validCrosshairName(name: string): boolean {
  return /^[a-z0-9_-]{1,64}$/.test(name);
}

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
  {
    script: "tf_weapon_handgun_scout_primary",
    label: "Shortstop",
    classId: "scout",
    slot: "primary",
  },
  {
    script: "tf_weapon_pep_brawler_blaster",
    label: "Baby Face's Blaster",
    classId: "scout",
    slot: "primary",
  },
  { script: "tf_weapon_soda_popper", label: "Soda Popper", classId: "scout", slot: "primary" },
  { script: "tf_weapon_pistol_scout", label: "Pistol", classId: "scout", slot: "secondary" },
  {
    script: "tf_weapon_lunchbox_drink",
    label: "Bonk / Crit-a-Cola",
    classId: "scout",
    slot: "secondary",
  },
  { script: "tf_weapon_jar_milk", label: "Mad Milk", classId: "scout", slot: "secondary" },
  {
    script: "tf_weapon_handgun_scout_secondary",
    label: "Winger / Pocket Pistol",
    classId: "scout",
    slot: "secondary",
  },
  { script: "tf_weapon_bat", label: "Bat", classId: "scout", slot: "melee" },
  { script: "tf_weapon_bat_fish", label: "Holy Mackerel", classId: "scout", slot: "melee" },
  { script: "tf_weapon_bat_giftwrap", label: "Wrap Assassin", classId: "scout", slot: "melee" },
  { script: "tf_weapon_bat_wood", label: "Sandman", classId: "scout", slot: "melee" },
  {
    script: "tf_weapon_rocketlauncher",
    label: "Rocket Launcher",
    classId: "soldier",
    slot: "primary",
  },
  {
    script: "tf_weapon_rocketlauncher_directhit",
    label: "Direct Hit",
    classId: "soldier",
    slot: "primary",
  },
  {
    script: "tf_weapon_rocketlauncher_airstrike",
    label: "Air Strike",
    classId: "soldier",
    slot: "primary",
  },
  {
    script: "tf_weapon_particle_cannon",
    label: "Cow Mangler",
    classId: "soldier",
    slot: "primary",
  },
  { script: "tf_weapon_shotgun_soldier", label: "Shotgun", classId: "soldier", slot: "secondary" },
  { script: "tf_weapon_raygun", label: "Righteous Bison", classId: "soldier", slot: "secondary" },
  { script: "tf_weapon_buff_item", label: "Banners", classId: "soldier", slot: "secondary" },
  {
    script: "tf_weapon_parachute",
    label: "B.A.S.E. Jumper",
    classId: "soldier",
    slot: "secondary",
  },
  { script: "tf_weapon_shovel", label: "Shovel", classId: "soldier", slot: "melee" },
  { script: "tf_weapon_katana", label: "Half-Zatoichi", classId: "soldier", slot: "melee" },
  { script: "tf_weapon_flamethrower", label: "Flamethrower", classId: "pyro", slot: "primary" },
  {
    script: "tf_weapon_rocketlauncher_fireball",
    label: "Dragon's Fury",
    classId: "pyro",
    slot: "primary",
  },
  { script: "tf_weapon_flaregun", label: "Flare Gun", classId: "pyro", slot: "secondary" },
  { script: "tf_weapon_flaregun_revenge", label: "Manmelter", classId: "pyro", slot: "secondary" },
  { script: "tf_weapon_shotgun_pyro", label: "Shotgun", classId: "pyro", slot: "secondary" },
  { script: "tf_weapon_jar_gas", label: "Gas Passer", classId: "pyro", slot: "secondary" },
  { script: "tf_weapon_rocketpack", label: "Thermal Thruster", classId: "pyro", slot: "secondary" },
  { script: "tf_weapon_fireaxe", label: "Fire Axe", classId: "pyro", slot: "melee" },
  { script: "tf_weapon_breakable_sign", label: "Neon Annihilator", classId: "pyro", slot: "melee" },
  { script: "tf_weapon_slap", label: "Hot Hand", classId: "pyro", slot: "melee" },
  {
    script: "tf_weapon_grenadelauncher",
    label: "Grenade Launcher",
    classId: "demoman",
    slot: "primary",
  },
  { script: "tf_weapon_cannon", label: "Loose Cannon", classId: "demoman", slot: "primary" },
  {
    script: "tf_weapon_pipebomblauncher",
    label: "Stickybomb Launcher",
    classId: "demoman",
    slot: "secondary",
  },
  {
    script: "tf_weapon_parachute_secondary",
    label: "B.A.S.E. Jumper",
    classId: "demoman",
    slot: "secondary",
  },
  { script: "tf_weapon_bottle", label: "Bottle", classId: "demoman", slot: "melee" },
  { script: "tf_weapon_sword", label: "Eyelander", classId: "demoman", slot: "melee" },
  { script: "tf_weapon_stickbomb", label: "Ullapool Caber", classId: "demoman", slot: "melee" },
  { script: "tf_weapon_minigun", label: "Minigun", classId: "heavy", slot: "primary" },
  { script: "tf_weapon_shotgun_hwg", label: "Shotgun", classId: "heavy", slot: "secondary" },
  { script: "tf_weapon_lunchbox", label: "Sandvich", classId: "heavy", slot: "secondary" },
  { script: "tf_weapon_fists", label: "Fists", classId: "heavy", slot: "melee" },
  { script: "tf_weapon_shotgun_primary", label: "Shotgun", classId: "engineer", slot: "primary" },
  {
    script: "tf_weapon_sentry_revenge",
    label: "Frontier Justice",
    classId: "engineer",
    slot: "primary",
  },
  { script: "tf_weapon_drg_pomson", label: "Pomson", classId: "engineer", slot: "primary" },
  {
    script: "tf_weapon_shotgun_building_rescue",
    label: "Rescue Ranger",
    classId: "engineer",
    slot: "primary",
  },
  { script: "tf_weapon_pistol", label: "Pistol", classId: "engineer", slot: "secondary" },
  {
    script: "tf_weapon_mechanical_arm",
    label: "Short Circuit",
    classId: "engineer",
    slot: "secondary",
  },
  { script: "tf_weapon_laser_pointer", label: "Wrangler", classId: "engineer", slot: "secondary" },
  { script: "tf_weapon_wrench", label: "Wrench", classId: "engineer", slot: "melee" },
  { script: "tf_weapon_robot_arm", label: "Gunslinger", classId: "engineer", slot: "melee" },
  { script: "tf_weapon_pda_engineer_build", label: "Build PDA", classId: "engineer", slot: "pda" },
  {
    script: "tf_weapon_pda_engineer_destroy",
    label: "Destroy PDA",
    classId: "engineer",
    slot: "pda",
  },
  { script: "tf_weapon_builder", label: "Toolbox", classId: "engineer", slot: "pda" },
  { script: "tf_weapon_syringegun_medic", label: "Syringe Gun", classId: "medic", slot: "primary" },
  { script: "tf_weapon_crossbow", label: "Crusader's Crossbow", classId: "medic", slot: "primary" },
  { script: "tf_weapon_medigun", label: "Medi Gun", classId: "medic", slot: "secondary" },
  { script: "tf_weapon_bonesaw", label: "Bonesaw", classId: "medic", slot: "melee" },
  { script: "tf_weapon_sniperrifle", label: "Sniper Rifle", classId: "sniper", slot: "primary" },
  {
    script: "tf_weapon_sniperrifle_decap",
    label: "Bazaar Bargain",
    classId: "sniper",
    slot: "primary",
  },
  { script: "tf_weapon_sniperrifle_classic", label: "Classic", classId: "sniper", slot: "primary" },
  { script: "tf_weapon_compound_bow", label: "Huntsman", classId: "sniper", slot: "primary" },
  {
    script: "tf_weapon_charged_smg",
    label: "Cleaner's Carbine",
    classId: "sniper",
    slot: "secondary",
  },
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
  "Custom VTF crosshairs usually work on Valve Casual when they live under replay/thumbnails. Set the default in-game crosshair file above to Default / none or they will not show.";

export const CROSSHAIR_STOCK_OVERRIDE_NOTE =
  "The default in-game crosshair overrides custom crosshairs unless its file is Default / none.";

export type CrosshairColor = [number, number, number];

/** A named non-builtin crosshair. bytes null = stored in the installed pack
 * (the backend recovers them on apply). */
export type CrosshairLibraryEntry = {
  format: "vtf" | "rgba";
  bytes: number[] | null;
};

export type CrosshairDraft = {
  shape: CrosshairShape;
  assignments: Record<string, CrosshairShape>;
  customRgba: number[] | null;
  /** RGB tint baked into the shape VTFs; null = white. */
  color: CrosshairColor | null;
  library: Record<string, CrosshairLibraryEntry>;
  /** Serialized designer params for the "designed" entry. */
  design: string | null;
};

export function emptyCrosshairDraft(): CrosshairDraft {
  return {
    shape: "cross",
    assignments: {},
    customRgba: null,
    color: null,
    library: {},
    design: null,
  };
}

export function seedCrosshairDraft(record: CrosshairRecord | null | undefined): CrosshairDraft {
  // A library entry saved before community ids were namespaced can be named
  // "circle" or "dot" — the same string as a first-party shape. Rename those on
  // the way in so the chip grid, the selects and the pack all mean one thing.
  const rename = (name: string) => migrateCommunityName(name, isBuiltinCrosshairShape);
  const library: Record<string, CrosshairLibraryEntry> = {};
  for (const [name, format] of Object.entries(record?.library ?? {})) {
    if (validCrosshairName(name)) {
      library[rename(name)] = { format: format === "rgba" ? "rgba" : "vtf", bytes: null };
    }
  }
  const known = (value: string) => isBuiltinCrosshairShape(value) || value in library;
  const raw = record?.shape ?? "cross";
  const shape = known(raw) ? raw : "cross";
  const assignments: Record<string, CrosshairShape> = {};
  for (const [script, value] of Object.entries(record?.assignments ?? {})) {
    if (known(value)) {
      assignments[script] = value;
    }
  }
  const storedColor = record?.color ?? null;
  const color: CrosshairColor | null =
    storedColor && storedColor.length === 3
      ? [clampChannel(storedColor[0]), clampChannel(storedColor[1]), clampChannel(storedColor[2])]
      : null;
  return { shape, assignments, customRgba: null, color, library, design: record?.design ?? null };
}

/**
 * Whether the builder holds anything an apply would write.
 *
 * Both sides come from the same seed, so a plain serialization is enough: a
 * new shape, an override, a tint, a designer save, an imported PNG or a
 * community entry all show up as a difference from the installed record.
 */
export function crosshairDraftDirty(draft: CrosshairDraft, seeded: CrosshairDraft): boolean {
  return JSON.stringify(draft) !== JSON.stringify(seeded);
}

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Number.isFinite(value) ? Math.round(value) : 255));
}

export function assignmentFor(draft: CrosshairDraft, script: string): CrosshairShape {
  return draft.assignments[script] ?? draft.shape;
}

export function weaponsForClass(classId: Tf2Class): WeaponCatalogEntry[] {
  return WEAPON_CATALOG.filter((weapon) => weapon.classId === classId);
}

const WEAPON_SLOTS = ["primary", "secondary", "melee", "pda", "other"] as const;

export type WeaponSlot = (typeof WEAPON_SLOTS)[number];

/** Slots that actually exist in the catalog, in display order. */
export function catalogSlots(): WeaponSlot[] {
  return WEAPON_SLOTS.filter((slot) => WEAPON_CATALOG.some((weapon) => weapon.slot === slot));
}

/** Assign one shape to every catalog weapon in the slot, across all classes.
 * Picking the base shape clears the overrides instead of freezing them, so the
 * base-shape fallback keeps working for those weapons. */
export function assignSlotForAllClasses(
  draft: CrosshairDraft,
  slot: WeaponSlot,
  shape: CrosshairShape,
  excludeClass?: Tf2Class,
): CrosshairDraft {
  const assignments = { ...draft.assignments };
  for (const weapon of WEAPON_CATALOG) {
    if (weapon.slot !== slot || weapon.classId === excludeClass) {
      continue;
    }
    if (shape === draft.shape) {
      delete assignments[weapon.script];
    } else {
      assignments[weapon.script] = shape;
    }
  }
  return { ...draft, assignments };
}

/** The shared shape for a slot across all classes, or null when weapons disagree. */
export function slotAssignment(draft: CrosshairDraft, slot: WeaponSlot): CrosshairShape | null {
  const weapons = WEAPON_CATALOG.filter((weapon) => weapon.slot === slot);
  if (weapons.length === 0) {
    return null;
  }
  const first = assignmentFor(draft, weapons[0].script);
  return weapons.every((weapon) => assignmentFor(draft, weapon.script) === first) ? first : null;
}

/** Copy one class's stock-weapon shape per slot onto every OTHER class. The
 * source class keeps its own per-weapon overrides untouched. */
export function copyClassToAllClasses(draft: CrosshairDraft, classId: Tf2Class): CrosshairDraft {
  let next = draft;
  for (const slot of catalogSlots()) {
    // The first catalog entry per slot is the class's stock weapon.
    const stock = WEAPON_CATALOG.find(
      (weapon) => weapon.classId === classId && weapon.slot === slot,
    );
    if (stock) {
      next = assignSlotForAllClasses(next, slot, assignmentFor(draft, stock.script), classId);
    }
  }
  return next;
}

export function isBuiltinCrosshairShape(value: string): value is BuiltinCrosshairShape {
  return (
    value === CUSTOM_CROSSHAIR_SHAPE ||
    CROSSHAIR_SHAPES.includes(value as (typeof CROSSHAIR_SHAPES)[number])
  );
}

/**
 * Multiply an RGBA buffer by a tint, matching how the engine modulates the
 * crosshair sprite with cl_crosshair_red/green/blue. Returns a new buffer; a
 * null color is the identity.
 */
export function tintCrosshairRgba(
  rgba: Uint8ClampedArray | number[],
  color: CrosshairColor | null,
): Uint8ClampedArray {
  const out = Uint8ClampedArray.from(rgba);
  if (!color) {
    return out;
  }
  const [red, green, blue] = color;
  for (let i = 0; i < out.length; i += 4) {
    out[i] = (out[i] * red) / 255;
    out[i + 1] = (out[i + 1] * green) / 255;
    out[i + 2] = (out[i + 2] * blue) / 255;
  }
  return out;
}

/** Draw a first-party shape into a 64×64 RGBA buffer (row-major, unpremultiplied). */
export function renderCrosshairRgba(
  shape: string,
  color: CrosshairColor | null = null,
): Uint8ClampedArray {
  const size = CROSSHAIR_CANVAS_SIZE;
  const pixels = new Uint8ClampedArray(size * size * 4);
  const [red, green, blue] = color ?? [255, 255, 255];
  const set = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= size || y >= size) {
      return;
    }
    const i = (y * size + x) * 4;
    pixels[i] = red;
    pixels[i + 1] = green;
    pixels[i + 2] = blue;
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
