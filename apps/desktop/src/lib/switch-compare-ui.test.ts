import { describe, expect, it } from "vitest";
import { compareSections, comparisonIsEmpty, type ProfileComparison } from "./switch-compare-ui";

function comparison(patch: Partial<ProfileComparison> = {}): ProfileComparison {
  const none = { added: [], removed: [], changed: [] };
  return {
    fromId: "a",
    fromName: "Main",
    toId: "b",
    toName: "Casual",
    revision: "r1",
    launchOptions: null,
    hud: null,
    hitSound: null,
    killSound: null,
    packs: none,
    cfgFiles: none,
    configCfgChanged: false,
    values: [],
    valuesTruncated: false,
    casual: none,
    blocked: null,
    ...patch,
  };
}

describe("switch comparison", () => {
  it("reports an identical pair as empty", () => {
    expect(comparisonIsEmpty(comparison())).toBe(true);
  });

  it("groups setup, values, packs, cfgs and Casual choices with readable labels", () => {
    const sections = compareSections(
      comparison({
        hud: { from: "flawhud", to: null },
        values: [{ name: "fov_desired", from: "90", to: "75" }],
        valuesTruncated: true,
        packs: { added: ["execs-viewmodels.vpk"], removed: ["pack"], changed: ["execs-hitsounds"] },
        cfgFiles: { added: ["tf/cfg/scout.cfg"], removed: [], changed: [] },
        configCfgChanged: true,
        casual: { added: [], removed: ["Flat Textures v1"], changed: [] },
      }),
    );
    expect(sections.map((section) => section.id)).toEqual([
      "general",
      "values",
      "packs",
      "cfgs",
      "casual",
    ]);
    expect(sections[0].rows).toEqual([{ label: "HUD", from: "flawhud", to: "None" }]);
    expect(sections[1].note).toBe("More settings differ than are listed.");
    expect(sections[2].rows).toEqual([
      { label: "Viewmodels", from: "Not installed", to: "Added" },
      { label: "pack", from: "Installed", to: "Removed" },
      { label: "Hit and kill sounds", from: "Installed", to: "Replaced" },
    ]);
    expect(sections[3].rows.map((row) => row.label)).toEqual(["scout.cfg", "config.cfg"]);
    expect(sections[3].note).toContain("Steam uploads it when it syncs");
    expect(sections[4].rows).toEqual([
      { label: "Flat Textures v1", from: "Installed", to: "Removed" },
    ]);
  });
});
