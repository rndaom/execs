import { describe, expect, it } from "vitest";
import { lint } from "../src/engine.ts";
import type { CfgFile } from "../src/types.ts";

const one = (text: string, path = "autoexec.cfg"): CfgFile[] => [{ path, text }];
const rules = (files: CfgFile[]) => {
  const result = lint(files);
  return { result, ids: result.findings.map((f) => `${f.tier}:${f.ruleId}`) };
};

describe("block-tier rules", () => {
  it("blocks unbindall", () => {
    const { result, ids } = rules(one("unbindall"));
    expect(ids).toContain("block:unbindall");
    expect(result.ok).toBe(false);
  });

  it("blocks connect/password server redirects", () => {
    const { ids } = rules(one('connect 203.0.113.7:27015\npassword "letmein"'));
    expect(ids).toContain("block:connect-redirect");
    expect(ids).toContain("block:rcon-password");
  });

  it("blocks rcon configuration", () => {
    const { ids } = rules(one("rcon_address 203.0.113.7\nrcon_password hunter2"));
    expect(ids.filter((i) => i === "block:rcon-password")).toHaveLength(2);
  });

  it("blocks connect hidden inside a quoted, semicolon-packed bind", () => {
    const { ids } = rules(one('bind mouse1 "+attack; connect 203.0.113.7; password x"'));
    expect(ids).toContain("block:connect-redirect");
  });

  it("blocks unbindall obfuscated behind an alias", () => {
    const { ids } = rules(one('alias totally_safe "unbindall"\nbind mouse1 totally_safe'));
    expect(ids).toContain("block:unbindall");
  });

  it("blocks payloads hidden behind chained aliases", () => {
    const cfg = [
      'alias a3 "unbindall"',
      'alias a2 "a3"',
      'alias a1 "a2"',
      "bind mouse1 a1",
    ].join("\n");
    expect(rules(one(cfg)).ids).toContain("block:unbindall");
  });

  it("blocks ESCAPE rebinding and console lockout", () => {
    expect(rules(one("bind escape kill")).ids).toContain("block:console-lockout");
    expect(rules(one("unbind escape")).ids).toContain("block:console-lockout");
    expect(rules(one("con_enable 0")).ids).toContain("block:console-lockout");
  });

  it("blocks quit bound to a gameplay key, warns on other keys", () => {
    expect(rules(one('bind w "quit"')).ids).toContain("block:disruptive-bind");
    expect(rules(one('bind f11 "quit"')).ids).toContain("warn:disruptive-bind");
  });

  it("blocks sv_cheats", () => {
    expect(rules(one("sv_cheats 1")).ids).toContain("block:sv-cheats");
    expect(rules(one("sv_cheats 0")).ids).not.toContain("block:sv-cheats");
  });

  it("blocks aliases that shadow engine commands", () => {
    expect(rules(one('alias exec "echo gotcha"')).ids).toContain("block:alias-shadow");
    expect(rules(one('alias kill "say lol"')).ids).toContain("block:alias-shadow");
  });

  it("blocks exec of a file not in the bundle", () => {
    expect(rules(one("exec sketchy_payload")).ids).toContain("block:exec-external");
  });

  it("allows exec of well-known engine files", () => {
    expect(rules(one("exec config_default")).ids).not.toContain("block:exec-external");
  });

  it("resolves exec within the bundle, including subfolders", () => {
    const files: CfgFile[] = [
      { path: "autoexec.cfg", text: "exec extra/net" },
      { path: "extra/net.cfg", text: "cl_interp 0.033" },
    ];
    const { result, ids } = rules(files);
    expect(ids).not.toContain("block:exec-external");
    expect(result.effective.get("cl_interp")?.value).toBe("0.033");
  });
});

