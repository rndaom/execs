import { describe, expect, it } from "vitest";
import { lookupCvar } from "../src/corpus.ts";
import { lint } from "../src/engine.ts";
import type { CfgFile, LintOptions } from "../src/types.ts";

const one = (text: string, path = "autoexec.cfg"): CfgFile[] => [{ path, text }];
const ids = (files: CfgFile[], opts: LintOptions = {}) =>
  lint(files, opts).findings.map((f) => `${f.tier}:${f.ruleId}`);
/** Flat fixtures with no `cfg/` folder need the opt-in bundle-relative match. */
const FLAT: LintOptions = { bundleRelativeExec: true };

describe("case and quoting evasion", () => {
  it("catches UNBINDALL regardless of case", () => {
    expect(ids(one("UNBINDALL"))).toContain("block:unbindall");
    expect(ids(one("UnBindAll"))).toContain("block:unbindall");
  });

  it("catches quit bound with mixed case and quoted key", () => {
    expect(ids(one('BIND W "quit"'))).toContain("block:disruptive-bind");
    expect(ids(one('bind "w" "QUIT"'))).toContain("block:disruptive-bind");
  });

  it("catches a fully quoted command name", () => {
    expect(ids(one('"unbindall"'))).toContain("block:unbindall");
  });

  it("catches connect inside an alias defined but never bound", () => {
    // The payload is dormant until some later config invokes it — still block.
    expect(ids(one('alias innocent_looking "connect 203.0.113.9"'))).toContain(
      "block:connect-redirect",
    );
  });

  it("handles a self-referential alias without hanging", () => {
    expect(ids(one('alias recurse "recurse"\nbind mouse1 recurse'))).toContain("warn:alias-depth");
  });

  it("scans nested alias-in-bind-in-alias payloads", () => {
    const cfg = [
      'alias stage2 "rcon_password pwned"',
      'alias stage1 "bind mouse5 stage2"',
      "bind mouse4 stage1",
    ].join("\n");
    expect(ids(one(cfg))).toContain("block:rcon-password");
  });
});

describe("exec resolution edge cases", () => {
  it("resolves exec with explicit .cfg extension", () => {
    const files: CfgFile[] = [
      { path: "autoexec.cfg", text: "exec binds.cfg" },
      { path: "binds.cfg", text: "bind f5 save_replay" },
    ];
    expect(ids(files, FLAT)).not.toContain("block:exec-external");
  });

  it("resolves exec with backslash paths", () => {
    const files: CfgFile[] = [
      { path: "autoexec.cfg", text: "exec sub\\extra" },
      { path: "sub/extra.cfg", text: "fov_desired 90" },
    ];
    expect(ids(files, FLAT)).not.toContain("block:exec-external");
  });

  it("treats exec case-insensitively", () => {
    const files: CfgFile[] = [
      { path: "autoexec.cfg", text: "exec MyBinds" },
      { path: "MyBinds.cfg", text: "bind f5 save_replay" },
    ];
    expect(ids(files, FLAT)).not.toContain("block:exec-external");
  });
});

