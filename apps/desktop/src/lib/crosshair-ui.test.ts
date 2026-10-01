import { describe, expect, it, test } from "vitest";
import {
  assignmentFor,
  assignSlotForAllClasses,
  CROSSHAIR_CANVAS_SIZE,
  catalogSlots,
  copyClassToAllClasses,
  emptyCrosshairDraft,
  isBuiltinCrosshairShape,
  previewCrosshairRecord,
  renderCrosshairRgba,
  seedCrosshairDraft,
  slotAssignment,
  tintCrosshairRgba,
  validCrosshairName,
  WEAPON_CATALOG,
  weaponsForClass,
} from "./crosshair-ui";

// Every `scripts/tf_weapon_*` weapon script in TF2's tf2_misc_dir.vpk (September 2026).
// A catalog entry outside this list can never be built and fails the whole pack.
const TF2_WEAPON_SCRIPTS = new Set([
  "tf_weapon_bat",
  "tf_weapon_bat_fish",
  "tf_weapon_bat_giftwrap",
  "tf_weapon_bat_wood",
  "tf_weapon_bonesaw",
  "tf_weapon_bottle",
  "tf_weapon_breakable_sign",
  "tf_weapon_buff_item",
  "tf_weapon_builder",
  "tf_weapon_cannon",
  "tf_weapon_charged_smg",
  "tf_weapon_cleaver",
  "tf_weapon_club",
  "tf_weapon_compound_bow",
  "tf_weapon_crossbow",
  "tf_weapon_drg_pomson",
  "tf_weapon_fireaxe",
  "tf_weapon_fists",
  "tf_weapon_flamethrower",
  "tf_weapon_flaregun",
  "tf_weapon_flaregun_revenge",
  "tf_weapon_grapplinghook",
  "tf_weapon_grenadelauncher",
  "tf_weapon_handgun_scout_primary",
  "tf_weapon_handgun_scout_secondary",
  "tf_weapon_invis",
  "tf_weapon_jar",
  "tf_weapon_jar_gas",
  "tf_weapon_jar_milk",
  "tf_weapon_katana",
  "tf_weapon_knife",
  "tf_weapon_laser_pointer",
  "tf_weapon_lunchbox",
  "tf_weapon_lunchbox_drink",
  "tf_weapon_mechanical_arm",
  "tf_weapon_medigun",
  "tf_weapon_minigun",
  "tf_weapon_objectselection",
  "tf_weapon_parachute",
  "tf_weapon_parachute_primary",
  "tf_weapon_parachute_secondary",
  "tf_weapon_particle_cannon",
  "tf_weapon_passtime_gun",
  "tf_weapon_pda_engineer_build",
  "tf_weapon_pda_engineer_destroy",
  "tf_weapon_pda_spy",
  "tf_weapon_pep_brawler_blaster",
  "tf_weapon_pipebomblauncher",
  "tf_weapon_pistol",
  "tf_weapon_pistol_scout",
  "tf_weapon_raygun",
  "tf_weapon_revolver",
  "tf_weapon_robot_arm",
  "tf_weapon_rocketlauncher",
  "tf_weapon_rocketlauncher_airstrike",
  "tf_weapon_rocketlauncher_directhit",
  "tf_weapon_rocketlauncher_fireball",
  "tf_weapon_rocketpack",
  "tf_weapon_sapper",
  "tf_weapon_scattergun",
  "tf_weapon_sentry_revenge",
  "tf_weapon_shotgun_building_rescue",
  "tf_weapon_shotgun_hwg",
  "tf_weapon_shotgun_primary",
  "tf_weapon_shotgun_pyro",
  "tf_weapon_shotgun_soldier",
  "tf_weapon_shovel",
  "tf_weapon_slap",
  "tf_weapon_smg",
  "tf_weapon_sniperrifle",
  "tf_weapon_sniperrifle_classic",
  "tf_weapon_sniperrifle_decap",
  "tf_weapon_soda_popper",
  "tf_weapon_spellbook",
  "tf_weapon_stickbomb",
  "tf_weapon_sword",
  "tf_weapon_syringegun_medic",
  "tf_weapon_wrench",
]);

