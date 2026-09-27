import { describe, expect, it } from "vitest";
import { conditionalCfgSources } from "./conditional-cfg-sources";

describe("conditional CFG source index", () => {
  const files = [
    {
      path: "tf/cfg/overrides/scout.cfg",
      text: "// class switch\nbind q +jump\nfov_desired 100\ncrosshair 0\nexec class_extra\n",
    },
    {
      path: "tf/custom/hud/cfg/medic.cfg",
      text: "tf_dingalingaling 0\n",
    },
    { path: "tf/cfg/autoexec.cfg", text: "bind q +jump\nfov_desired 90\n" },
  ];

  it("finds relevant launch commands and class lines with exact locations", () => {
    const launch =
      '-novid +exec "personal settings" +bind mouse4 +attack +fov_desired 110 +crosshair 0';
    expect(conditionalCfgSources(files, launch, "binds")).toEqual([
      { kind: "launch", label: '+exec "personal settings"' },
      { kind: "launch", label: "+bind" },
      { kind: "class", label: "bind", path: "tf/cfg/overrides/scout.cfg", line: 2 },
      { kind: "class", label: "exec", path: "tf/cfg/overrides/scout.cfg", line: 5 },
    ]);
    expect(conditionalCfgSources(files, launch, "gameplay")).toContainEqual({
      kind: "class",
      label: "fov_desired",
      path: "tf/cfg/overrides/scout.cfg",
      line: 3,
    });
    expect(conditionalCfgSources(files, launch, "crosshair")).toContainEqual({
      kind: "class",
      label: "crosshair",
      path: "tf/cfg/overrides/scout.cfg",
      line: 4,
    });
    expect(conditionalCfgSources(files, launch, "sounds")).toContainEqual({
      kind: "class",
      label: "tf_dingalingaling",
      path: "tf/custom/hud/cfg/medic.cfg",
      line: 1,
    });
  });

  it("keeps unrelated options and startup CFG lines out of the disclosure", () => {
    expect(conditionalCfgSources(files, "-novid +viewmodel_fov 70", "binds")).toEqual([
      { kind: "class", label: "bind", path: "tf/cfg/overrides/scout.cfg", line: 2 },
      { kind: "class", label: "exec", path: "tf/cfg/overrides/scout.cfg", line: 5 },
    ]);
    expect(conditionalCfgSources([], "-novid", "gameplay")).toEqual([]);
    expect(conditionalCfgSources(files, "+bind q +jump", "mods")).toEqual([]);
  });

  it("shows a conservative Launch review when semicolons make option groups ambiguous", () => {
    expect(conditionalCfgSources([], "+exec autoexec; +fov_desired 110", "gameplay")).toEqual([
      { kind: "launch", label: "Launch options contain commands that need review" },
    ]);
  });

  it("coalesces repeated identical launch hints", () => {
    expect(conditionalCfgSources([], "+exec autoexec +exec autoexec", "binds")).toEqual([
      { kind: "launch", label: "+exec autoexec" },
    ]);
  });

  it("identifies a documented mastercomfig class route alias", () => {
    expect(
      conditionalCfgSources(
        [
          {
            path: "tf/cfg/overrides/autoexec.cfg",
            text: 'alias class_config_heavyweapons "exec overrides/myheavy"\n',
          },
        ],
        "",
        "gameplay",
      ),
    ).toEqual([
      {
        kind: "class",
        label: "class route class_config_heavyweapons",
        path: "tf/cfg/overrides/autoexec.cfg",
        line: 1,
      },
    ]);
  });

  it("does not attribute a retained inactive HUD class CFG to the mounted profile", () => {
    expect(
      conditionalCfgSources(files, "", "sounds", {
        hudRoots: ["hud", "current"],
        selectedHudRoot: "current",
      }),
    ).toEqual([{ kind: "class", label: "exec", path: "tf/cfg/overrides/scout.cfg", line: 5 }]);
  });
});
