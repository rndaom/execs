import { describe, expect, it, test } from "vitest";
import {
  assignmentFor,
  assignSlotForAllClasses,
  CROSSHAIR_CANVAS_SIZE,
  catalogSlots,
  copyClassToAllClasses,
  crosshairLibraryDirty,
  crosshairNeedsPack,
  EXTERNAL_CROSSHAIR_CHOICE,
  emptyCrosshairDraft,
  isBuiltinCrosshairShape,
  planCrosshair,
  previewCrosshairRecord,
  renderCrosshairRgba,
  seedCrosshairDraft,
  slotAssignment,
  tf2ChoiceForFile,
  tf2CrosshairFile,
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

describe("what a crosshair draft needs", () => {
  const base = { ...emptyCrosshairDraft(), shape: "tf-crosshair3" };

  it("maps cl_crosshair_file values to TF2 choices and back", () => {
    expect(tf2ChoiceForFile("")).toBe("tf-default");
    expect(tf2ChoiceForFile("Crosshair5")).toBe("tf-crosshair5");
    expect(tf2ChoiceForFile("my_hud/reticle")).toBe(EXTERNAL_CROSSHAIR_CHOICE);
    expect(tf2CrosshairFile("tf-default")).toBe("");
    expect(tf2CrosshairFile("tf-crosshair7")).toBe("crosshair7");
    expect(tf2CrosshairFile("dot")).toBeNull();
    expect(
      seedCrosshairDraft({ id: "p", shape: "tf-crosshair2", assignments: { a: "tf-default" } }),
    ).toMatchObject({ shape: "tf-crosshair2", assignments: { a: "tf-default" } });
  });

  it("lets TF2 draw its own sprite alone and needs the pack for anything else", () => {
    expect(
      planCrosshair({ draft: base, seeded: base, packLive: false, stockFile: "crosshair3" }),
    ).toEqual({ kind: "none" });
    const dot = { ...base, shape: "dot" };
    expect(planCrosshair({ draft: dot, seeded: base, packLive: false, stockFile: "" })).toEqual({
      kind: "build",
    });
    const exception = { ...base, assignments: { tf_weapon_bat: "dot" } };
    expect(
      planCrosshair({ draft: exception, seeded: base, packLive: false, stockFile: "" }),
    ).toEqual({ kind: "build" });
    // An "exception" equal to the main crosshair is none at all.
    const redundant = { ...base, assignments: { tf_weapon_bat: "tf-crosshair3" } };
    expect(crosshairNeedsPack(redundant, redundant)).toBe(false);
  });

  it("keeps new designs by building even when TF2 draws the main crosshair", () => {
    const withDesign = {
      ...base,
      library: { "design-a": { format: "rgba" as const, bytes: [1] } },
    };
    expect(crosshairLibraryDirty(withDesign, base)).toBe(true);
    expect(
      planCrosshair({ draft: withDesign, seeded: base, packLive: false, stockFile: "" }),
    ).toEqual({ kind: "build" });
  });

  it("switches a live pack off only for a changed, TF2-only draft", () => {
    const live = { ...base, shape: "cross" };
    expect(planCrosshair({ draft: live, seeded: live, packLive: true, stockFile: "" })).toEqual({
      kind: "none",
    });
    expect(
      planCrosshair({
        draft: { ...live, shape: "tf-crosshair6" },
        seeded: live,
        packLive: true,
        stockFile: "",
      }),
    ).toEqual({ kind: "deactivate", file: "crosshair6" });
    expect(
      planCrosshair({
        draft: { ...live, shape: EXTERNAL_CROSSHAIR_CHOICE },
        seeded: live,
        packLive: true,
        stockFile: "hud/x",
      }),
    ).toEqual({ kind: "deactivate", file: "hud/x" });
    expect(
      planCrosshair({
        draft: { ...live, shape: "dot" },
        seeded: live,
        packLive: true,
        stockFile: "",
      }),
    ).toEqual({ kind: "build" });
    // A pack whose main crosshair is TF2's own stays as it is until changed.
    const tf2Pack = { ...base };
    expect(
      planCrosshair({ draft: tf2Pack, seeded: tf2Pack, packLive: true, stockFile: "" }),
    ).toEqual({ kind: "none" });
  });
});
