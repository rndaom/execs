import { describe, expect, it } from "vitest";
import { VIEWMODEL_GROUPS, viewmodelGroupsForClass } from "./viewmodel-groups";
import {
  VIEWMODEL_GROUP_PREVIEWS,
  VIEWMODEL_SLOTS,
  viewmodelBlankStem,
  viewmodelStemForGroup,
} from "./viewmodel-previews";
import { VIEWMODEL_CLASSES } from "./viewmodel-ui";

describe("viewmodel groups", () => {
  it("mirrors the 64 groups in the Rust table", () => {
    expect(VIEWMODEL_GROUPS).toHaveLength(64);
    expect(new Set(VIEWMODEL_GROUPS.map((group) => group.id)).size).toBe(64);
  });

  it("names every group after a real class and keeps the id prefixed by it", () => {
    for (const group of VIEWMODEL_GROUPS) {
      expect(VIEWMODEL_CLASSES, group.id).toContain(group.classId);
      expect(group.id.startsWith(`${group.classId}/`), group.id).toBe(true);
      expect(group.label.length).toBeGreaterThan(0);
    }
  });

  it("gives every class at least one group and partitions the table", () => {
    let counted = 0;
    for (const classId of VIEWMODEL_CLASSES) {
      const groups = viewmodelGroupsForClass(classId);
      expect(groups.length, classId).toBeGreaterThan(0);
      counted += groups.length;
    }
    expect(counted).toBe(VIEWMODEL_GROUPS.length);
  });

  it("gives every group a preview screenshot and a slot, and no preview an unknown group", () => {
    const ids = new Set(VIEWMODEL_GROUPS.map((group) => group.id));
    for (const group of VIEWMODEL_GROUPS) {
      const preview = VIEWMODEL_GROUP_PREVIEWS[group.id];
      expect(preview, group.id).toBeDefined();
      expect(preview.image, group.id).toMatch(/^[a-z_]+$/);
      expect(
        preview.image.startsWith(group.classId === "demoman" ? "demo_" : `${group.classId}_`),
        group.id,
      ).toBe(true);
      expect(VIEWMODEL_SLOTS, group.id).toContain(preview.slot);
      expect(preview.weapons.length, group.id).toBeGreaterThan(0);
    }
    for (const id of Object.keys(VIEWMODEL_GROUP_PREVIEWS)) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it("shows the class blank once a group is hidden and the weapon while it is not", () => {
    expect(viewmodelStemForGroup("scout", "scout/scatterguns", false)).toBe("scout_scattergun");
    expect(viewmodelStemForGroup("scout", "scout/scatterguns", true)).toBe("scout_blank");
    expect(viewmodelStemForGroup("demoman", "demoman/melee", true)).toBe("demo_blank");
    expect(viewmodelStemForGroup("spy", "spy/not-a-group", false)).toBe(viewmodelBlankStem("spy"));
  });
});
