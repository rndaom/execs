import { describe, expect, it } from "vitest";
import {
  appendLaunchOption,
  buildLaunchPreset,
  forbiddenLaunchNotice,
  forbiddenLaunchTokens,
  LAUNCH_PRESET_PAGE_SIZE,
  LAUNCH_PRESETS,
  type LaunchPreset,
  type LaunchPresetId,
  launchOptionGroups,
  launchPresetConflict,
  launchPresetPresent,
  launchSteamCopy,
  launchSteamState,
  launchSyncAction,
  launchSyncWarning,
  recommendedLaunchOptions,
  removeLaunchOption,
  searchLaunchPresets,
  strippedLaunchNotice,
  strippedLaunchTokens,
} from "./launch-ui";
import { canWrite } from "./write-gate";

const RECOMMENDED = "-novid -nojoy -nosteamcontroller -nohltv -particles 1";

function preset(id: LaunchPresetId): LaunchPreset {
  const found = LAUNCH_PRESETS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing launch preset ${id}`);
  return found;
}

describe("launch UI helpers", () => {
  it("matches the Rust recommended set", () => {
    expect(recommendedLaunchOptions()).toBe(RECOMMENDED);
  });

  it("explains each Steam state without asking the player to quit Steam", () => {
    const states = [
      "unsaved",
      "in-steam",
      "steam-open",
      "steam-closed",
      "write-failed",
      "no-account",
      "unknown",
    ] as const;
    for (const state of states) {
      expect(launchSteamCopy(state, false)).not.toMatch(/quit Steam/i);
    }
    expect(launchSteamCopy("in-steam", false)).toBe("Saved to this profile and in Steam.");
    expect(launchSteamCopy("unsaved", true)).toContain("after TF2 closes");
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
  it("searches the documented catalog by flag and purpose", () => {
    expect(LAUNCH_PRESETS.length).toBeGreaterThan(LAUNCH_PRESET_PAGE_SIZE);
    expect(searchLaunchPresets("texture streaming").map((option) => option.id)).toEqual([
      "no_texture_stream",
    ]);
    expect(searchLaunchPresets("-displayindex").map((option) => option.id)).toEqual([
      "displayindex",
    ]);
  });
  it("builds only catalog options with bounded numeric values", () => {
    const values = { refresh: "144", width: "1920", height: "1080" };
    expect(buildLaunchPreset(preset("console"), values)).toBe("-console");
    expect(buildLaunchPreset(preset("freq"), values)).toBe("-freq 144");
    expect(buildLaunchPreset(preset("resolution"), values)).toBe("-w 1920 -h 1080");
    expect(buildLaunchPreset(preset("freq"), { ...values, refresh: "144 +quit" })).toBeNull();
    expect(buildLaunchPreset(preset("resolution"), { ...values, height: "0" })).toBeNull();
    expect(buildLaunchPreset(preset("resolution"), { ...values, height: "360" })).toBeNull();
    expect(buildLaunchPreset(preset("resolution"), { ...values, height: "360" }, true)).toBe(
      "-w 1920 -h 360",
    );
    expect(buildLaunchPreset(preset("displayindex"), { ...values, displayIndex: "0" })).toBe(
      "-displayindex 0",
    );
    expect(buildLaunchPreset(preset("displayindex"), { ...values, displayIndex: "17" })).toBeNull();
  });
  it("detects options already present in a profile", () => {
    expect(launchPresetPresent("-novid -freq 144", preset("novid"))).toBe(true);
    expect(launchPresetPresent("-novid -freq 144", preset("freq"))).toBe(true);
    expect(launchPresetPresent("-w 1920", preset("resolution"))).toBe(true);
    expect(launchPresetPresent("-novid", preset("console"))).toBe(false);
    expect(launchPresetPresent("-refresh 144", preset("freq"))).toBe(true);
    expect(launchPresetPresent("-sw", preset("windowed"))).toBe(true);
    expect(launchPresetPresent("-full", preset("fullscreen"))).toBe(true);
    expect(launchPresetConflict("-fullscreen", preset("windowed"))).toBe("-fullscreen");
    expect(launchPresetConflict("-windowed", preset("fullscreen"))).toBe("-windowed");
  });
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

describe("launch sync", () => {
  const status = (inSync: boolean, steamRunning: boolean, steamOptions: string | null = "") => ({
    inSync,
    steamRunning,
    steamOptions,
  });

  it("launches directly when Steam already has the profile's options", () => {
    expect(launchSyncAction(status(true, true))).toBe("launch");
    expect(launchSyncWarning(status(true, true))).toBeNull();
  });

  it("launches directly when the comparison is unavailable or there is no Steam account", () => {
    expect(launchSyncAction(null)).toBe("launch");
    expect(launchSyncAction(status(false, true, null))).toBe("launch");
    expect(launchSyncWarning(status(false, true, null))).toBeNull();
  });

  it("writes without asking when Steam is closed", () => {
    expect(launchSyncAction(status(false, false))).toBe("write-then-launch");
    expect(launchSyncWarning(status(false, false))).toBe("Launch options not in Steam");
  });

  it("asks before closing a running Steam", () => {
    expect(launchSyncAction(status(false, true))).toBe("ask");
    expect(launchSyncWarning(status(false, true))).toBe("Launch options not in Steam");
  });
});

describe("Launch pane Steam state", () => {
  const sync = (
    profileOptions: string,
    inSync: boolean,
    steamRunning: boolean,
    steamOptions: string | null = "-novid",
  ) => ({ profileOptions, inSync, steamRunning, steamOptions });

  it("reports an unsaved draft before anything about Steam", () => {
    expect(launchSteamState("-nojoy", "-novid", sync("-novid", true, false), "written")).toBe(
      "unsaved",
    );
  });

  it("claims Steam has the options only from the backend comparison or a confirmed write", () => {
    expect(launchSteamState("-novid", "-novid", sync("-novid", true, true), null)).toBe("in-steam");
    expect(launchSteamState("-novid", "-novid", null, "written")).toBe("in-steam");
    expect(launchSteamState("-novid", "-novid", null, null)).toBe("unknown");
  });

  it("separates a running Steam, a closed Steam, a failed write and no account", () => {
    expect(launchSteamState("-nojoy", "-nojoy", sync("-nojoy", false, true), null)).toBe(
      "steam-open",
    );
    expect(launchSteamState("-nojoy", "-nojoy", sync("-nojoy", false, false), null)).toBe(
      "steam-closed",
    );
    expect(launchSteamState("-nojoy", "-nojoy", sync("-nojoy", false, false), "write_failed")).toBe(
      "write-failed",
    );
    expect(launchSteamState("-nojoy", "-nojoy", sync("-nojoy", false, false, null), null)).toBe(
      "no-account",
    );
  });

  it("prefers a current comparison over an older write result", () => {
    // Steam replaced its copy after execs wrote it.
    expect(launchSteamState("-nojoy", "-nojoy", sync("-nojoy", false, true), "written")).toBe(
      "steam-open",
    );
  });

  it("ignores a comparison made for other profile options", () => {
    expect(launchSteamState("-nojoy", "-nojoy", sync("-novid", true, false), "steam_open")).toBe(
      "steam-open",
    );
    expect(launchSteamState("-nojoy", "-nojoy", sync("-novid", true, false), null)).toBe("unknown");
  });
});
