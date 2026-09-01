import { describe, expect, it } from "vitest";
import { lint } from "../src/engine.ts";
import type { CfgFile } from "../src/types.ts";

// A realistic mastercomfig-style overrides bundle, assembled from patterns in
// published community configs. Must lint clean (warns allowed, no blocks).
const GOLDEN_BUNDLE: CfgFile[] = [
  {
    path: "autoexec.cfg",
    text: `
// -- launch-time settings ----------------------------------------------
fov_desired 90
viewmodel_fov 60
cl_autoreload 1
cl_autorezoom 0
hud_fastswitch 1
fps_max 240

// net (competitive standard)
cl_interp 0.0152
cl_interp_ratio 1
cl_cmdrate 66
cl_updaterate 66
rate 786432

// audio
snd_musicvolume 0
voice_overdrive 1

// binds
bind mouse3 "voicemenu 0 6"
bind t "+use_action_slot_item"
alias +crouchjump "+jump; +duck"
alias -crouchjump "-jump; -duck"
bind space +crouchjump

exec binds
`,
  },
  {
    path: "binds.cfg",
    text: `
bind f1 "join_class scout"
bind f2 "join_class soldier"
unbind f6
`,
  },
  {
    path: "modules.cfg",
    text: "texture_quality=medium\nshadows=off\ngibs=off\nragdolls=off\n",
  },
  {
    path: "medic.cfg",
    text: `
bind mouse2 "+attack2; say_team activating uber!"
viewmodel_fov 70
`,
  },
];

describe("golden bundle", () => {
  // A flat bundle with no `cfg/` folder, so `exec binds` only resolves with
  // the opt-in bundle-relative match.
  const result = lint(GOLDEN_BUNDLE, { bundleRelativeExec: true });

  it("has no block findings", () => {
    expect(result.findings.filter((f) => f.tier === "block")).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("surfaces the medic say_team bind as a warn, not a block", () => {
    const chat = result.findings.filter((f) => f.ruleId === "chat-bind");
    expect(chat).toHaveLength(1);
    expect(chat[0].tier).toBe("warn");
    expect(chat[0].file).toBe("medic.cfg");
  });

  it("extracts module levels", () => {
    expect(result.moduleLevels).toEqual({
      texture_quality: "medium",
      shadows: "off",
      gibs: "off",
      ragdolls: "off",
    });
  });

  it("detects the medic class", () => {
    expect(result.classesTouched).toEqual(["medic"]);
  });

  it("captures net settings in the effective state", () => {
    expect(result.effective.get("cl_interp")?.value).toBe("0.0152");
    expect(result.effective.get("rate")?.value).toBe("786432");
  });

  it("resolves the in-bundle exec without findings", () => {
    expect(result.findings.filter((f) => f.ruleId === "exec-external")).toEqual([]);
  });

  it("produces a multi-domain summary", () => {
    const domains = result.summary.map((s) => s.domain);
    expect(domains).toEqual(expect.arrayContaining(["network", "audio", "hud"]));
  });
});
