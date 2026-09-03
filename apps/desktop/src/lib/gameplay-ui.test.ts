import { describe, expect, it } from "vitest";
import {
  clampGameplay,
  defaultGameplay,
  ensureAutoexecExecLine,
  FOV_MAX,
  FOV_MIN,
  GAMEPLAY_HEADER,
  GAMEPLAY_STEM,
  gameplayPath,
  seedGameplay,
  serializeGameplay,
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
    expect(next.viewmodel_fov).toBe(90);
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
