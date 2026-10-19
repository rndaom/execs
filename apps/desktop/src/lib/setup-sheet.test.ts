import { describe, expect, it } from "vitest";
import type { HudCatalogEntry, ProfileDetail } from "./bridge";
import { defaultGameplay } from "./gameplay-ui";
import { type SheetInput, sheetGroups, UNREADABLE } from "./setup-sheet";

const DETAIL: ProfileDetail = {
  id: "fps",
  name: "FPS",
  launchOptions: "",
  layer: "comfig",
  files: [],
};

function input(overrides: Partial<SheetInput> = {}): SheetInput {
  return {
    detail: DETAIL,
    gameplay: defaultGameplay(),
    boundKeys: 40,
    comfig: { preset: "high", modules: {}, addons: [] },
    launchOptions: "-novid",
    cfgFiles: 6,
    casualChoices: 0,
    catalog: [],
    ...overrides,
  };
}

function rows(value: SheetInput) {
  return Object.fromEntries(
    sheetGroups(value).flatMap((group) =>
      group.rows.map((row) => [row.key, { value: row.value, more: row.more, tab: row.tab }]),
    ),
  );
}

describe("Edit page rows", () => {
  it("lists every group in the sidebar's order, each row opening its pane", () => {
    const groups = sheetGroups(input());
    expect(groups.map((group) => group.label)).toEqual([
      "Look",
      "Feel",
      "Sound",
      "Mods",
      "Performance",
      "Advanced",
    ]);
    expect(groups.map((group) => group.rows.map((row) => row.tab))).toEqual([
      ["hud", "crosshair", "viewmodels"],
      ["gameplay", "gameplay", "gameplay", "binds"],
      ["sounds", "sounds", "sounds"],
      ["mods"],
      ["comfig"],
      ["launch", "files"],
    ]);
  });

  it("reads a setup left as TF2 has it", () => {
    const all = rows(input());
    expect(all.hud.value).toBe("TF2's own");
    expect(all.crosshair.value).toBe("TF2's own");
    expect(all.fov.value).toBe("90°");
    expect(all["hit-sound"].value).toBe("Off");
    expect(all.mods.value).toBe("None");
    expect(all.performance).toMatchObject({ value: "mastercomfig High", more: undefined });
    expect(all.launch.value).toBe("-novid");
    expect(all.files.value).toBe("6 files");
    expect(all.binds.value).toBe("40 keys bound");
  });

  it("names the HUD, crosshair, sounds and mods the setup holds", () => {
    const catalog = [{ id: "rayshud", name: "rayshud" }] as unknown as HudCatalogEntry[];
    const all = rows(
      input({
        catalog,
        detail: {
          ...DETAIL,
          hud: { id: "rayshud", source: "catalog", options: { a: "1", b: "2" } } as never,
          crosshair: {
            id: "execs-crosshairs",
            shape: "dot",
            assignments: { tf_weapon_sniperrifle: "circle" },
          },
          hitsound: { hit: { name: "quake_hit.wav", source: "community" } },
          mods: [
            { id: "1", name: "Better particles" },
            { id: "2", name: "No hats" },
          ] as never,
        },
        gameplay: { ...defaultGameplay(), tf_dingalingaling: 1, tf_dingalingaling_lasthit: 1 },
        casualChoices: 2,
      }),
    );
    expect(all.hud).toMatchObject({ value: "rayshud", more: "2 options set" });
    // The pack's id is not a crosshair; its shape is.
    expect(all.crosshair.value).not.toMatch(/execs/i);
    expect(all.crosshair.more).toBe("different per weapon");
    expect(all["hit-sound"].value).toBe("Quake hit");
    expect(all["kill-sound"].value).toBe("TF2's own");
    expect(all.mods).toMatchObject({
      value: "Better particles, No hats",
      more: "2 Casual choices",
    });
  });

  it("says when cfg values cannot be read instead of guessing", () => {
    const all = rows(input({ gameplay: null, boundKeys: null }));
    for (const key of ["fov", "sensitivity", "weapons", "binds", "volume", "viewmodels"]) {
      expect(all[key].value).toBe(UNREADABLE);
    }
    // What the profile itself records still shows.
    expect(all.launch.value).toBe("-novid");
  });

  it("describes setups without mastercomfig, and helpers that are off", () => {
    const all = rows(
      input({
        detail: { ...DETAIL, layer: "vanilla" },
        gameplay: { ...defaultGameplay(), cl_autoreload: 0, hud_fastswitch: 0, volume: 0.5 },
        launchOptions: " ",
      }),
    );
    expect(all.performance.value).toBe("No mastercomfig");
    expect(all.weapons.value).toBe("No helpers");
    expect(all.volume.value).toBe("50%");
    expect(all.launch.value).toBe("None");
  });
});
