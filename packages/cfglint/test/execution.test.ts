import { describe, expect, it } from "vitest";
import { lint } from "../src/engine.ts";
import { engineManagedLintOptions } from "../src/lint-options.ts";
import { MAX_COMMAND_VISITS } from "../src/rules-data.ts";
import type { CfgFile } from "../src/types.ts";

const autoexec = (text: string): CfgFile => ({ path: "tf/cfg/autoexec.cfg", text });
const profile = (files: CfgFile[]) => lint(files, engineManagedLintOptions(files));

describe("startup execution is separate from safety scanning", () => {
  it("does not guess the effect of uncatalogued cvar-shaped writes", () => {
    const result = profile([
      { path: "tf/cfg/config.cfg", text: "r_lightmap_bicubic_set 1\nviewmodel_fov 70" },
      autoexec("viewwmodel_fov 90\nviewmodel_fov 90"),
    ]);
    expect(result.executionComplete).toBe(false);
    expect(result.effective.size).toBe(0);
    expect(result.findings.filter((finding) => finding.ruleId === "unknown-command")).toHaveLength(
      1,
    );
    expect(
      result.findings.find(
        (finding) =>
          finding.ruleId === "unknown-command" && finding.message.includes("viewwmodel_fov"),
      )?.message,
    ).toContain("did you mean `viewmodel_fov`");
  });

  it("refuses unknown control flow and unknown assignments", () => {
    expect(profile([autoexec("viewmodel_fov 90\nplugin_action")]).executionComplete).toBe(false);
    expect(profile([autoexec("viewmodel_fov 90\nplugin_setting 1")]).executionComplete).toBe(false);
  });

  it("leaves a malformed personal bind unresolved without losing later settings", () => {
    const result = profile([
      autoexec('bind p ""show_quest_log"\nbind w +forward\nviewmodel_fov 90'),
    ]);
    expect(result.executionComplete).toBe(true);
    expect(result.binds.has("p")).toBe(false);
    expect(result.binds.get("w")).toBe("+forward");
    expect(result.effective.get("viewmodel_fov")?.value).toBe("90");
    expect(result.findings.some((finding) => finding.ruleId === "syntax-quote")).toBe(true);
    expect(lint([autoexec('bind p ""show_quest_log"')]).executionComplete).toBe(false);
  });

  it("keeps startup settings when unevenly quoted aliases are only defined", () => {
    const files: CfgFile[] = [
      autoexec("viewmodel_fov 90\nexec overrides/alias.cfg"),
      {
        path: "tf/cfg/overrides/alias.cfg",
        text: [
          'alias "dc" "disconnect"',
          'alias "q" "quit; echo "quitting..."',
          'alias "rt" "retry; echo "retrying..."',
          'alias "ali" "exec overrides/alias.cfg; echo "Alias system loaded!"',
        ].join("\n"),
      },
    ];
    const result = profile(files);
    expect(result.executionComplete).toBe(true);
    expect(result.effective.get("viewmodel_fov")?.value).toBe("90");
    expect(result.findings.some((finding) => finding.ruleId === "syntax-quote")).toBe(true);
    expect(result.findings.some((finding) => finding.ruleId === "exec-cycle")).toBe(false);
    expect(result.findings.some((finding) => finding.ruleId === "disruptive-bind")).toBe(false);
  });

  it("stops startup inference when an unevenly quoted alias is actually invoked", () => {
    const result = profile([autoexec('alias "q" "quit; echo "quitting..."\nq')]);
    expect(result.executionComplete).toBe(false);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        ruleId: "execution-incomplete",
        message: expect.stringContaining("alias `q`"),
      }),
    );
  });

  it("does not treat a one-time alias reload as an exec cycle", () => {
    const result = profile([
      autoexec("exec overrides/alias.cfg\nali\nviewmodel_fov 90"),
      { path: "tf/cfg/overrides/alias.cfg", text: 'alias ali "exec overrides/alias.cfg"' },
    ]);
    expect(result.executionComplete).toBe(true);
    expect(result.effective.get("viewmodel_fov")?.value).toBe("90");
    expect(result.findings.some((finding) => finding.ruleId === "exec-cycle")).toBe(false);
  });

  it("keeps credential values out of derived settings and summaries", () => {
    const result = lint([autoexec("password private\nrcon_password secret")]);
    expect(result.ok).toBe(true);
    expect(result.findings.filter((finding) => finding.ruleId === "rcon-password")).toHaveLength(2);
    expect(result.effective.has("password")).toBe(false);
    expect(result.effective.has("rcon_password")).toBe(false);
    expect(JSON.stringify(result.summary)).not.toContain("private");
    expect(JSON.stringify(result.summary)).not.toContain("secret");
  });
  it.each([
    'bind f "r_drawviewmodel 0; unbind x"',
    'alias hidehands "r_drawviewmodel 0; unbind x"',
    'alias hidehands "r_drawviewmodel 0; unbind x"\nbind f hidehands',
    'bind f "exec hidden"',
  ])("does not execute a deferred payload: %s", (deferred) => {
    const result = profile([
      autoexec(`r_drawviewmodel 1\nbind x +jump\n${deferred}\n`),
      { path: "tf/cfg/hidden.cfg", text: "r_drawviewmodel 0\nunbindall\n" },
    ]);
    expect(result.executionComplete).toBe(true);
    expect(result.effective.get("r_drawviewmodel")?.value).toBe("1");
    expect(result.binds.get("x")).toBe("+jump");
  });

  it("scans unsafe commands in dormant files, overwritten aliases and uninvoked payloads", () => {
    const result = lint([
      autoexec('alias old "rcon_password hidden"\nalias old "echo ok"\nbind f "exec hidden"'),
      { path: "tf/cfg/hidden.cfg", text: "connect 203.0.113.1\n" },
      { path: "tf/cfg/medic.cfg", text: 'bind mouse1 "quit"\n' },
      { path: "tf/cfg/optional.cfg", text: 'alias never "unbindall"\n' },
    ]);
    expect(result.findings.filter((f) => f.tier === "block").map((f) => f.ruleId)).toEqual(
      expect.arrayContaining(["connect-redirect", "disruptive-bind", "unbindall"]),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({ ruleId: "rcon-password", tier: "warn" }),
    );
    expect(result.ok).toBe(false);
  });

  it("executes config before autoexec and leaves optional/class cfgs dormant", () => {
    const result = profile([
      { path: "tf/cfg/z_optional.cfg", text: "r_drawviewmodel 0\nunbindall" },
      autoexec("r_drawviewmodel 1\nbind x +jump"),
      { path: "tf/cfg/medic.cfg", text: "r_drawviewmodel 0\nbind x +attack2" },
      { path: "tf/custom/pack/cfg/optional.cfg", text: "r_drawviewmodel 0" },
      { path: "tf/cfg/config.cfg", text: "r_drawviewmodel 0\nbind x +attack" },
    ]);
    expect(result.effective.get("r_drawviewmodel")?.value).toBe("1");
    expect(result.binds.get("x")).toBe("+jump");
  });

  it("resolves startup autoexec from the first mounted custom root", () => {
    const result = profile([
      { path: "tf/cfg/config.cfg", text: "viewmodel_fov 54\nbind x +jump" },
      autoexec("viewmodel_fov 45\nunbindall"),
      { path: "tf/custom/alpha/cfg/autoexec.cfg", text: "viewmodel_fov 120" },
      { path: "tf/custom/-alpha/cfg/autoexec.cfg", text: "viewmodel_fov 100" },
    ]);
    expect(result.executionComplete).toBe(true);
    expect(result.effective.get("viewmodel_fov")?.value).toBe("100");
    expect(result.binds.get("x")).toBe("+jump");
  });

  it.each([false, true])("uses mounted cfg precedence for nested execs (reverse=%s)", (reverse) => {
    const files = [
      autoexec("exec personal/settings"),
      { path: "tf/cfg/personal/settings.cfg", text: "viewmodel_fov 45" },
      { path: "tf/custom/alpha/cfg/personal/settings.cfg", text: "viewmodel_fov 120" },
      { path: "tf/custom/Zeta/cfg/personal/settings.cfg", text: "viewmodel_fov 150" },
      { path: "tf/custom/-alpha/cfg/personal/settings.cfg", text: "viewmodel_fov 100" },
    ];
    const result = profile(reverse ? files.reverse() : files);
    expect(result.executionComplete).toBe(true);
    expect(result.effective.get("viewmodel_fov")?.value).toBe("100");
  });

  it.each([
    ["alpha", "alpha-beta"],
    ["alpha", "Alpha_2"],
    ["_alpha", "Zeta"],
  ])("orders mount names before appending cfg paths: %s then %s", (first, second) => {
    const result = profile([
      autoexec("exec selected"),
      { path: `tf/custom/${second}/cfg/selected.cfg`, text: "viewmodel_fov 45" },
      { path: `tf/custom/${first}/cfg/selected.cfg`, text: "viewmodel_fov 100" },
    ]);
    expect(result.executionComplete).toBe(true);
    expect(result.effective.get("viewmodel_fov")?.value).toBe("100");
  });

  it.each([
    "tf/custom/pack/inactive/cfg/optional.cfg",
    "tf/custom/execs-hud-backups/token/hud/cfg/optional.cfg",
    "tf/custom/.disabled/cfg/optional.cfg",
  ])("does not resolve an unmounted cfg-looking path: %s", (path) => {
    const result = profile([autoexec("exec optional"), { path, text: "viewmodel_fov 100" }]);
    expect(result.executionComplete).toBe(false);
    expect(result.effective.size).toBe(0);
    expect(result.findings.some((finding) => finding.ruleId === "execution-incomplete")).toBe(true);
  });

  it("refuses ambiguous case-colliding mounted roots instead of choosing manifest order", () => {
    const result = profile([
      autoexec("exec optional"),
      { path: "tf/custom/Alpha/cfg/optional.cfg", text: "viewmodel_fov 100" },
      { path: "tf/custom/alpha/cfg/other.cfg", text: "viewmodel_fov 45" },
    ]);
    expect(result.executionComplete).toBe(false);
    expect(result.effective.size).toBe(0);
    expect(result.findings.some((finding) => finding.ruleId === "execution-search-path")).toBe(
      true,
    );
  });

  it("only makes aliases available when their definitions execute", () => {
    const result = profile([
      autoexec('r_drawviewmodel 1\nfuture\nalias future "r_drawviewmodel 0"\ndormant'),
      { path: "tf/cfg/optional.cfg", text: 'alias dormant "r_drawviewmodel 0"' },
    ]);
    expect(result.executionComplete).toBe(false);
    expect(result.effective.size).toBe(0);
  });

  it("executes invoked aliases, including execs and definitions inside their payloads", () => {
    const result = profile([
      autoexec('alias choose "exec chosen"\nchoose\napply'),
      { path: "tf/cfg/chosen.cfg", text: 'alias apply "r_drawviewmodel 0; bind x +jump"' },
    ]);
    expect(result.executionComplete).toBe(true);
    expect(result.effective.get("r_drawviewmodel")?.value).toBe("0");
    expect(result.binds.get("x")).toBe("+jump");
  });

  it("uses the definition present at each invocation, including repeated execs", () => {
    const result = profile([
      autoexec(
        'alias choose "r_drawviewmodel 0"\nexec apply\nalias choose "r_drawviewmodel 1"\nexec apply',
      ),
      { path: "tf/cfg/apply.cfg", text: "choose" },
    ]);
    expect(result.executionComplete).toBe(true);
    expect(result.effective.get("r_drawviewmodel")?.value).toBe("1");
  });

  it.each(["unbind X", "unbindall", 'bind x ""', 'alias reset "unbind x"\nreset'])(
    "applies a bind removal when executed: %s",
    (removal) => {
      expect(profile([autoexec(`bind x +jump\n${removal}`)]).binds.has("x")).toBe(false);
    },
  );

  it("treats bind with no payload as a query", () => {
    expect(profile([autoexec("bind x +jump\nbind x")]).binds.get("x")).toBe("+jump");
  });

  it("accepts explicit roots without treating their peers as executed", () => {
    const files = [
      { path: "tf/cfg/overrides/autoexec.cfg", text: "exec overrides/custom" },
      { path: "tf/cfg/overrides/custom.cfg", text: "r_drawviewmodel 1" },
      { path: "tf/cfg/overrides/medic.cfg", text: "r_drawviewmodel 0" },
    ];
    expect(lint(files).effective.size).toBe(0);
    expect(
      lint(files, { entryPoints: [files[0].path] }).effective.get("r_drawviewmodel")?.value,
    ).toBe("1");
  });
});

