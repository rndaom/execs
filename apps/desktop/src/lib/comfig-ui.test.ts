import { describe, expect, it } from "vitest";
import {
  COMFIG_MODULES,
  COMFIG_PRESETS,
  comfigModuleById,
  visibleComfigPresets,
} from "./comfig-catalog";
import {
  addonsFromFilePaths,
  defaultComfigState,
  inferComfigState,
  setModuleLevel,
  toggleComfigAddon,
} from "./comfig-ui";

describe("comfig module overrides", () => {
  it("clears a module override when the level is empty", () => {
    expect(setModuleLevel({ texture_quality: "high" }, "texture_quality", "")).toEqual({});
    expect(setModuleLevel({}, "shadows", "off")).toEqual({ shadows: "off" });
  });
});

describe("comfig addons", () => {
  it("toggles official addons", () => {
    expect(toggleComfigAddon([], "no-tutorial")).toEqual(["no-tutorial"]);
    expect(toggleComfigAddon(["no-tutorial"], "no-tutorial")).toEqual([]);
    expect(toggleComfigAddon(["no-tutorial"], "lowmem")).toEqual(["no-tutorial", "lowmem"]);
  });

  it("reads addon stems from manifest paths", () => {
    expect(
      addonsFromFilePaths([
        "tf/custom/mastercomfig-base.vpk",
        "tf/custom/mastercomfig-addon-no-tutorial.vpk",
        "tf/custom/other.vpk",
      ]),
    ).toEqual(["no-tutorial"]);
  });

  it("starts from an empty default state", () => {
    expect(defaultComfigState()).toEqual({
      preset: "medium",
      modules: {},
      addons: [],
    });
    expect(
      inferComfigState({
        id: "p1",
        name: "Main",
        launchOptions: "",
        layer: "comfig",
        files: [
          {
            path: "tf/custom/mastercomfig-addon-flat-mouse.vpk",
            sha256: "a",
            storage: "exclusive",
          },
        ],
      }).addons,
    ).toEqual(["flat-mouse"]);
  });
});

describe("comfig catalog", () => {
  it("has snapshot_buffer and texture_quality", () => {
    const ids = COMFIG_MODULES.map((module) => module.id);
    expect(ids).toContain("snapshot_buffer");
    expect(ids).toContain("texture_quality");
    expect(comfigModuleById("snapshot_buffer")?.levels).toContain("auto");
    expect(comfigModuleById("texture_quality")?.levels).toContain("high");
  });
});

describe("comfig preset catalog", () => {
  it("shows the four canonical presets until the rest are disclosed", () => {
    expect(visibleComfigPresets("medium", false).map((preset) => preset.id)).toEqual([
      "ultra",
      "high",
      "medium",
      "low",
    ]);
    expect(visibleComfigPresets("medium", true)).toEqual(COMFIG_PRESETS);
  });

  it("keeps the list open when the selection is not one of the four", () => {
    expect(visibleComfigPresets("very_low", false)).toEqual(COMFIG_PRESETS);
  });
});
