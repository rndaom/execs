import { describe, expect, it } from "vitest";
import {
  clampGameplay,
  defaultGameplay,
  ensureAutoexecExecLine,
  FOV_MAX,
  FOV_MIN,
  formatCvarNumber,
  GAMEPLAY_HEADER,
  GAMEPLAY_STEM,
  gameplayPath,
  parseSensitivityInput,
  SENSITIVITY_MAX,
  seedGameplay,
  serializeGameplay,
  serializeGameplayScope,
  syncGameOptionsFromConfig,
} from "./gameplay-ui";

describe("gameplay clamp", () => {
  it("clamps fov_desired to 54–90", () => {
    expect(clampGameplay({ ...defaultGameplay(), fov_desired: 10 }).fov_desired).toBe(FOV_MIN);
    expect(clampGameplay({ ...defaultGameplay(), fov_desired: 110 }).fov_desired).toBe(FOV_MAX);
    expect(clampGameplay({ ...defaultGameplay(), fov_desired: 75 }).fov_desired).toBe(75);
    expect(clampGameplay({ ...defaultGameplay(), fov_desired: 54.4 }).fov_desired).toBe(54);
    expect(clampGameplay({ ...defaultGameplay(), fov_desired: 89.6 }).fov_desired).toBe(90);
  });

  it("clamps viewmodel fov, scale, and color channels", () => {
    const next = clampGameplay({
      ...defaultGameplay(),
      viewmodel_fov: 200,
      cl_crosshair_scale: 8,
      cl_crosshair_red: -4,
      cl_crosshair_green: 300,
      cl_crosshair_blue: 12.2,
    });
    expect(next.viewmodel_fov).toBe(179.9);
    expect(next.cl_crosshair_scale).toBe(16);
    expect(next.cl_crosshair_red).toBe(0);
    expect(next.cl_crosshair_green).toBe(255);
    expect(next.cl_crosshair_blue).toBe(12);
  });
});

describe("gameplay serialize and parse", () => {
  it("serialize contains fov_desired and cl_crosshair_file", () => {
    const text = serializeGameplay({
      ...defaultGameplay(),
      fov_desired: 90,
      cl_crosshair_file: "crosshair3",
    });
    expect(text.startsWith(GAMEPLAY_HEADER)).toBe(true);
    expect(text).toContain("fov_desired 90");
    expect(text).toContain("cl_crosshair_file crosshair3");
  });

  it("round-trips parse and serialize", () => {
    const original = clampGameplay({
      ...defaultGameplay(),
      fov_desired: 80,
      viewmodel_fov: 70,
      tf_use_min_viewmodels: 1,
      r_drawviewmodel: 0,
      r_drawtracers_firstperson: 0,
      r_drawtracers: 1,
      cl_flipviewmodels: 1,
      cl_crosshair_file: "crosshair5",
      cl_crosshair_scale: 40,
      cl_crosshair_red: 10,
      cl_crosshair_green: 20,
      cl_crosshair_blue: 30,
      tf_dingalingaling: 1,
      tf_dingaling_volume: 0.4,
      tf_dingaling_pitchmindmg: 90,
      tf_dingaling_pitchmaxdmg: 120,
      tf_dingalingaling_effect: 3,
      tf_dingalingaling_repeat_delay: 0.25,
      tf_dingalingaling_lasthit: 1,
      tf_dingaling_lasthit_volume: 1,
      tf_dingaling_lasthit_pitchmindmg: 100,
      tf_dingaling_lasthit_pitchmaxdmg: 100,
      tf_dingalingaling_last_effect: 8,
    });
    expect(seedGameplay(serializeGameplay(original), {})).toEqual(original);
  });

  it("keeps the hit sound cvars inside their engine bounds", () => {
    const next = clampGameplay({
      ...defaultGameplay(),
      tf_dingaling_volume: 1.7,
      tf_dingaling_pitchmindmg: 0,
      tf_dingalingaling_effect: 12,
      tf_dingalingaling_repeat_delay: -1,
    });
    expect(next.tf_dingaling_volume).toBe(1);
    expect(next.tf_dingaling_pitchmindmg).toBe(1);
    expect(next.tf_dingalingaling_effect).toBe(8);
    expect(next.tf_dingalingaling_repeat_delay).toBe(0);
    expect(serializeGameplay(defaultGameplay())).toContain("tf_dingalingaling 0");
    expect(serializeGameplay(defaultGameplay())).toContain("tf_dingaling_volume 0.75");
  });

  it("parses quoted default crosshair as empty", () => {
    expect(seedGameplay('cl_crosshair_file ""\n', {}).cl_crosshair_file).toBe("");
    expect(seedGameplay("cl_crosshair_file 0\n", {}).cl_crosshair_file).toBe("");
    expect(serializeGameplay(defaultGameplay())).toContain('cl_crosshair_file ""');
  });

  it("preserves an external crosshair material when changing color or gameplay", () => {
    for (const seeded of [
      seedGameplay("cl_crosshair_file myreticle\n", {}),
      seedGameplay("", { cl_crosshair_file: "myreticle" }),
    ]) {
      expect(seeded.cl_crosshair_file).toBe("myreticle");
      const changed = { ...seeded, cl_crosshair_red: 17, fov_desired: 80 };
      const saved = serializeGameplay(changed);
      expect(saved).toContain("cl_crosshair_file myreticle\n");
      expect(seedGameplay(saved, {}).cl_crosshair_file).toBe("myreticle");
    }
  });

  it("quotes external material values that contain whitespace", () => {
    const seeded = seedGameplay('cl_crosshair_file "my reticle"\n', {});
    expect(seeded.cl_crosshair_file).toBe("my reticle");
    expect(seedGameplay(serializeGameplay(seeded), {}).cl_crosshair_file).toBe("my reticle");
  });

  it("uses sensible defaults including fov 90", () => {
    const defaults = defaultGameplay();
    expect(defaults.fov_desired).toBe(90);
    expect(defaults.viewmodel_fov).toBe(54);
    expect(defaults.r_drawviewmodel).toBe(1);
    expect(defaults.cl_flipviewmodels).toBe(0);
  });
});

