import { describe, expect, it } from "vitest";
import {
  cfgDestinations,
  cfgLayerRoot,
  cfgPathCollision,
  isNewCfgPath,
  newCfgPath,
  newCfgPathIn,
} from "./files-create";
import { FILES_EDITOR_MAX_PATH_BYTES } from "./files-limits";

describe("new user cfg destinations", () => {
  it("uses the detected layer and accepts meaningful nested helpers", () => {
    expect(cfgLayerRoot("vanilla")).toBe("tf/cfg");
    expect(cfgLayerRoot("comfig")).toBe("tf/cfg/overrides");
    expect(newCfgPath(" autoexec.CFG ", "vanilla")).toEqual({ path: "tf/cfg/autoexec.cfg" });
    expect(newCfgPath("scout", "comfig")).toEqual({ path: "tf/cfg/overrides/scout.cfg" });
    expect(newCfgPath("helpers/practice.cfg", "vanilla")).toEqual({
      path: "tf/cfg/helpers/practice.cfg",
    });
    expect(newCfgPath("helpers/my practice", "comfig")).toEqual({
      path: "tf/cfg/overrides/helpers/my practice.cfg",
    });
  });

  it("resolves a plain filename inside a separately chosen destination", () => {
    expect(newCfgPathIn("practice.cfg", "helpers", "vanilla")).toEqual({
      path: "tf/cfg/helpers/practice.cfg",
    });
    expect(newCfgPathIn("practice", "team/server", "comfig")).toEqual({
      path: "tf/cfg/overrides/team/server/practice.cfg",
    });
    expect(newCfgPathIn("team/practice", "helpers", "vanilla")).toEqual({
      error: "Use only a file name here, then choose its folder separately.",
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
    "conin$",
    "conout$.cfg",
    "helpers/COM1.cfg",
    "com¹",
    "COM².cfg",
    "helpers/lpt³.cfg",
    "lpt9",
    "aux.txt.cfg",
    "trailing./x",
    "folder /x",
    "control\u0001",
    "DEL\u007f",
    ".private/practice",
    "LONGFI~1",
    "folder/ABCDEF~12/practice",
    `${"é".repeat(128)}/practice`,
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
    "skill",
    "skill_manifest",
    "joystick",
    "replay",
    "sourcevr",
    "sourcevr_tf",
    "sourcevr_custom",
    "chapter1",
    "chapter_anything",
    "user/a",
    "app/a",
    "comfig/a",
    "overrides/a",
    "node_modules/a",
    "backup.bak/a",
  ])("rejects reserved target %j", (name) => {
    expect(newCfgPath(name, "comfig").error).toBeTruthy();
  });

  it.each(["tf/a", "cfg/a", "helpers/user/a", "helpers/app/a", "helpers/comfig/a"])(
    "keeps reserved cfg root words literal below a safe user folder: %j",
    (name) => {
      expect(newCfgPath(name, "vanilla").path).toBe(`tf/cfg/${name}.cfg`);
    },
  );

  it("measures complete UTF-8 paths, not just JavaScript characters", () => {
    const ascii = "x".repeat(FILES_EDITOR_MAX_PATH_BYTES - "tf/cfg/.cfg".length);
    expect(newCfgPath(ascii, "vanilla").error).toBeTruthy();
    expect(newCfgPath("é".repeat(600), "vanilla").error).toBeTruthy();
    expect(newCfgPath("x".repeat(251), "vanilla").path).toBeDefined();
    expect(newCfgPath("x".repeat(252), "vanilla").error).toBeTruthy();
  });

  it("lists only safe folders in the active cfg layer, including ancestors", () => {
    expect(
      cfgDestinations(
        [
          "tf/cfg/autoexec.cfg",
          "tf/cfg/helpers/practice.cfg",
          "tf/cfg/team/server/rocket.cfg",
          "tf/cfg/TEAM/client.cfg",
          "tf/cfg/.private/hidden.cfg",
          "tf/cfg/user/secret.cfg",
          "tf/cfg/overrides/comfig-only.cfg",
          "tf/custom/hud/cfg/hud.cfg",
        ],
        "vanilla",
      ),
    ).toEqual([
      { id: "", label: "CFG", path: "tf/cfg" },
      { id: "helpers", label: "helpers", path: "tf/cfg/helpers" },
      { id: "team", label: "team", path: "tf/cfg/team" },
      { id: "team/server", label: "team / server", path: "tf/cfg/team/server" },
    ]);
    expect(
      cfgDestinations(
        ["tf/cfg/autoexec.cfg", "TF\\CFG\\OVERRIDES\\helpers\\practice.CFG"],
        "comfig",
      ),
    ).toEqual([
      { id: "", label: "Overrides", path: "tf/cfg/overrides" },
      {
        id: "helpers",
        label: "helpers",
        path: "tf/cfg/overrides/helpers",
      },
    ]);
  });

  it("detects portable collisions without changing the user's path casing", () => {
    const paths = ["tf/cfg/AutoExec.cfg", "tf/cfg/helpers/practice.cfg"];
    expect(cfgPathCollision("TF\\CFG\\autoexec.CFG", paths)).toBe("tf/cfg/AutoExec.cfg");
    expect(cfgPathCollision("tf/cfg/helpers/new.cfg", paths)).toBeNull();
  });

  it("validates complete preview destinations with the same creation rules", () => {
    expect(isNewCfgPath("tf/cfg/helpers/practice.cfg", "vanilla")).toBe(true);
    expect(isNewCfgPath("tf/cfg/overrides/helpers/practice.cfg", "comfig")).toBe(true);
    expect(isNewCfgPath("tf/cfg/app/practice.cfg", "vanilla")).toBe(false);
    expect(isNewCfgPath("tf/cfg/.hidden/practice.cfg", "vanilla")).toBe(false);
    expect(isNewCfgPath("TF/CFG/practice.cfg", "vanilla")).toBe(false);
  });
});
