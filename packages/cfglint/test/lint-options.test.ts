import { describe, expect, it } from "vitest";
import {
  cfgPathIsEditable,
  classifyCfgOrigin,
  engineManagedLintOptions,
} from "../src/lint-options";

describe("shared cfg ownership", () => {
  it("uses complete mount paths instead of familiar basenames", () => {
    expect(classifyCfgOrigin("tf/cfg/config.cfg")).toBe("engine");
    expect(cfgPathIsEditable("tf/cfg/config.cfg")).toBe(true);
    expect(classifyCfgOrigin("tf/cfg/config_default.cfg")).toBe("engine");
    expect(classifyCfgOrigin("tf/cfg/helpers/config_default.cfg")).toBe("user");
    expect(classifyCfgOrigin("tf/custom/pack/cfg/config.cfg")).toBe("pack");
    expect(classifyCfgOrigin("tf/cfg/overrides/execs_binds.cfg")).toBe("app");
    expect(classifyCfgOrigin("tf/cfg/helpers/execs_binds.cfg")).toBe("user");
    expect(classifyCfgOrigin("tf/custom/pack/cfg/execs_binds.cfg")).toBe("pack");
  });
  it("requires the exact recorded HUD folder without inventing a dashed peer", () => {
    expect(classifyCfgOrigin("tf/custom/RaysHud/cfg/foo.cfg", "rayshud")).toBe("hud");
    expect(classifyCfgOrigin("tf/custom/-rayshud/cfg/foo.cfg", "rayshud")).toBe("pack");
    expect(classifyCfgOrigin("tf/custom/-rayshud/cfg/foo.cfg", "-rayshud")).toBe("hud");
    expect(classifyCfgOrigin("tf/custom/rayshud2/cfg/foo.cfg", "rayshud")).toBe("pack");
    expect(classifyCfgOrigin("tf/custom/rayshud/cfg/foo.cfg", null)).toBe("pack");
  });
  it("keeps desktop editability and advisory lint classification aligned", () => {
    const paths = [
      "tf/cfg/config.cfg",
      "tf/cfg/config_default.cfg",
      "tf/custom/hud/cfg/autoexec.cfg",
      "tf/cfg/nested/execs_binds.cfg",
    ];
    const options = engineManagedLintOptions(
      paths.map((path) => ({ path })),
      "hud",
    );
    expect(options.advisoryPaths).toEqual(paths.filter((path) => !cfgPathIsEditable(path, "hud")));
  });
});
