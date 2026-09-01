import { describe, expect, it } from "vitest";
import { VIEWMODEL_GROUPS, viewmodelGroupsForClass } from "./viewmodel-groups";
import { VIEWMODEL_PREVIEW_GROUPS } from "./viewmodel-previews";
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

  it("resolves every preview's group id — a typo silently means 'never hides'", () => {
    const ids = new Set(VIEWMODEL_GROUPS.map((group) => group.id));
    for (const [classId, slots] of Object.entries(VIEWMODEL_PREVIEW_GROUPS)) {
      for (const [slot, id] of Object.entries(slots)) {
        expect(ids.has(id), `${classId}/${slot} → ${id}`).toBe(true);
        expect(id.startsWith(`${classId}/`), id).toBe(true);
      }
    }
  });
});