describe("warn-tier rules", () => {
  it("warns on chat binds", () => {
    expect(rules(one('bind mouse1 "say nice shot"')).ids).toContain("warn:chat-bind");
  });

  it("warns on kill binds on gameplay keys only", () => {
    expect(rules(one('bind mouse4 "kill"')).ids).toContain("warn:kill-bind");
    expect(rules(one('bind f9 "kill"')).ids).not.toContain("warn:kill-bind");
  });

  it("warns on mouse tampering", () => {
    const { ids } = rules(one("sensitivity 1.6\nm_yaw 0.011"));
    expect(ids.filter((i) => i === "warn:mouse-tamper")).toHaveLength(2);
  });

  it("warns on net cvars outside sane ranges", () => {
    expect(rules(one("cl_interp 2")).ids).toContain("warn:net-extreme");
    expect(rules(one("cl_interp 0.033")).ids).not.toContain("warn:net-extreme");
    expect(rules(one("cl_cmdrate 1")).ids).toContain("warn:net-extreme");
  });

  it("warns on alias cycles instead of hanging", () => {
    const { ids } = rules(one('alias loop_a "loop_b"\nalias loop_b "loop_a"\nbind mouse1 loop_a'));
    expect(ids).toContain("warn:alias-depth");
  });

  it("warns on exec cycles instead of hanging", () => {
    const files: CfgFile[] = [
      { path: "a.cfg", text: "exec b" },
      { path: "b.cfg", text: "exec a" },
    ];
    expect(rules(files).ids).toContain("warn:exec-cycle");
  });

  it("warns on exec chains deeper than 4", () => {
    const files: CfgFile[] = [
      { path: "autoexec.cfg", text: "exec c1" },
      { path: "c1.cfg", text: "exec c2" },
      { path: "c2.cfg", text: "exec c3" },
      { path: "c3.cfg", text: "exec c4" },
      { path: "c4.cfg", text: "exec c5" },
      { path: "c5.cfg", text: "volume 1" },
    ];
    expect(rules(files).ids).toContain("warn:exec-depth");
  });

  it("warns on con_logfile and host_writeconfig", () => {
    const { ids } = rules(one("con_logfile capture.txt\nhost_writeconfig"));
    expect(ids).toContain("warn:con-logfile");
    expect(ids).toContain("warn:host-writeconfig");
  });
});

describe("clean configs and metadata", () => {
  it("passes a legitimate performance config with ok=true", () => {
    const cfg = [
      "// community fps config",
      "fov_desired 90",
      "viewmodel_fov 60",
      "cl_autoreload 1",
      "fps_max 240",
      "mat_phong 0",
      "r_shadows 0",
      'bind mouse3 "voice_menu_3"',
    ].join("\n");
    const { result } = rules(one(cfg));
    expect(result.findings.filter((f) => f.tier === "block")).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.effective.get("fov_desired")?.value).toBe("90");
  });

  it("evaluates last-write-wins across exec chains", () => {
    const files: CfgFile[] = [
      { path: "autoexec.cfg", text: "fov_desired 75\nexec override" },
      { path: "override.cfg", text: "fov_desired 90" },
    ];
    expect(rules(files).result.effective.get("fov_desired")?.value).toBe("90");
  });

  it("records binds last-write-wins", () => {
    const { result } = rules(one('bind mouse3 "voicemenu 0 6"\nbind mouse3 "+use_action_slot_item"'));
    expect(result.binds.get("mouse3")).toBe("+use_action_slot_item");
  });

  it("parses mastercomfig modules.cfg levels", () => {
    const files: CfgFile[] = [
      { path: "autoexec.cfg", text: "fov_desired 90" },
      { path: "modules.cfg", text: "texture_quality=high\nshadows=off\n// comment\n" },
    ];
    expect(rules(files).result.moduleLevels).toEqual({
      texture_quality: "high",
      shadows: "off",
    });
  });

  it("detects classes from file names", () => {
    const files: CfgFile[] = [
      { path: "scout.cfg", text: "viewmodel_fov 70" },
      { path: "heavyweapons.cfg", text: "viewmodel_fov 54" },
    ];
    expect(rules(files).result.classesTouched.sort()).toEqual(["heavy", "scout"]);
  });

  it("groups the summary by domain and drops default-equal values", () => {
    const { result } = rules(one("r_shadows 0\ncl_interp 0.033\nfov_desired 75"));
    const domains = result.summary.map((s) => s.domain);
    expect(domains).toContain("graphics");
    expect(domains).toContain("network");
    // fov_desired default is 75 — setting it to 75 changes nothing.
    const allCvars = result.summary.flatMap((s) => s.entries.map((e) => e.cvar));
    expect(allCvars).not.toContain("fov_desired");
  });

  it("flags unknown commands as info, never block", () => {
    const { result } = rules(one("totally_made_up_command 1"));
    expect(result.findings[0]).toMatchObject({ tier: "info", ruleId: "unknown-command" });
    expect(result.ok).toBe(true);
  });

  it("handles CRLF files identically to LF", () => {
    const lf = rules(one("sensitivity 2\nbind mouse1 +attack\n"));
    const crlf = rules(one("sensitivity 2\r\nbind mouse1 +attack\r\n"));
    expect(crlf.ids).toEqual(lf.ids);
    expect(crlf.result.binds.get("mouse1")).toBe("+attack");
  });

  it("sorts findings block first", () => {
    const { result } = rules(one("sensitivity 2\nunbindall"));
    expect(result.findings[0].tier).toBe("block");
  });
});
