import { describe, expect, it } from "vitest";
import {
  EXECS_PRELOAD_LAUNCH,
  EXECS_PRELOAD_OVERRIDES_STEM,
  hasPreloadLaunch,
  parseWeaponOption,
  SAFE_VIEWMODEL_COMPILE_CAPABILITY,
  serializePreloadCfg,
  serializeWeaponOption,
  withPreloadLaunch,
} from "./viewmodel-ui";

describe("viewmodel ui", () => {
  it("adds and removes the preload launch token without touching forbidden flags", () => {
    const base = "-novid -nojoy -nosteamcontroller -nohltv -particles 1";
    const enabled = withPreloadLaunch(base, true);
    expect(enabled).toContain("+exec");
    expect(enabled).toContain("execs_preload");
    expect(hasPreloadLaunch(enabled)).toBe(true);
    expect(hasPreloadLaunch(EXECS_PRELOAD_LAUNCH)).toBe(true);
    const comfig = `-novid +exec ${EXECS_PRELOAD_OVERRIDES_STEM}`;
    expect(hasPreloadLaunch(comfig)).toBe(true);
    expect(withPreloadLaunch(comfig, false)).toBe("-novid");
    expect(withPreloadLaunch(enabled, false)).toBe(base);
    expect(withPreloadLaunch(`${base} -autoconfig +quit`, true)).toContain(EXECS_PRELOAD_LAUNCH);
  });

  it("round-trips weapon knobs", () => {
    const raw = serializeWeaponOption({
      ...parseWeaponOption("{}"),
      hide: true,
      originX: 2,
    });
    expect(parseWeaponOption(raw).hide).toBe(true);
    expect(parseWeaponOption(raw).originX).toBe(2);
    const extras = serializeWeaponOption({
      ...parseWeaponOption("{}"),
      extra: { ...parseWeaponOption("{}").extra, keepBeamVisible: true, removeShells: true },
    });
    expect(parseWeaponOption(extras).extra.keepBeamVisible).toBe(true);
    expect(parseWeaponOption(extras).extra.removeShells).toBe(true);
  });

  it("writes a file-safe itemtest preload cfg", () => {
    const cfg = serializePreloadCfg();
    expect(cfg).toContain("map itemtest");
    expect(cfg).toContain("disconnect");
    expect(cfg).not.toContain("+quit");
    expect(cfg).not.toContain("gameinfo");
    expect(SAFE_VIEWMODEL_COMPILE_CAPABILITY.available).toBe(false);
    expect(SAFE_VIEWMODEL_COMPILE_CAPABILITY.reason).toContain("Import a prebuilt VPK");
  });
});
