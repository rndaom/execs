import { describe, expect, it } from "vitest";
import {
  forbiddenLaunchNotice,
  forbiddenLaunchTokens,
  recommendedLaunchOptions,
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
    expect(forbiddenLaunchTokens("-dxlevel90")).toEqual([]);
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

describe("the shared write gate", () => {
  it("refuses while TF2 runs or a write is in flight", () => {
    expect(canWrite(false, false)).toBe(true);
    expect(canWrite(true, false)).toBe(false);
    expect(canWrite(false, true)).toBe(false);
    expect(canWrite(true, true)).toBe(false);
  });
});
