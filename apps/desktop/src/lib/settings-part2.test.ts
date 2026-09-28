import { describe, expect, it } from "vitest";
import {
  applyCustomBind,
  applyRecordedBind,
  BIND_ACTIONS,
  clearManagedKey,
  ownedCustomBinds,
  removeOwnedCustomBind,
  syncTrackedBindsFromConfig,
  validateCustomBind,
} from "./binds-ui";
import { MENU_SYNC_CVARS, managedCfgScopeOf, syncGameOptionsFromConfig } from "./gameplay-ui";

const menuValues: Record<string, string> = {
  fov_desired: "80",
  sensitivity: "2.125",
  zoom_sensitivity_ratio: "0.793471",
  cl_autoreload: "0",
  hud_fastswitch: "1",
  tf_medigun_autoheal: "1",
  hud_combattext: "1",
  hud_combattext_batching: "1",
  hud_combattext_healing: "1",
  viewmodel_fov: "64.125",
  cl_flipviewmodels: "1",
  tf_use_min_viewmodels: "1",
  tf_dingalingaling: "1",
  tf_dingalingaling_lasthit: "1",
  tf_dingaling_volume: "0.45",
  tf_dingaling_lasthit_volume: "0.6",
  tf_dingaling_pitchmindmg: "80",
  tf_dingaling_pitchmaxdmg: "120",
  tf_dingaling_lasthit_pitchmindmg: "75",
  tf_dingaling_lasthit_pitchmaxdmg: "150",
  tf_dingalingaling_effect: "3",
  tf_dingalingaling_last_effect: "8",
  cl_crosshair_file: "crosshair2",
  cl_crosshair_scale: "24.5",
  cl_crosshair_red: "255",
  cl_crosshair_green: "125",
  cl_crosshair_blue: "42",
};

describe("menu option reconciliation", () => {
  it.each(Object.keys(MENU_SYNC_CVARS) as Array<keyof typeof MENU_SYNC_CVARS>)(
    "updates only %s's existing scalar value spans",
    (scope) => {
      const names = Object.values(MENU_SYNC_CVARS).flat();
      const managed = names
        .map((name) => `\t${name.toUpperCase()}  "0" // kept ${name}\r\n`)
        .join("");
      const config = Object.entries(menuValues)
        .map(([name, value]) => `${name} "${value}"`)
        .join("; ");
      const next = syncGameOptionsFromConfig(managed, config, scope);
      for (const name of names) {
        const expected = (MENU_SYNC_CVARS[scope] as readonly string[]).includes(name)
          ? menuValues[name]
          : "0";
        expect(next).toContain(`\t${name.toUpperCase()}  "${expected}" // kept ${name}\r\n`);
        expect(managedCfgScopeOf(name)).toBe(
          Object.entries(MENU_SYNC_CVARS).find(([, group]) =>
            (group as readonly string[]).includes(name),
          )?.[0],
        );
      }
    },
  );
  it("preserves neighboring commands, aliases, malformed values and exact equal decimals", () => {
    const managed =
      'viewmodel_fov "54"; echo keep // preserved\r\nalias mine "viewmodel_fov 60"\r\ntf_dingaling_volume "0.750000"\r\n';
    expect(syncGameOptionsFromConfig(managed, "viewmodel_fov 70; tf_dingaling_volume 0.75")).toBe(
      managed.replace('"54"', '"70"'),
    );
    expect(syncGameOptionsFromConfig(managed, "viewmodel_fov 60; viewmodel_fov nope")).toBe(
      managed,
    );
    expect(syncGameOptionsFromConfig(managed, 'viewmodel_fov "60')).toBe(managed);
    expect(syncGameOptionsFromConfig(managed, "tf_use_min_viewmodels 1")).toBe(managed);
  });
  it.each([
    ["viewmodel_fov", "53.9"],
    ["viewmodel_fov", "70.1"],
    ["fov_desired", "74"],
    ["fov_desired", "91"],
    ["cl_flipviewmodels", "2"],
    ["tf_use_min_viewmodels", "-1"],
    ["tf_dingaling_volume", "1.1"],
    ["tf_dingaling_volume", "-0.1"],
    ["tf_dingaling_pitchmindmg", "256"],
    ["tf_dingaling_pitchmaxdmg", "0"],
    ["tf_dingalingaling_last_effect", "1.5"],
    ["cl_crosshair_file", "custom/author"],
    ["cl_crosshair_red", "256"],
    ["cl_crosshair_green", "0.5"],
    ["cl_crosshair_scale", "65"],
  ])("does not adopt invalid menu %s=%s", (name, value) => {
    const managed = `${name} 42\n`;
    expect(syncGameOptionsFromConfig(managed, `${name} "${value}"`)).toBe(managed);
  });
  it("accepts all sound bounds and empty stock crosshair without introducing settings", () => {
    expect(
      syncGameOptionsFromConfig(
        "cl_crosshair_file crosshair1\ntf_dingaling_volume 1\ntf_dingaling_pitchmindmg 10\n",
        'cl_crosshair_file ""; tf_dingaling_volume 0; tf_dingaling_pitchmindmg 255; tf_dingalingaling 1',
      ),
    ).toBe('cl_crosshair_file ""\ntf_dingaling_volume 0\ntf_dingaling_pitchmindmg 255\n');
  });
});

