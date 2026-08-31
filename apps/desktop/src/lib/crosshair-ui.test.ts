import { describe, expect, it } from "vitest";
import {
  assignmentFor,
  assignSlotForAllClasses,
  CROSSHAIR_CANVAS_SIZE,
  copyClassToAllClasses,
  emptyCrosshairDraft,
  isCrosshairShape,
  previewCrosshairRecord,
  renderCrosshairRgba,
  seedCrosshairDraft,
  slotAssignment,
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
    expect(isCrosshairShape("circle")).toBe(true);
    expect(isCrosshairShape("custom")).toBe(true);
    expect(isCrosshairShape("valve")).toBe(false);
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