describe("gameplay paths", () => {
  it("uses vanilla vs comfig paths", () => {
    expect(gameplayPath("comfig")).toBe("tf/cfg/overrides/execs_gameplay.cfg");
    expect(gameplayPath("vanilla")).toBe("tf/cfg/execs_gameplay.cfg");
  });
});

describe("gameplay seed", () => {
  it("seeds weapon controls from effective cfg and lets managed values win", () => {
    const effective = { cl_autoreload: "0", hud_fastswitch: "2" };
    expect(seedGameplay("", effective)).toMatchObject({ cl_autoreload: 0, hud_fastswitch: 2 });
    expect(seedGameplay("cl_autoreload 1\nhud_fastswitch 1\n", effective)).toMatchObject({
      cl_autoreload: 1,
      hud_fastswitch: 1,
    });
  });

  it.each([0, 1, 2, 3, 7])("preserves weapon selection mode %s through unrelated edits", (mode) => {
    const original = seedGameplay(`hud_fastswitch ${mode}\ncl_autoreload 0\n`, {});
    const changed = { ...original, fov_desired: 80, r_drawviewmodel: 0 as const };
    expect(seedGameplay(serializeGameplay(changed), {})).toMatchObject({
      hud_fastswitch: mode,
      cl_autoreload: 0,
      fov_desired: 80,
    });
  });

  it("acknowledges weapon controls only within the gameplay draft scope", () => {
    const original = defaultGameplay();
    const changed = { ...original, cl_autoreload: 0 as const, hud_fastswitch: 2 };
    expect(serializeGameplayScope(changed, "gameplay")).not.toBe(
      serializeGameplayScope(original, "gameplay"),
    );
    for (const scope of ["crosshair", "sounds"] as const) {
      expect(serializeGameplayScope(changed, scope)).toBe(serializeGameplayScope(original, scope));
    }
  });

  it.each([0.1, 45, 54.12345, 100, 179.9])(
    "preserves viewmodel FOV %s through unrelated edits",
    (value) => {
      for (const seeded of [
        seedGameplay(`viewmodel_fov ${value}\n`, {}),
        seedGameplay("", { viewmodel_fov: String(value) }),
      ]) {
        expect(seeded.viewmodel_fov).toBe(value);
        expect(serializeGameplay({ ...seeded, tf_use_min_viewmodels: 1 })).toContain(
          `viewmodel_fov ${value}\n`,
        );
      }
    },
  );
  it("lets the managed file win over effective cvars", () => {
    const seeded = seedGameplay("fov_desired 70\n", {
      fov_desired: "90",
      viewmodel_fov: "80",
    });
    expect(seeded.fov_desired).toBe(70);
    expect(seeded.viewmodel_fov).toBe(80);
  });

  it("reads effective when the managed file is empty", () => {
    expect(seedGameplay("", { fov_desired: "65" }).fov_desired).toBe(65);
    expect(seedGameplay("", {}).fov_desired).toBe(90);
  });
});

