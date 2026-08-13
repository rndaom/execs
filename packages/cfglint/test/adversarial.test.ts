import { describe, expect, it } from "vitest";
import { isKnownName } from "../src/corpus.ts";
import { lint } from "../src/engine.ts";
import type { CfgFile } from "../src/types.ts";

const one = (text: string, path = "autoexec.cfg"): CfgFile[] => [{ path, text }];
const ids = (files: CfgFile[]) => lint(files).findings.map((f) => `${f.tier}:${f.ruleId}`);

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
    expect(ids(files)).not.toContain("block:exec-external");
  });

  it("resolves exec with backslash paths", () => {
    const files: CfgFile[] = [
      { path: "autoexec.cfg", text: "exec sub\\extra" },
      { path: "sub/extra.cfg", text: "fov_desired 90" },
    ];
    expect(ids(files)).not.toContain("block:exec-external");
  });

  it("treats exec case-insensitively", () => {
    const files: CfgFile[] = [
      { path: "autoexec.cfg", text: "exec MyBinds" },
      { path: "MyBinds.cfg", text: "bind f5 save_replay" },
    ];
    expect(ids(files)).not.toContain("block:exec-external");
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
    expect(isKnownName("cl_interp")).toBe(true);
    expect(isKnownName("CL_INTERP")).toBe(true);
    expect(isKnownName("not_a_real_cvar_xyz")).toBe(false);
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