describe("custom binds", () => {
  it.each(["say gg", "kill", "disguise 5 1", "build 2 0", "say gg; explode"])(
    "validates and stores %s as one deferred bind",
    (command) => {
      expect(validateCustomBind(command).problem).toBeNull();
      const text = applyCustomBind("", "f6", command);
      expect(ownedCustomBinds(text)).toEqual([{ key: "f6", command }]);
      expect(syncTrackedBindsFromConfig(text, { f6: command })).toBe(text);
    },
  );
  it.each([
    'say "gg"',
    "say gg\nunbindall",
    "say gg\u0000",
    "// comment",
    "alias bind bad",
    "con_enable 0",
  ])("refuses unsafe or unrepresentable %s", (command) => {
    expect(validateCustomBind(command).problem).not.toBeNull();
    expect(applyCustomBind("unchanged\n", "f6", command)).toBe("unchanged\n");
  });
  it("preserves unmarked author lines and comments through assignment, removal and rebind", () => {
    const author =
      'alias combo "say gg; kill"\r\nbind f6 combo // author\r\nbind f7 "say old" // execs:custom-bind extra\r\n';
    const created = applyCustomBind(author, "f6", "say gg");
    expect(created.startsWith(author)).toBe(true);
    expect(removeOwnedCustomBind(created, "f6")).toBe(author);
    expect(clearManagedKey(created, "f6")).toBe(`${author}unbind f6\r\n`);
    const rebound = applyRecordedBind(created, "jump", "f6");
    expect(rebound).toBe(`${author}bind f6 +jump\r\n`);
    expect(ownedCustomBinds(rebound)).toEqual([]);
  });
  it("retires a custom override when TF2 removes or rebinds its key", () => {
    const text = applyCustomBind("// kept\n", "f6", "say gg");
    expect(syncTrackedBindsFromConfig(text, {})).not.toContain("bind f6");
    expect(syncTrackedBindsFromConfig(text, { f6: "say changed" })).not.toContain("bind f6");
    expect(syncTrackedBindsFromConfig(text, { f6: "+jump" })).toContain("bind f6 +jump");
  });
  it("covers every ordinary voice command and correctly numbered class actions", () => {
    const commands = new Set(BIND_ACTIONS.map((action) => action.command));
    for (let menu = 0; menu < 3; menu++)
      for (let item = 0; item < 8; item++)
        expect(commands.has(`voicemenu ${menu} ${item}` as never)).toBe(true);
    for (const command of [
      "kill",
      "explode",
      "build 2 0",
      "build 0 0",
      "build 1 1",
      "destroy 2 0",
      "disguise 5 1",
      "disguise 7 2",
    ])
      expect(commands.has(command as never)).toBe(true);
  });
});
