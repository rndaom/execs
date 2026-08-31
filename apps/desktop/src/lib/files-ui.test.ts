import { describe, expect, it } from "vitest";
import {
  canSaveCfg,
  cfgFileMeta,
  cfgFiles,
  classifyCfgOrigin,
  findingTierClass,
  lintBundle,
} from "./files-ui";

describe("cfgFiles", () => {
  it("filters non-cfg paths and sorts the rest", () => {
    const listed = cfgFiles([
      { path: "tf/custom/pack.vpk" },
      { path: "tf/cfg/overrides/modules.cfg" },
      { path: "readme.txt" },
      { path: "tf/cfg/autoexec.cfg" },
    ]);
    expect(listed.map((file) => file.path)).toEqual([
      "tf/cfg/autoexec.cfg",
      "tf/cfg/overrides/modules.cfg",
    ]);
  });
});

describe("origin classification", () => {
  it("classifies user, app, engine, hud, pack, and comfig-custom files", () => {
    expect(classifyCfgOrigin("tf/cfg/overrides/autoexec.cfg")).toBe("user");
    expect(classifyCfgOrigin("tf/cfg/overrides/execs_binds.cfg")).toBe("app");
    expect(classifyCfgOrigin("tf/cfg/overrides/modules.cfg")).toBe("app");
    expect(classifyCfgOrigin("tf/cfg/config.cfg")).toBe("engine");
    expect(classifyCfgOrigin("tf/cfg/mtp.cfg")).toBe("engine");
    expect(classifyCfgOrigin("tf/cfg/360controller-linux.cfg")).toBe("engine");
    expect(classifyCfgOrigin("tf/custom/rayshud/cfg/hud_reset.cfg", "rayshud")).toBe("hud");
    expect(classifyCfgOrigin("tf/custom/-rayshud/cfg/hud_reset.cfg", "rayshud")).toBe("hud");
    expect(classifyCfgOrigin("tf/custom/someotherpack/cfg/extra.cfg", "rayshud")).toBe("pack");
    expect(classifyCfgOrigin("tf/custom/someotherpack/cfg/extra.cfg", null)).toBe("pack");
    expect(classifyCfgOrigin("tf/custom/comfig-custom/user.cfg")).toBe("comfigImport");
  });

  it("keeps config.cfg editable but makes other provided files read-only", () => {
    expect(cfgFileMeta("tf/cfg/config.cfg")).toMatchObject({ editable: true, advisory: false });
    expect(cfgFileMeta("tf/cfg/mtp.cfg")).toMatchObject({ editable: false, advisory: true });
    expect(cfgFileMeta("tf/custom/rayshud/cfg/x.cfg", "rayshud")).toMatchObject({
      editable: false,
      advisory: true,
      badge: "HUD",
    });
    expect(cfgFileMeta("tf/cfg/overrides/autoexec.cfg")).toMatchObject({
      editable: true,
      advisory: false,
      badge: null,
    });
  });
});

describe("canSaveCfg", () => {
  it("refuses a block-tier bundle", () => {
    expect(canSaveCfg(false, false, false, true)).toBe(false);
  });

  it("allows warn-only dirty writes while unlocked", () => {
    expect(canSaveCfg(true, false, false, true)).toBe(true);
  });

  it("refuses writes while TF2 is running", () => {
    expect(canSaveCfg(true, true, false, true)).toBe(false);
  });

  it("refuses writes while busy or clean", () => {
    expect(canSaveCfg(true, false, true, true)).toBe(false);
    expect(canSaveCfg(true, false, false, false)).toBe(false);
  });

  it("refuses writes to non-editable provided files", () => {
    expect(canSaveCfg(true, false, false, true, false)).toBe(false);
  });
});

describe("findingTierClass", () => {
  it("returns a distinct token class per tier", () => {
    expect(findingTierClass("block")).toContain("team-red");
    expect(findingTierClass("warn")).toContain("q-strange");
    expect(findingTierClass("info")).toContain("panel-raised");
  });
});

describe("lintBundle", () => {
  it("blocks unbindall and sv_cheats 1", () => {
    expect(lintBundle([{ path: "autoexec.cfg", text: "unbindall" }]).ok).toBe(false);
    expect(lintBundle([{ path: "autoexec.cfg", text: "sv_cheats 1" }]).ok).toBe(false);
  });

  it("allows fov_desired 90", () => {
    const result = lintBundle([{ path: "autoexec.cfg", text: "fov_desired 90" }]);
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("accepts Valve's engine-managed config.cfg reset and menu bind", () => {
    const result = lintBundle([
      {
        path: "tf/cfg/config.cfg",
        text: [
          'cfgver "1"',
          "unbindall",
          'bind "w" "+forward"',
          'bind "ESCAPE" "cancelselect"',
          'con_enable "0"',
        ].join("\n"),
      },
    ]);

    expect(result.ok).toBe(true);
    expect(result.findings.filter((finding) => finding.tier === "block")).toEqual([]);
  });

  it("still blocks reset and lockout commands in user-authored cfg files", () => {
    expect(
      lintBundle([
        { path: "tf/cfg/config.cfg", text: 'unbindall\nbind escape "cancelselect"' },
        { path: "tf/cfg/overrides/autoexec.cfg", text: "unbindall" },
      ]).ok,
    ).toBe(false);
    expect(lintBundle([{ path: "tf/cfg/config.cfg", text: 'bind escape "kill"' }]).ok).toBe(false);
  });

  it("demotes HUD- and pack-provided block findings to advisory warns", () => {
    const result = lintBundle(
      [
        { path: "tf/cfg/overrides/autoexec.cfg", text: "fov_desired 90" },
        { path: "tf/custom/rayshud/cfg/hud_reset.cfg", text: "unbindall\nsv_cheats 1" },
      ],
      "rayshud",
    );
    expect(result.ok).toBe(true);
    const demoted = result.findings.filter((finding) => finding.advisory);
    expect(demoted.length).toBeGreaterThanOrEqual(2);
    for (const finding of demoted) {
      expect(finding.tier).toBe("warn");
      expect(finding.file).toBe("tf/custom/rayshud/cfg/hud_reset.cfg");
    }
  });

  it("treats host_writeconfig as warn, not block", () => {
    const result = lintBundle([{ path: "autoexec.cfg", text: "host_writeconfig" }]);
    expect(result.ok).toBe(true);
    expect(result.findings.some((finding) => finding.tier === "block")).toBe(false);
    expect(
      result.findings.some(
        (finding) => finding.ruleId === "host-writeconfig" && finding.tier === "warn",
      ),
    ).toBe(true);
    expect(result.findings[0]).toMatchObject({
      ruleId: "host-writeconfig",
      message: expect.stringContaining("host_writeconfig"),
      file: "autoexec.cfg",
      line: 1,
    });
  });
});