describe("crosshair ui", () => {
  it("lists only weapon scripts that exist in TF2", () => {
    const missing = WEAPON_CATALOG.filter((weapon) => !TF2_WEAPON_SCRIPTS.has(weapon.script));
    expect(missing.map((weapon) => weapon.script)).toEqual([]);
  });

  it("lists first-party weapon filenames only", () => {
    expect(WEAPON_CATALOG.every((weapon) => weapon.script.startsWith("tf_weapon_"))).toBe(true);
    expect(weaponsForClass("scout").length).toBeGreaterThan(3);
  });

  it("seeds assignments and falls back to the default shape", () => {
    const draft = seedCrosshairDraft(previewCrosshairRecord());
    expect(draft.shape).toBe("cross");
    expect(assignmentFor(draft, "tf_weapon_scattergun")).toBe("dot");
    expect(assignmentFor(draft, "tf_weapon_minigun")).toBe("cross");
    expect(isBuiltinCrosshairShape("circle")).toBe(true);
    expect(isBuiltinCrosshairShape("custom")).toBe(true);
    expect(isBuiltinCrosshairShape("valve")).toBe(false);
    expect(emptyCrosshairDraft().shape).toBe("cross");
  });

  it("fans a slot out to every class, clearing overrides when the base shape is picked", () => {
    let draft = emptyCrosshairDraft(); // base "cross"
    draft = assignSlotForAllClasses(draft, "primary", "dot");
    expect(assignmentFor(draft, "tf_weapon_scattergun")).toBe("dot");
    expect(assignmentFor(draft, "tf_weapon_minigun")).toBe("dot");
    expect(slotAssignment(draft, "primary")).toBe("dot");
    // Selecting the base shape reverts to the fallback instead of freezing it.
    draft = assignSlotForAllClasses(draft, "primary", "cross");
    expect(Object.keys(draft.assignments)).toHaveLength(0);
    draft = { ...draft, shape: "circle" };
    expect(assignmentFor(draft, "tf_weapon_scattergun")).toBe("circle");
  });

  it("copies a class's stock shapes to other classes without touching its own overrides", () => {
    let draft = emptyCrosshairDraft();
    draft = {
      ...draft,
      assignments: {
        tf_weapon_scattergun: "dot", // scout stock primary
        tf_weapon_soda_popper: "circle", // scout non-stock primary override
      },
    };
    const next = copyClassToAllClasses(draft, "scout");
    // Other classes' primaries follow scout's stock primary…
    expect(assignmentFor(next, "tf_weapon_minigun")).toBe("dot");
    expect(assignmentFor(next, "tf_weapon_rocketlauncher")).toBe("dot");
    // …while scout's own overrides survive untouched.
    expect(assignmentFor(next, "tf_weapon_soda_popper")).toBe("circle");
    expect(assignmentFor(next, "tf_weapon_scattergun")).toBe("dot");
  });

  it("renders a 64x64 first-party shape with some opaque pixels", () => {
    const pixels = renderCrosshairRgba("cross");
    expect(pixels.length).toBe(CROSSHAIR_CANVAS_SIZE * CROSSHAIR_CANVAS_SIZE * 4);
    let opaque = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] > 0) {
        opaque += 1;
      }
    }
    expect(opaque).toBeGreaterThan(20);
  });
});

test("tintCrosshairRgba multiplies color and leaves alpha and null tints alone", () => {
  const source = new Uint8ClampedArray([255, 255, 255, 255, 128, 128, 128, 64]);
  const red = tintCrosshairRgba(source, [255, 0, 0]);
  expect(Array.from(red.slice(0, 4))).toEqual([255, 0, 0, 255]);
  expect(Array.from(red.slice(4))).toEqual([128, 0, 0, 64]);
  expect(Array.from(tintCrosshairRgba(source, null))).toEqual(Array.from(source));
});

describe("crosshair names and slots", () => {
  it("accepts only names that survive VPK paths and VMT text", () => {
    expect(validCrosshairName("venom_circle")).toBe(true);
    expect(validCrosshairName("plus-gap")).toBe(true);
    expect(validCrosshairName("")).toBe(false);
    expect(validCrosshairName("Circle")).toBe(false);
    expect(validCrosshairName("my crosshair")).toBe(false);
    expect(validCrosshairName("../escape")).toBe(false);
    expect(validCrosshairName("a".repeat(64))).toBe(true);
    expect(validCrosshairName("a".repeat(65))).toBe(false);
  });

  it("lists only slots the catalog actually fills, in display order", () => {
    const slots = catalogSlots();
    expect(slots[0]).toBe("primary");
    expect(new Set(slots).size).toBe(slots.length);
    for (const slot of slots) {
      expect(
        WEAPON_CATALOG.some((weapon) => weapon.slot === slot),
        slot,
      ).toBe(true);
    }
  });

  it("drops shapes and library names it cannot resolve when seeding", () => {
    const seeded = seedCrosshairDraft({
      id: "execs-crosshairs",
      shape: "not_a_shape",
      assignments: { tf_weapon_scattergun: "also_missing", tf_weapon_rocketlauncher: "dot" },
      library: { "Bad Name": "vtf", good_name: "rgba" },
      color: null,
      design: null,
    });
    expect(seeded.shape).toBe("cross");
    expect(seeded.assignments.tf_weapon_scattergun).toBeUndefined();
    expect(seeded.assignments.tf_weapon_rocketlauncher).toBe("dot");
    expect(Object.keys(seeded.library)).toEqual(["good_name"]);
  });

  it("namespaces a legacy library entry that collides with a first-party shape", () => {
    const seeded = seedCrosshairDraft({
      id: "execs-crosshairs",
      shape: "circle",
      assignments: { tf_weapon_scattergun: "dot" },
      library: { circle: "vtf", dot: "vtf", bomo1: "vtf" },
      color: null,
      design: null,
    });
    expect(Object.keys(seeded.library).sort()).toEqual(["bomo1", "venom_circle", "venom_dot"]);
    expect(seeded.shape).toBe("venom_circle");
    expect(seeded.assignments.tf_weapon_scattergun).toBe("venom_dot");

    const firstParty = seedCrosshairDraft({
      id: "execs-crosshairs",
      shape: "circle",
      assignments: { tf_weapon_scattergun: "dot" },
      library: { bomo1: "vtf" },
    });
    expect(firstParty.shape).toBe("circle");
    expect(firstParty.assignments.tf_weapon_scattergun).toBe("dot");
  });
});