describe("autoexec exec line", () => {
  it("appends execs_gameplay without duplicating", () => {
    expect(ensureAutoexecExecLine("", GAMEPLAY_STEM, "vanilla")).toBe(
      "exec execs_gameplay // execs:managed\n",
    );
    expect(ensureAutoexecExecLine("echo hi\n", GAMEPLAY_STEM, "vanilla")).toBe(
      "echo hi\nexec execs_gameplay // execs:managed\n",
    );
    expect(ensureAutoexecExecLine("exec execs_gameplay.cfg\n", GAMEPLAY_STEM, "vanilla")).toBe(
      "exec execs_gameplay.cfg\n",
    );
    // The exec line is addressed from tf/cfg on the comfig layer.
    expect(ensureAutoexecExecLine("", GAMEPLAY_STEM, "comfig")).toBe(
      "exec overrides/execs_gameplay // execs:managed\n",
    );
  });
});

describe("mouse sensitivity", () => {
  it("keeps exact decimals from cfg and writes them back unrounded", () => {
    const seeded = seedGameplay("", { sensitivity: "2.3456", zoom_sensitivity_ratio: "0.793471" });
    expect(seeded.sensitivity).toBe(2.3456);
    expect(seeded.zoom_sensitivity_ratio).toBe(0.793471);
    const text = serializeGameplay(seeded);
    expect(text).toContain("\nsensitivity 2.3456\n");
    expect(text).toContain("\nzoom_sensitivity_ratio 0.793471\n");
    // The managed file wins over config.cfg, as for every Gameplay value.
    expect(seedGameplay("sensitivity 1.5\n", { sensitivity: "3" }).sensitivity).toBe(1.5);
  });

  it("uses TF2's defaults and ignores values that are not positive numbers", () => {
    expect(defaultGameplay().sensitivity).toBe(3);
    expect(defaultGameplay().zoom_sensitivity_ratio).toBe(1);
    expect(seedGameplay("", { sensitivity: "0", zoom_sensitivity_ratio: "abc" }).sensitivity).toBe(
      3,
    );
    expect(clampGameplay({ ...defaultGameplay(), sensitivity: -1 }).sensitivity).toBe(3);
  });

  it("belongs to the Gameplay scope only", () => {
    const settings = { ...defaultGameplay(), sensitivity: 2.5 };
    expect(serializeGameplayScope(settings, "gameplay")).toContain("sensitivity");
    expect(serializeGameplayScope(settings, "crosshair")).not.toContain("sensitivity");
    expect(serializeGameplayScope(settings, "sounds")).not.toContain("sensitivity");
  });

  it("formats numbers as plain cfg decimals", () => {
    expect(formatCvarNumber(2.35)).toBe("2.35");
    expect(formatCvarNumber(3)).toBe("3");
    expect(formatCvarNumber(0.0000001)).toBe("0.0000001");
  });

  it("accepts only plain positive decimals up to the limit", () => {
    expect(parseSensitivityInput(" 2.35 ")).toEqual({ value: 2.35, problem: null });
    expect(parseSensitivityInput(".5").value).toBe(0.5);
    expect(parseSensitivityInput("3.").value).toBe(3);
    expect(parseSensitivityInput("").problem).toBe("Enter a number, like 2.5.");
    expect(parseSensitivityInput("2,5").problem).toBe("Enter a number, like 2.5.");
    expect(parseSensitivityInput("1e3").problem).toBe("Enter a number, like 2.5.");
    expect(parseSensitivityInput("-1").problem).toBe("Enter a number, like 2.5.");
    expect(parseSensitivityInput("0").problem).toBe("Use a number above 0.");
    expect(parseSensitivityInput(String(SENSITIVITY_MAX + 1)).problem).toBe("Use 1000 or less.");
  });
});

