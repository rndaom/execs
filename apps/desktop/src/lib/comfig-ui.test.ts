import { describe, expect, it } from "vitest";
import { COMFIG_MODULES, comfigModuleById } from "./comfig-catalog";
import {
  addonsFromFilePaths,
  defaultComfigState,
  inferComfigState,
  parseModulesCfg,
  parseSetupHook,
  serializeModulesCfg,
  serializeSetupHook,
  setModuleLevel,
  toggleComfigAddon,
} from "./comfig-ui";

describe("comfig modules.cfg", () => {
  it("serializes and parses name=level lines", () => {
    const text = serializeModulesCfg({
      shadows: "off",
      texture_quality: "high",
    });
    expect(text).toBe("shadows=off\ntexture_quality=high\n");
    expect(parseModulesCfg(text)).toEqual({
      shadows: "off",
      texture_quality: "high",
    });
    expect(serializeModulesCfg({})).toBe("");
    expect(parseModulesCfg("")).toEqual({});
    expect(parseModulesCfg("// comment\ntexture_quality=high\n")).toEqual({
      texture_quality: "high",
    });
  });

  it("clears a module override when the level is empty", () => {
    expect(setModuleLevel({ texture_quality: "high" }, "texture_quality", "")).toEqual({});
    expect(setModuleLevel({}, "shadows", "off")).toEqual({ shadows: "off" });
  });
});

describe("comfig setup_hook", () => {
  it("parses preset= and defaults to medium", () => {
    expect(parseSetupHook("preset=low\n")).toBe("low");
    expect(parseSetupHook("preset=medium_high\n")).toBe("medium_high");
    expect(parseSetupHook("")).toBe("medium");
    expect(parseSetupHook("echo hi\n")).toBe("medium");
  });

  it("preserves extra setup_hook lines when rewriting preset", () => {
    expect(serializeSetupHook("medium", "preset=high\necho hello\n")).toBe(
      "preset=medium\necho hello\n",
    );
    expect(serializeSetupHook("ultra")).toBe("preset=ultra\n");
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
