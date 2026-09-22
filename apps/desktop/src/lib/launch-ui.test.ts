import { describe, expect, it } from "vitest";
import {
  appendLaunchOption,
  forbiddenLaunchNotice,
  forbiddenLaunchTokens,
  launchOptionGroups,
  recommendedLaunchOptions,
  removeLaunchOption,
  steamWriteCopy,
  strippedLaunchNotice,
  strippedLaunchTokens,
} from "./launch-ui";
import { canWrite } from "./write-gate";

const RECOMMENDED = "-novid -nojoy -nosteamcontroller -nohltv -particles 1";

describe("launch UI helpers", () => {
  it("matches the Rust recommended set", () => {
    expect(recommendedLaunchOptions()).toBe(RECOMMENDED);
  });

  it("explains Steam write without asking them to quit", () => {
    expect(steamWriteCopy("written")).toBe("Wrote Steam launch options.");
    expect(steamWriteCopy("steam_open")).toBe(
      "Saved. Steam is open — copy into TF2 Properties yourself.",
    );
    expect(steamWriteCopy("no_account")).toBe("Saved. No Steam userdata folder found.");
    expect(steamWriteCopy("write_failed")).toBe(
      "Saved to the profile. Steam could not be updated yet.",
    );
    expect(steamWriteCopy("steam_open")).not.toMatch(/quit Steam/i);
    expect(steamWriteCopy("no_account")).not.toMatch(/quit Steam/i);
  });
});

describe("forbidden launch flags", () => {
  it("flags every banned token as you type", () => {
    expect(forbiddenLaunchTokens("-novid -autoconfig")).toEqual(["-autoconfig"]);
    expect(forbiddenLaunchTokens("-dxlevel 90 +quit")).toEqual(["-dxlevel", "+quit"]);
    expect(forbiddenLaunchTokens("gamemoderun %command%")).toEqual(["gamemoderun", "%command%"]);
    expect(forbiddenLaunchTokens("-DEFAULT")).toEqual(["-default"]);
  });

  it("does not flag a clean or lookalike string", () => {
    expect(forbiddenLaunchTokens(RECOMMENDED)).toEqual([]);
    // A substring of another flag must not match.
    expect(forbiddenLaunchTokens("-dxlevel90")).toEqual(["-dxlevel"]);
    expect(forbiddenLaunchTokens("")).toEqual([]);
  });

  it("reports what the backend actually removed on save", () => {
    expect(strippedLaunchTokens("-novid -autoconfig +quit", "-novid")).toEqual([
      "-autoconfig",
      "+quit",
    ]);
    expect(strippedLaunchTokens("-novid", "-novid")).toEqual([]);
    expect(strippedLaunchTokens("-novid +quit", "-novid +quit")).toEqual([]);
  });

  it("writes a notice only when there is something to say", () => {
    expect(forbiddenLaunchNotice([])).toBe("");
    expect(forbiddenLaunchNotice(["-autoconfig"])).toContain("-autoconfig");
    expect(strippedLaunchNotice([])).toBe("");
    expect(strippedLaunchNotice(["+quit"])).toContain("+quit");
  });
});

describe("launch option editing", () => {
  it("does not guess removal boundaries for quoted option-looking data or wrappers", () => {
    expect(launchOptionGroups('+echo "-not a flag" -novid')).toBeNull();
    expect(launchOptionGroups('"-novid" -console')).toBeNull();
    expect(launchOptionGroups("env X=1 %command% -novid")).toBeNull();
  });
  it("appends without rewriting the existing quoted source string", () => {
    const raw = '  +exec "my config.cfg"\t';
    expect(appendLaunchOption(raw, " -particles 1 ")).toBe(`${raw}-particles 1`);
    expect(appendLaunchOption("-novid", '+exec "my config.cfg"')).toBe(
      '-novid +exec "my config.cfg"',
    );
    expect(appendLaunchOption(raw, "  ")).toBe(raw);
  });
  it("keeps quoted values and negative numeric arguments with their option", () => {
    const raw = '-novid +exec "my config.cfg" -particles 1 +volume -1';
    const groups = launchOptionGroups(raw);
    expect(groups?.map((group) => group.text)).toEqual([
      "-novid",
      '+exec "my config.cfg"',
      "-particles 1",
      "+volume -1",
    ]);
    expect(removeLaunchOption(raw, groups?.[1] as NonNullable<typeof groups>[number])).toBe(
      "-novid -particles 1 +volume -1",
    );
  });
  it("leaves command sequences and incomplete quotes to the exact-string editor", () => {
    expect(launchOptionGroups("+echo done; -novid")).toBeNull();
    expect(launchOptionGroups('+exec "unfinished')).toBeNull();
    expect(launchOptionGroups('+exec "cfg;name.cfg" -novid')?.length).toBe(2);
  });
  it("does not remove a stale range and removes the last option cleanly", () => {
    const group = launchOptionGroups("-novid")?.[0];
    expect(group).toBeDefined();
    if (!group) return;
    expect(removeLaunchOption("-novid", group)).toBe("");
    expect(removeLaunchOption("-nojoy", group)).toBe("-nojoy");
  });
  it("warns for the quoted, fragmented and semicolon forms stripped by native saves", () => {
    expect(forbiddenLaunchTokens('-auto"config" +quit;echo ok -dxlevel95')).toEqual([
      "-autoconfig",
      "-dxlevel",
      "+quit",
    ]);
    expect(forbiddenLaunchTokens(String.raw`-auto\"config\" %com"mand"%`)).toEqual([
      "-autoconfig",
      "%command%",
    ]);
  });
});

describe("the shared write gate", () => {
  it("refuses while TF2 runs or a write is in flight", () => {
    expect(canWrite(false, false)).toBe(true);
    expect(canWrite(true, false)).toBe(false);
    expect(canWrite(false, true)).toBe(false);
    expect(canWrite(true, true)).toBe(false);
  });
});
