import { describe, expect, it } from "vitest";
import {
  parseHiddenGroups,
  parseHideMode,
  previewViewmodelRecord,
  seedViewmodelDraft,
  serializeHiddenGroups,
  toggleHiddenGroup,
} from "./viewmodel-ui";

describe("viewmodel ui", () => {
  it("round-trips hidden groups through the record options", () => {
    const hidden = ["scout/scatterguns", "soldier/rockets", "scout/scatterguns"];
    const raw = serializeHiddenGroups(hidden);
    expect(raw).toBe("scout/scatterguns,soldier/rockets");
    expect(parseHiddenGroups(raw)).toEqual(["scout/scatterguns", "soldier/rockets"]);
    expect(parseHiddenGroups("")).toEqual([]);
    expect(parseHiddenGroups(undefined)).toEqual([]);
  });

  it("seeds the draft from a record and ignores legacy compiled-era keys", () => {
    const record = previewViewmodelRecord();
    const seeded = seedViewmodelDraft(record);
    expect(seeded.preload).toBe(true);
    expect(seeded.hidden).toEqual(["scout/melee", "scout/scatterguns"]);
    const legacy = seedViewmodelDraft({
      id: "execs-viewmodels",
      source: "imported",
      preload: false,
      options: { scattergun: '{"hide":true}' },
    });
    expect(legacy.hidden).toEqual([]);
    expect(legacy.preload).toBe(false);
  });

  it("toggles hidden groups deterministically", () => {
    let hidden: string[] = [];
    hidden = toggleHiddenGroup(hidden, "soldier/rockets");
    hidden = toggleHiddenGroup(hidden, "scout/melee");
    expect(hidden).toEqual(["scout/melee", "soldier/rockets"]);
    hidden = toggleHiddenGroup(hidden, "soldier/rockets");
    expect(hidden).toEqual(["scout/melee"]);
  });
});

describe("hide mode", () => {
  it("defaults to the full-viewmodel hide and round-trips the weapon-only choice", () => {
    expect(parseHideMode(undefined)).toBe("full");
    expect(parseHideMode("nonsense")).toBe("full");
    expect(parseHideMode("weapon")).toBe("weapon");
    // A pack built before the option existed hid everything.
    expect(seedViewmodelDraft(previewViewmodelRecord()).hideMode).toBe("full");
    expect(
      seedViewmodelDraft({
        id: "execs-viewmodels",
        source: "compiled",
        preload: true,
        options: { hidden: "scout/scatterguns", mode: "weapon", schema: "yttrium-1" },
      }).hideMode,
    ).toBe("weapon");
  });
});