describe("exec hidden inside a payload", () => {
  it("blocks an unresolvable exec inside a bind payload", () => {
    const found = lint(one('bind f "exec sketchy_payload"')).findings.find(
      (f) => f.ruleId === "exec-external",
    );
    expect(found?.tier).toBe("block");
    expect(found?.via).toBe("bind f");
  });

  it("blocks an unresolvable exec inside an alias payload", () => {
    const found = lint(one('alias innocent "exec sketchy_payload"')).findings.find(
      (f) => f.ruleId === "exec-external",
    );
    expect(found?.tier).toBe("block");
    expect(found?.via).toBe("alias innocent");
  });

  it("catches an exec smuggled through a chain of aliases", () => {
    const cfg = [
      'alias stage2 "exec sketchy_payload"',
      'alias stage1 "bind mouse5 stage2"',
      "bind mouse4 stage1",
    ].join("\n");
    expect(ids(one(cfg))).toContain("block:exec-external");
  });

  it("scans the contents of a cfg exec'd from a bind payload", () => {
    const files: CfgFile[] = [
      { path: "tf/cfg/overrides/autoexec.cfg", text: 'bind f "exec payload"' },
      { path: "tf/cfg/payload.cfg", text: "unbindall\nrcon_password pwned\n" },
    ];
    const found = ids(files);
    expect(found).toContain("block:unbindall");
    expect(found).toContain("block:rcon-password");
    expect(found).not.toContain("block:exec-external");
  });

  it("does not let a payload exec escape the exec depth budget", () => {
    const files: CfgFile[] = [
      { path: "tf/cfg/autoexec.cfg", text: "exec c1" },
      { path: "tf/cfg/c1.cfg", text: "exec c2" },
      { path: "tf/cfg/c2.cfg", text: "exec c3" },
      { path: "tf/cfg/c3.cfg", text: "exec c4" },
      { path: "tf/cfg/c4.cfg", text: 'bind f "exec c5"' },
      { path: "tf/cfg/c5.cfg", text: "volume 1" },
    ];
    expect(ids(files)).toContain("warn:exec-depth");
  });

  it("reports a cycle rather than recursing when a payload execs its own file", () => {
    const files: CfgFile[] = [
      { path: "tf/cfg/autoexec.cfg", text: 'bind f "exec autoexec"' },
      { path: "tf/cfg/other.cfg", text: "volume 1" },
    ];
    expect(ids(files)).toContain("warn:exec-cycle");
  });
});

describe("alias expansion budget", () => {
  // The audit's fan-out fixture: 6^7 expansions if nothing bounds breadth.
  const FANOUT = [
    ...Array.from({ length: 6 }, (_, i) => `alias a${i + 1} "${`a${i + 2}; `.repeat(6).trim()}"`),
    'alias a7 "unbindall"',
    "bind mouse1 a1",
  ].join("\n");

  it("stops expanding and reports once", () => {
    const result = lint(one(FANOUT));
    const budget = result.findings.filter((f) => f.ruleId === "alias-budget");
    expect(budget).toHaveLength(1);
    expect(budget[0].tier).toBe("warn");
  });

  it("lints the fan-out in well under 50 ms", () => {
    const started = performance.now();
    lint(one(FANOUT));
    expect(performance.now() - started).toBeLessThan(50);
  });

  it("never reports the budget for an ordinary config", () => {
    const cfg = [
      'alias +crouchjump "+jump; +duck"',
      'alias -crouchjump "-jump; -duck"',
      "bind space +crouchjump",
    ].join("\n");
    expect(ids(one(cfg))).not.toContain("warn:alias-budget");
  });
});

describe("engine-faithful exec resolution", () => {
  const bundle: CfgFile[] = [
    { path: "tf/cfg/overrides/autoexec.cfg", text: "exec execs_binds" },
    { path: "tf/cfg/overrides/execs_binds.cfg", text: "bind f5 save_replay" },
  ];

  it("does not resolve a bare stem against the exec'ing file's own folder", () => {
    // The 2026-08-31 field bug: in game this exec finds nothing.
    expect(ids(bundle)).toContain("block:exec-external");
  });

  it("resolves the same file when addressed from tf/cfg", () => {
    const addressed: CfgFile[] = [
      { path: "tf/cfg/overrides/autoexec.cfg", text: "exec overrides/execs_binds" },
      { path: "tf/cfg/overrides/execs_binds.cfg", text: "bind f5 save_replay" },
    ];
    expect(ids(addressed)).not.toContain("block:exec-external");
  });

  it("resolves a bare stem that really does sit in tf/cfg", () => {
    const vanilla: CfgFile[] = [
      { path: "tf/cfg/autoexec.cfg", text: "exec execs_binds" },
      { path: "tf/cfg/execs_binds.cfg", text: "bind f5 save_replay" },
    ];
    expect(ids(vanilla)).not.toContain("block:exec-external");
  });

  it("only takes the bundle-exact shortcut when asked", () => {
    // A flat upload has no cfg/ folder for the engine rule to match against.
    const flat: CfgFile[] = [
      { path: "autoexec.cfg", text: "exec execs_binds" },
      { path: "execs_binds.cfg", text: "bind f5 save_replay" },
    ];
    expect(ids(flat)).toContain("block:exec-external");
    expect(ids(flat, FLAT)).not.toContain("block:exec-external");
  });
});

