import { describe, expect, it } from "vitest";
import { lint } from "../src/engine.ts";
import {
  cfgPathIsAdvisory,
  cfgPathIsEditable,
  classifyCfgOrigin,
  engineManagedLintOptions,
} from "../src/lint-options.ts";
import type { CfgFile } from "../src/types.ts";

const one = (text: string, path = "tf/cfg/overrides/autoexec.cfg"): CfgFile[] => [{ path, text }];
const self = (text: string, path?: string) =>
  lint(one(text, path), { trust: "self" }).findings.map((f) => `${f.tier}:${f.ruleId}`);
const provided = (text: string, path?: string) =>
  lint(one(text, path)).findings.map((f) => `${f.tier}:${f.ruleId}`);

describe("trust: self", () => {
  it("demotes the quick-connect bind that a personal cfg legitimately wants", () => {
    expect(provided('bind f5 "connect 203.0.113.7:27015"')).toContain("block:connect-redirect");
    expect(self('bind f5 "connect 203.0.113.7:27015"')).toContain("warn:connect-redirect");
    expect(lint(one('bind f5 "connect 203.0.113.7:27015"'), { trust: "self" }).ok).toBe(true);
  });

  it("demotes disconnect on a gameplay key", () => {
    expect(provided('bind f "disconnect"')).toContain("block:disruptive-bind");
    expect(self('bind f "disconnect"')).toContain("warn:disruptive-bind");
    expect(lint(one('bind f "disconnect"'), { trust: "self" }).ok).toBe(true);
  });

  it("demotes an exec the app cannot resolve", () => {
    expect(provided("exec some_personal_cfg")).toContain("block:exec-external");
    expect(self("exec some_personal_cfg")).toContain("warn:exec-external");
    expect(lint(one("exec some_personal_cfg"), { trust: "self" }).ok).toBe(true);
  });

  it("keeps the rules no personal config needs at block tier", () => {
    for (const text of [
      "unbindall",
      "rcon_password hunter2",
      'password "letmein"',
      "unbind escape",
      "con_enable 0",
      "sv_cheats 1",
      'alias exec "echo gotcha"',
    ]) {
      const result = lint(one(text), { trust: "self" });
      expect(result.findings.some((f) => f.tier === "block")).toBe(true);
      expect(result.ok).toBe(false);
    }
  });

  it("leaves host_writeconfig and con_logfile as warns in both trust modes", () => {
    for (const ids of [self("host_writeconfig\ncon_logfile x.txt"), provided("host_writeconfig")]) {
      expect(ids).toContain("warn:host-writeconfig");
    }
  });

  it("defaults to provided", () => {
    expect(lint(one("connect 203.0.113.7")).ok).toBe(false);
  });

  it("no longer treats `restart` as disruptive (server command, no client effect)", () => {
    expect(self('bind f "restart"')).not.toContain("warn:disruptive-bind");
    expect(provided('bind f "restart"')).not.toContain("block:disruptive-bind");
    expect(provided("restart")).not.toContain("warn:disruptive-immediate");
  });

  it("says 'profile', not 'upload', in the exec-external message", () => {
    const messages = lint(one("exec nowhere")).findings.map((f) => f.message);
    expect(messages.join(" ")).not.toMatch(/upload/i);
    expect(messages.join(" ")).toContain("not in this profile");
  });
});

describe("engineManagedLintOptions", () => {
  const files = [
    { path: "tf/cfg/overrides/autoexec.cfg" },
    { path: "tf/cfg/config.cfg" },
    { path: "tf/cfg/execs_binds.cfg" },
    { path: "tf/custom/mahud/cfg/hud_reset.cfg" },
    { path: "tf/custom/somepack/cfg/pack.cfg" },
    { path: "tf/custom/comfig-custom/cfg/imported.cfg" },
  ];

  it("builds the option set the desktop needs from one call", () => {
    const opts = engineManagedLintOptions(files, "mahud");
    expect(opts.trust).toBe("self");
    expect(opts.engineManagedConfigPaths).toEqual(["tf/cfg/config.cfg"]);
    expect(opts.advisoryPaths).toEqual([
      "tf/custom/mahud/cfg/hud_reset.cfg",
      "tf/custom/somepack/cfg/pack.cfg",
      "tf/custom/comfig-custom/cfg/imported.cfg",
    ]);
  });

  it("classifies origins the way the Files pane does", () => {
    expect(classifyCfgOrigin("tf/cfg/overrides/autoexec.cfg")).toBe("user");
    expect(classifyCfgOrigin("tf/cfg/execs_binds.cfg")).toBe("app");
    expect(classifyCfgOrigin("tf/cfg/config.cfg")).toBe("engine");
    expect(classifyCfgOrigin("tf/cfg/undo360controller.cfg")).toBe("engine");
    expect(classifyCfgOrigin("tf/custom/mahud/cfg/x.cfg", "mahud")).toBe("hud");
    expect(classifyCfgOrigin("tf/custom/-mahud/cfg/x.cfg", "mahud")).toBe("hud");
    expect(classifyCfgOrigin("tf/custom/other/cfg/x.cfg", "mahud")).toBe("pack");
    expect(classifyCfgOrigin("tf/custom/comfig-custom/cfg/x.cfg")).toBe("comfigImport");
    expect(classifyCfgOrigin("TF\\CFG\\Overrides\\Autoexec.cfg")).toBe("user");
  });

  it("treats config.cfg as editable but every other provided file as advisory", () => {
    expect(cfgPathIsEditable("tf/cfg/config.cfg")).toBe(true);
    expect(cfgPathIsAdvisory("tf/cfg/config.cfg")).toBe(false);
    expect(cfgPathIsAdvisory("tf/custom/mahud/cfg/x.cfg", "mahud")).toBe(true);
  });

  it("keeps config.cfg strict while letting the engine's own prologue through", () => {
    const bundle: CfgFile[] = [
      {
        path: "tf/cfg/config.cfg",
        text: 'unbindall\nbind "ESCAPE" "cancelselect"\ncon_enable "0"\n',
      },
      { path: "tf/custom/mahud/cfg/hud_reset.cfg", text: "unbindall\n" },
    ];
    const result = lint(bundle, engineManagedLintOptions(bundle, "mahud"));
    expect(result.ok).toBe(true);
    expect(result.binds.get("escape")).toBe("cancelselect");
    expect(result.effective.get("con_enable")?.value).toBe("0");
    expect(result.findings.some((f) => f.advisory && f.ruleId === "unbindall")).toBe(true);
  });
});