describe("bounded analysis", () => {
  function fanout(count: number, payload = false): CfgFile[] {
    return Array.from({ length: 5 }, (_, level) => ({
      path: `tf/cfg/${level === 0 ? "autoexec" : `level${level}`}.cfg`,
      text:
        level === 4
          ? "r_drawviewmodel 0\n"
          : (payload && level === 0 ? 'bind f "exec level1"\n' : `exec level${level + 1}\n`).repeat(
              count,
            ),
    }));
  }

  it.each([false, true])(
    "bounds fanout through ordinary and payload execs (payload=%s)",
    (payload) => {
      const result = profile(fanout(100, payload));
      expect(result.findings.filter((f) => f.ruleId === "analysis-budget")).toHaveLength(1);
      expect(result.executionComplete).toBe(false);
      expect(result.effective.size).toBe(0);
      expect(result.binds.size).toBe(0);
    },
  );

  it("bounds a wide ordinary command list and refuses incomplete untrusted analysis", () => {
    const result = lint([
      autoexec(`${"echo safe\n".repeat(MAX_COMMAND_VISITS + 1)}rcon_password hidden`),
    ]);
    expect(result.findings.filter((f) => f.ruleId === "analysis-budget")).toHaveLength(1);
    expect(result.ok).toBe(false);
    expect(result.executionComplete).toBe(false);
  });

  it("shares the command budget with startup evaluation after a completed safety scan", () => {
    const result = profile([
      autoexec(`${"echo safe\n".repeat(MAX_COMMAND_VISITS / 2)}r_drawviewmodel 0`),
    ]);
    expect(result.findings.filter((f) => f.ruleId === "analysis-budget")).toHaveLength(1);
    expect(result.executionComplete).toBe(false);
    expect(result.effective.size).toBe(0);
  });

  it.each(["exec missing", "exec autoexec", "toggle r_drawviewmodel", 'alias loop "loop"\nloop'])(
    "does not publish partial maps after an unresolved startup operation: %s",
    (operation) => {
      const result = profile([autoexec(`r_drawviewmodel 1\nbind x +jump\n${operation}`)]);
      expect(result.executionComplete).toBe(false);
      expect(result.effective.size).toBe(0);
      expect(result.binds.size).toBe(0);
    },
  );

  it("keeps ordinary repeated exec semantics within the budget", () => {
    const result = profile([
      autoexec("exec shared\nr_drawviewmodel 0\nexec shared"),
      { path: "tf/cfg/shared.cfg", text: "r_drawviewmodel 1" },
    ]);
    expect(result.executionComplete).toBe(true);
    expect(result.effective.get("r_drawviewmodel")?.value).toBe("1");
    expect(result.findings.some((f) => f.ruleId === "analysis-budget")).toBe(false);
  });
});