describe("immediate execution and misc", () => {
  it("warns on top-level quit (runs at load time)", () => {
    expect(ids(one("fov_desired 90\nquit"))).toContain("warn:disruptive-immediate");
  });

  it("does not flag +commands as unknown", () => {
    const result = lint(one("+forward"));
    expect(result.findings).toEqual([]);
  });

  it("accepts an empty file", () => {
    const result = lint(one(""));
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("does not scan modules.cfg lines as commands", () => {
    const files: CfgFile[] = [{ path: "modules.cfg", text: "texture_quality=high\n" }];
    const result = lint(files);
    expect(result.findings.filter((f) => f.ruleId === "unknown-command")).toEqual([]);
  });

  it("skips modules.cfg only where mastercomfig reads it", () => {
    for (const path of ["modules.cfg", "overrides/modules.cfg", "tf/cfg/overrides/modules.cfg"]) {
      expect(lint([{ path, text: "unbindall\n" }]).findings).toEqual([]);
    }
    // A pack shipping this name anywhere else does not get a free pass.
    for (const path of ["tf/custom/x/cfg/modules.cfg", "tf/cfg/modules.cfg"]) {
      const result = lint([{ path, text: "unbindall\n" }]);
      expect(result.findings.map((f) => `${f.tier}:${f.ruleId}`)).toContain("block:unbindall");
      expect(result.ok).toBe(false);
    }
  });

  it("reports every offender in one payload, not just the first", () => {
    const kills = lint(one('bind mouse1 "kill; explode"')).findings.filter(
      (f) => f.ruleId === "kill-bind",
    );
    expect(kills.map((f) => f.message.match(/`(\w+)`/)?.[1]).sort()).toEqual(["explode", "kill"]);

    const disruptive = lint(one('bind w "quit; disconnect"')).findings.filter(
      (f) => f.ruleId === "disruptive-bind",
    );
    expect(disruptive).toHaveLength(2);
  });

  it("still collapses the identical command repeated in one payload", () => {
    expect(
      lint(one('bind mouse1 "kill; kill"')).findings.filter((f) => f.ruleId === "kill-bind"),
    ).toHaveLength(1);
  });

  it("warns on kill bound to mwheeldown (a gameplay key)", () => {
    expect(ids(one('bind mwheeldown "kill"'))).toContain("warn:kill-bind");
  });

  it("keeps echo and known commands silent", () => {
    expect(lint(one('echo "hello"\nwait 10')).findings).toEqual([]);
  });

  it("joins multi-arg cvar values in effective state", () => {
    const result = lint(one("con_filter_text some filter text"));
    expect(result.effective.get("con_filter_text")?.value).toBe("some filter text");
  });

  it("knows real cvars and rejects fakes", () => {
    expect(lookupCvar("cl_interp")).toBeDefined();
    expect(lookupCvar("CL_INTERP")).toBeDefined();
    expect(lookupCvar("not_a_real_cvar_xyz")).toBeUndefined();
  });

  it("includes corpus help text in summary entries when available", () => {
    const result = lint(one("viewmodel_fov 60"));
    const entry = result.summary.flatMap((s) => s.entries).find((e) => e.cvar === "viewmodel_fov");
    expect(entry).toBeDefined();
    expect(typeof entry?.help).toBe("string");
  });

  it("reports via context on findings from bind payloads", () => {
    const result = lint(one('bind mouse1 "say gg"'));
    const finding = result.findings.find((f) => f.ruleId === "chat-bind");
    expect(finding?.via).toBe("bind mouse1");
  });
});
