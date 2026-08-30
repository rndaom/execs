import { describe, expect, it } from "vitest";
import { canSaveCfg, cfgFiles, findingTierClass, lintBundle } from "./files-ui";

describe("cfgFiles", () => {
  it("filters non-cfg paths and sorts the rest", () => {
    expect(
      cfgFiles([
        { path: "tf/custom/pack.vpk" },
        { path: "tf/cfg/overrides/modules.cfg" },
        { path: "readme.txt" },
        { path: "tf/cfg/autoexec.cfg" },
      ]),
    ).toEqual([{ path: "tf/cfg/autoexec.cfg" }, { path: "tf/cfg/overrides/modules.cfg" }]);
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
