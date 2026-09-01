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

describe("crosshair ui", () => {
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
      shape: "cross",
      assignments: {},
      library: { circle: "vtf", bomo1: "vtf" },
      color: null,
      design: null,
    });
    expect(Object.keys(seeded.library).sort()).toEqual(["bomo1", "venom_circle"]);
  });
});