describe("mouse sync after a game session", () => {
  const managed =
    "// execs gameplay — managed, do not edit by hand\r\nfov_desired 90\r\nsensitivity 3\r\nzoom_sensitivity_ratio 1\r\ncl_crosshair_scale 32\r\n";

  it("follows a sensitivity changed in TF2's options and keeps every other byte", () => {
    const next = syncGameOptionsFromConfig(
      managed,
      'sensitivity "2.2"\nzoom_sensitivity_ratio "0.793471"\n',
    );
    expect(next).toBe(
      "// execs gameplay — managed, do not edit by hand\r\nfov_desired 90\r\nsensitivity 2.2\r\nzoom_sensitivity_ratio 0.793471\r\ncl_crosshair_scale 32\r\n",
    );
  });

  it("changes nothing when the values already match or config.cfg has none", () => {
    expect(syncGameOptionsFromConfig(managed, 'sensitivity "3.000000"\n')).toBe(managed);
    expect(syncGameOptionsFromConfig(managed, "bind w +forward\n")).toBe(managed);
    expect(syncGameOptionsFromConfig(managed, 'sensitivity "0"\n')).toBe(managed);
  });

  it("never adds mouse lines the managed file did not already set", () => {
    const without = "fov_desired 90\n";
    expect(syncGameOptionsFromConfig(without, 'sensitivity "2"\n')).toBe(without);
  });
});

describe("comfort options", () => {
  it("uses TF2's defaults only when a value is absent", () => {
    const fresh = seedGameplay("", {});
    expect(fresh.tf_medigun_autoheal).toBe(0);
    expect(fresh.hud_combattext).toBe(1);
    expect(fresh.hud_combattext_batching).toBe(0);
    expect(fresh.hud_combattext_healing).toBe(1);

    const effective = seedGameplay("", {
      tf_medigun_autoheal: "1",
      hud_combattext: "0",
      hud_combattext_batching: "1",
      hud_combattext_healing: "0",
    });
    expect(effective.tf_medigun_autoheal).toBe(1);
    expect(effective.hud_combattext).toBe(0);
    expect(effective.hud_combattext_batching).toBe(1);
    expect(effective.hud_combattext_healing).toBe(0);
    // The managed file wins over config.cfg; an unreadable value keeps what was there.
    expect(seedGameplay("hud_combattext 1\n", { hud_combattext: "0" }).hud_combattext).toBe(1);
    expect(seedGameplay("", { hud_combattext: "maybe" }).hud_combattext).toBe(1);
  });

  it("writes every comfort cvar and keeps it in the Gameplay scope", () => {
    const settings = {
      ...defaultGameplay(),
      tf_medigun_autoheal: 1 as const,
      hud_combattext: 0 as const,
    };
    const text = serializeGameplay(settings);
    expect(text).toContain("\ntf_medigun_autoheal 1\n");
    expect(text).toContain("\nhud_combattext 0\n");
    expect(text).toContain("\nhud_combattext_batching 0\n");
    expect(text).toContain("\nhud_combattext_healing 1\n");
    expect(serializeGameplayScope(settings, "gameplay")).toContain("hud_combattext");
    expect(serializeGameplayScope(settings, "crosshair")).not.toContain("hud_combattext");
    expect(serializeGameplayScope(settings, "sounds")).not.toContain("tf_medigun_autoheal");
  });

  it("follows TF2's options after a game session like the mouse values", () => {
    const managed =
      "cl_autoreload 1\nhud_fastswitch 2\ntf_medigun_autoheal 0\nhud_combattext 1\nhud_combattext_healing 1\n";
    const config =
      'cl_autoreload "0"\nhud_fastswitch "1"\ntf_medigun_autoheal "1"\nhud_combattext "0"\nhud_combattext_healing "1"\n';
    expect(syncGameOptionsFromConfig(managed, config)).toBe(
      "cl_autoreload 0\nhud_fastswitch 1\ntf_medigun_autoheal 1\nhud_combattext 0\nhud_combattext_healing 1\n",
    );
  });

  it("ignores config.cfg values TF2's options would not write", () => {
    const managed = "tf_medigun_autoheal 0\nhud_fastswitch 1\n";
    expect(
      syncGameOptionsFromConfig(managed, 'tf_medigun_autoheal "2"\nhud_fastswitch "1.5"\n'),
    ).toBe(managed);
    // Lines the managed file does not set are never added.
    expect(syncGameOptionsFromConfig(managed, 'hud_combattext "0"\n')).toBe(managed);
  });
});
