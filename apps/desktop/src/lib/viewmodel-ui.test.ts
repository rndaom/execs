import { describe, expect, it } from "vitest";
import {
  EXECS_PRELOAD_LAUNCH,
  hasPreloadLaunch,
  parseHiddenGroups,
  previewViewmodelRecord,
  seedViewmodelDraft,
  serializeHiddenGroups,
  serializePreloadCfg,
  toggleHiddenGroup,
  withPreloadLaunch,
} from "./viewmodel-ui";

describe("viewmodel ui", () => {
  it("adds and removes the preload launch token without disturbing other options", () => {
    const base = "-novid -nojoy";
    const withPreload = withPreloadLaunch(base, true);
    expect(withPreload).toBe(`-novid -nojoy ${EXECS_PRELOAD_LAUNCH}`);
    expect(hasPreloadLaunch(withPreload)).toBe(true);
    expect(withPreloadLaunch(withPreload, false)).toBe(base);
    expect(hasPreloadLaunch(withPreloadLaunch("+exec overrides/execs_preload", false))).toBe(false);
  });

  it("keeps the preload cfg an itemtest listen precache", () => {
    const cfg = serializePreloadCfg();
    expect(cfg).toContain("sv_pure -1");
    expect(cfg).toContain("sv_allow_point_servercommand always");
    expect(cfg).toContain("map itemtest");
    expect(cfg).toContain("disconnect");
    expect(cfg).toContain("playmenumusic");
    expect(cfg).not.toContain("+quit");
    expect(cfg).not.toContain("gameinfo");
  });

  it("round-trips hidden groups through the record options", () => {
    const hidden = ["scout/scatterguns", "soldier/rockets", "scout/scatterguns"];
    const raw = serializeHiddenGroups(hidden);
    expect(raw).toBe("scout/scatterguns,soldier/rockets");
    expect(parseHiddenGroups(raw)).toEqual(["scout/scatterguns", "soldier/rockets"]);
    expect(parseHiddenGroups("")).toEqual([]);
    expect(parseHiddenGroups(undefined)).toEqual([]);
  });

  it("seeds the draft from a record and ignores legacy compiled-era keys", () => {
    const record = previewViewmodelRecord();
    const seeded = seedViewmodelDraft(record);
    expect(seeded.preload).toBe(true);
    expect(seeded.hidden).toEqual(["scout/melee", "scout/scatterguns"]);
    const legacy = seedViewmodelDraft({
      id: "execs-viewmodels",
      source: "imported",
      preload: false,
      options: { scattergun: '{"hide":true}' },
    });
    expect(legacy.hidden).toEqual([]);
    expect(legacy.preload).toBe(false);
  });

  it("toggles hidden groups deterministically", () => {
    let hidden: string[] = [];
    hidden = toggleHiddenGroup(hidden, "soldier/rockets");
    hidden = toggleHiddenGroup(hidden, "scout/melee");
    expect(hidden).toEqual(["scout/melee", "soldier/rockets"]);
    hidden = toggleHiddenGroup(hidden, "soldier/rockets");
    expect(hidden).toEqual(["scout/melee"]);
  });
});
