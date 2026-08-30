import { describe, expect, it } from "vitest";
import { canEditLaunch, recommendedLaunchOptions, steamWriteCopy } from "./launch-ui";

const RECOMMENDED = "-novid -nojoy -nosteamcontroller -nohltv -particles 1";

describe("launch UI helpers", () => {
  it("matches the Rust recommended set on both OS values", () => {
    expect(recommendedLaunchOptions("linux")).toBe(RECOMMENDED);
    expect(recommendedLaunchOptions("windows")).toBe(RECOMMENDED);
  });

  it("blocks edits while TF2 is running or busy", () => {
    expect(canEditLaunch(false, false)).toBe(true);
    expect(canEditLaunch(true, false)).toBe(false);
    expect(canEditLaunch(false, true)).toBe(false);
    expect(canEditLaunch(true, true)).toBe(false);
  });

  it("explains Steam write without asking them to quit", () => {
    expect(steamWriteCopy("written")).toBe("Wrote Steam launch options.");
    expect(steamWriteCopy("steam_open")).toBe(
      "Saved on the profile. Steam is open — copy into TF2 Properties yourself.",
    );
    expect(steamWriteCopy("no_account")).toBe(
      "Saved on the profile. Could not find a Steam userdata folder.",
    );
    expect(steamWriteCopy("steam_open")).not.toMatch(/quit Steam/i);
    expect(steamWriteCopy("no_account")).not.toMatch(/quit Steam/i);
  });
});
