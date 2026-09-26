import { describe, expect, it } from "vitest";
import type { ProfileDetail } from "./bridge";
import { type OverviewInput, overviewRows } from "./overview-ui";

const detail: ProfileDetail = {
  id: "p1",
  name: "Main",
  launchOptions: "-novid -nojoy",
  layer: "comfig",
  files: [],
  hud: { id: "rayshud", source: "hudDb", options: {} },
  crosshair: {
    id: "c1",
    shape: "plus-gap",
    assignments: { tf_weapon_scattergun: "dot" },
  },
  viewmodel: null,
  hitsound: { hit: { name: "Quack", source: "file" } },
  mods: [],
};

function input(overrides: Partial<OverviewInput> = {}): OverviewInput {
  return {
    detail,
    comfig: { preset: "medium", modules: { shadows: "low" }, addons: [] },
    effective: { fov_desired: "90", sensitivity: "2.5", viewmodel_fov: "70" },
    binds: { w: "+forward", a: "+moveleft" },
    settingsComplete: true,
    launchOptions: "-novid -nojoy +exec autoexec",
    ...overrides,
  };
}

function values(rows: ReturnType<typeof overviewRows>) {
  return Object.fromEntries(rows.map((row) => [row.label, row.value]));
}

describe("overviewRows", () => {
  it("summarises each area in the order the sidebar lists them", () => {
    const rows = overviewRows(input());
    expect(rows.map((row) => row.tab)).toEqual([
      "comfig",
      "hud",
      "crosshair",
      "viewmodels",
      "sounds",
      "gameplay",
      "binds",
      "mods",
      "launch",
    ]);
    expect(values(rows)).toEqual({
      Graphics: "Medium preset · 1 module change",
      HUD: "rayshud",
      Crosshair: "Custom plus gap · 1 weapon override",
      Viewmodels: "FOV 70°",
      Sounds: "Hit: Quack · Kill: default",
      Gameplay: "FOV 90° · Sensitivity 2.5",
      Binds: "2 keys bound",
      Mods: "None",
      Launch: "3 launch options",
    });
  });

  it("does not claim startup values it could not read", () => {
    const rows = values(overviewRows(input({ settingsComplete: false })));
    expect(rows.Gameplay).toBe("Needs review");
    expect(rows.Binds).toBe("Needs review");
    expect(rows.Viewmodels).toBe("Needs review");
    // Saved records do not depend on the startup cfg read.
    expect(rows.HUD).toBe("rayshud");
    expect(rows.Crosshair).toBe("Custom plus gap · 1 weapon override");
  });

  it("describes defaults and the vanilla cfg layer plainly", () => {
    const rows = values(
      overviewRows(
        input({
          detail: {
            ...detail,
            layer: "vanilla",
            hud: null,
            crosshair: null,
            hitsound: null,
          },
          effective: {},
          binds: {},
          launchOptions: "",
        }),
      ),
    );
    expect(rows).toMatchObject({
      Graphics: "TF2's own graphics settings",
      HUD: "TF2 default",
      Crosshair: "In-game",
      Viewmodels: "TF2 default",
      Sounds: "TF2 default",
      Gameplay: "TF2 default",
      Binds: "No keys bound",
      Launch: "None",
    });
  });
});
