import { describe, expect, it } from "vitest";
import { newCfgPath } from "./files-create";
import { FILES_EDITOR_MAX_PATH_BYTES } from "./files-limits";

describe("new user cfg destinations", () => {
  it("uses the detected layer and accepts meaningful nested helpers", () => {
    expect(newCfgPath(" autoexec.CFG ", "vanilla")).toEqual({ path: "tf/cfg/autoexec.cfg" });
    expect(newCfgPath("scout", "comfig")).toEqual({ path: "tf/cfg/overrides/scout.cfg" });
    expect(newCfgPath("helpers/practice.cfg", "vanilla")).toEqual({
      path: "tf/cfg/helpers/practice.cfg",
    });
    expect(newCfgPath("helpers/my practice", "comfig")).toEqual({
      path: "tf/cfg/overrides/helpers/my practice.cfg",
    });
  });
  it.each([
    "",
    " ",
    ".cfg",
    "/absolute",
    "../outside",
    "helpers/../outside",
    "./autoexec",
    "helpers//practice",
    "helpers/",
    "C:/file",
    "folder\\file",
    "a:b",
    'a"b',
    "a?b",
    "a*b",
    "a|b",
    "a<b",
    "a>b",
    "nul",
    "CON.cfg",
    "helpers/COM1.cfg",
    "lpt9",
    "aux.txt.cfg",
    "trailing./x",
    "folder /x",
    "control\u0001",
    "DEL\u007f",
  ])("rejects nonportable or escaping name %j", (name) => {
    expect(newCfgPath(name, "vanilla").error).toBeTruthy();
    expect(newCfgPath(name, "vanilla").path).toBeUndefined();
  });
  it.each([
    "config",
    "CONFIG_DEFAULT",
    "execs_binds",
    "execs_gameplay",
    "execs_preload",
    "modules",
    "setup_hook",
    "mtp",
    "360controller",
    "360controller-linux",
    "undo360controller",
    "tf/a",
    "cfg/a",
    "user/a",
    "overrides/a",
    "helpers/USER/a",
  ])("rejects reserved target %j", (name) => {
    expect(newCfgPath(name, "comfig").error).toBeTruthy();
  });
  it("measures complete UTF-8 paths, not just JavaScript characters", () => {
    const ascii = "x".repeat(FILES_EDITOR_MAX_PATH_BYTES - "tf/cfg/.cfg".length);
    expect(newCfgPath(ascii, "vanilla").path).toBeDefined();
    expect(newCfgPath(`${ascii}x`, "vanilla").error).toBeTruthy();
    expect(newCfgPath("é".repeat(600), "vanilla").error).toBeTruthy();
  });
});
