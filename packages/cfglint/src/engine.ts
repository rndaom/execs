import { isKnownName, lookupCvar } from "./corpus.ts";
import { parseCommands } from "./parser.ts";
import {
  ALIAS_SHADOW_DENYLIST,
  BUILTIN_COMMANDS,
  CHAT_COMMANDS,
  CLASS_CFG_NAMES,
  DEFAULT_EXTERNAL_EXEC_ALLOWLIST,
  DISRUPTIVE_COMMANDS,
  GAMEPLAY_KEYS,
  MAX_ALIAS_DEPTH,
  MAX_EXEC_DEPTH,
  MOUSE_CVARS,
  NET_CVAR_RANGES,
  NETWORK_HIJACK_COMMANDS,
  RCON_NAMES,
  SELF_HARM_COMMANDS,
} from "./rules-data.ts";
import { buildSummary } from "./summary.ts";
import type {
  CfgFile,
  Command,
  CvarValue,
  Finding,
  LintOptions,
  LintResult,
  TfClass,
} from "./types.ts";

interface AliasDef {
  payload: string;
  site: Command;
}

interface ScanContext {
  /** Human-readable origin, e.g. `bind mouse1` or `alias +combo`. */
  via?: string;
  /** Set when scanning the payload of a bind on this key. */
  bindKey?: string;
}

const MODULE_LINE_RE = /^([a-z0-9_]+)=([a-z0-9_.-]+)$/i;

export function lint(files: CfgFile[], opts: LintOptions = {}): LintResult {
  const findings: Finding[] = [];
  const seenFindings = new Set<string>();
  const effective = new Map<string, CvarValue>();
  const binds = new Map<string, string>();
  const moduleLevels: Record<string, string> = {};
  const aliases = new Map<string, AliasDef>();
  const externalAllow = new Set(
    (opts.externalExecAllowlist ?? DEFAULT_EXTERNAL_EXEC_ALLOWLIST).map((s) => s.toLowerCase()),
  );

  const report = (
    tier: Finding["tier"],
    ruleId: string,
    message: string,
    at: Command,
    via?: string,
  ) => {
    const key = `${ruleId}|${at.file}|${at.line}|${at.col}|${via ?? ""}`;
    if (seenFindings.has(key)) return;
    seenFindings.add(key);
    findings.push({ ruleId, tier, message, file: at.file, line: at.line, col: at.col, via });
  };

  // ---- parse all files ------------------------------------------------------
  const parsed = new Map<string, { file: CfgFile; commands: Command[] }>();
  for (const file of files) {
    const norm = file.path.replace(/\\/g, "/").toLowerCase();
    parsed.set(norm, { file, commands: parseCommands(file.text, file.path) });
  }

  // modules.cfg is mastercomfig data (name=level lines), not commands.
  for (const [path, { file }] of parsed) {
    if (basename(path) !== "modules.cfg") continue;
    for (const line of file.text.split("\n")) {
      const m = line.trim().match(MODULE_LINE_RE);
      if (m) moduleLevels[m[1].toLowerCase()] = m[2].toLowerCase();
    }
  }

  // exec target -> bundle path resolution (case-insensitive, suffix match).
  const resolveExec = (target: string): string | null => {
    let t = target.replace(/\\/g, "/").toLowerCase().replace(/^\.\//, "");
    if (!t.endsWith(".cfg")) t += ".cfg";
    if (parsed.has(t)) return t;
    for (const path of parsed.keys()) {
      if (path.endsWith(`/${t}`)) return path;
    }
    return null;
  };

  // ---- alias table (pre-pass, last definition wins) -------------------------
  for (const { commands } of parsed.values()) {
    for (const cmd of commands) {
      if (cmd.name === "alias" && cmd.args.length >= 1) {
        aliases.set(cmd.args[0].toLowerCase(), {
          payload: cmd.args.slice(1).join(" "),
          site: cmd,
        });
      }
    }
  }

  // ---- command scanning -----------------------------------------------------
  const checkCommand = (cmd: Command, ctx: ScanContext, aliasStack: string[]): void => {
    const { name } = cmd;
    const value = cmd.args[0]?.toLowerCase();

    if (NETWORK_HIJACK_COMMANDS.has(name)) {
      report(
        "block",
        "connect-redirect",
        `\`${name}\` routes the player to a server chosen by the config author`,
        cmd,
        ctx.via,
      );
      return;
    }
    if (name === "password" || RCON_NAMES.has(name)) {
      report("block", "rcon-password", `\`${name}\` is never legitimate in a shared config`, cmd, ctx.via);
      return;
    }
    if (name === "unbindall") {
      report("block", "unbindall", "`unbindall` wipes every key bind (classic griefing payload)", cmd, ctx.via);
      return;
    }
    if (name === "unbind" && value === "escape") {
      report("block", "console-lockout", "unbinding ESCAPE locks the player out of the menu", cmd, ctx.via);
      return;
    }
    if (name === "con_enable" && value === "0") {
      report("block", "console-lockout", "`con_enable 0` disables the console, blocking recovery", cmd, ctx.via);
      return;
    }
    if (name === "sv_cheats" && value !== undefined && value !== "0") {
      report("block", "sv-cheats", "`sv_cheats` has no place in a shared client config", cmd, ctx.via);
      return;
    }
    if (name === "con_logfile") {
      report("warn", "con-logfile", "`con_logfile` redirects console output to a file", cmd, ctx.via);
      return;
    }
    if (name === "host_writeconfig") {
      report(
        "warn",
        "host-writeconfig",
        "`host_writeconfig` overwrites the player's saved settings",
        cmd,
        ctx.via,
      );
      return;
    }

    if (name === "alias" && cmd.args.length >= 1) {
      const aliasName = cmd.args[0].toLowerCase();
      const bare = aliasName.replace(/^[+-]/, "");
      const entry = lookupCvar(bare);
      if (ALIAS_SHADOW_DENYLIST.has(bare) || (entry && entry.c === 1)) {
        report(
          "block",
          "alias-shadow",
          `alias \`${cmd.args[0]}\` shadows the engine command \`${bare}\``,
          cmd,
          ctx.via,
        );
        return;
      }
      const payload = cmd.args.slice(1).join(" ");
      if (payload) scanPayload(payload, cmd, { via: `alias ${cmd.args[0]}` }, aliasStack);
      return;
    }

    if (name === "bind" && cmd.args.length >= 1) {
      const key = cmd.args[0].toLowerCase();
      if (key === "escape") {
        report("block", "console-lockout", "rebinding ESCAPE locks the player out of the menu", cmd, ctx.via);
        return;
      }
      const payload = cmd.args.slice(1).join(" ");
      if (payload) {
        binds.set(key, payload);
        scanPayload(payload, cmd, { via: `bind ${key}`, bindKey: key }, aliasStack);
      }
      return;
    }

    if (name === "exec") {
      return; // handled by the evaluator (needs depth/cycle context)
    }

    // Disruptive / chat / self-harm commands matter inside key payloads.
    if (DISRUPTIVE_COMMANDS.has(name)) {
      if (ctx.bindKey && GAMEPLAY_KEYS.has(ctx.bindKey)) {
        report(
          "block",
          "disruptive-bind",
          `\`${name}\` bound to gameplay key "${ctx.bindKey}" ends the session mid-game`,
          cmd,
          ctx.via,
        );
      } else if (ctx.via) {
        report("warn", "disruptive-bind", `\`${name}\` inside ${ctx.via}`, cmd, ctx.via);
      } else {
        // Top level of an exec'd file: runs the moment the config loads.
        report("warn", "disruptive-immediate", `\`${name}\` runs immediately when this config loads`, cmd);
      }
      return;
    }
    if (CHAT_COMMANDS.has(name) && ctx.via) {
      report("warn", "chat-bind", `chat command \`${name}\` inside ${ctx.via}`, cmd, ctx.via);
      return;
    }
    if (SELF_HARM_COMMANDS.has(name) && ctx.bindKey && GAMEPLAY_KEYS.has(ctx.bindKey)) {
      report(
        "warn",
        "kill-bind",
        `\`${name}\` bound to gameplay key "${ctx.bindKey}" (common for jump practice — verify it's wanted)`,
        cmd,
        ctx.via,
      );
      return;
    }

    if (MOUSE_CVARS.has(name)) {
      report(
        "warn",
        "mouse-tamper",
        `\`${name}\` changes mouse feel — make sure players expect this`,
        cmd,
        ctx.via,
      );
    }
    const range = NET_CVAR_RANGES[name];
    if (range && value !== undefined) {
      const num = Number.parseFloat(value);
      if (Number.isFinite(num) && (num < range.min || num > range.max)) {
        report(
          "warn",
          "net-extreme",
          `\`${name} ${value}\` is outside the sane range ${range.min}–${range.max}`,
          cmd,
          ctx.via,
        );
      }
    }

    const entry = lookupCvar(name);
    if (entry) {
      if (entry.c === 0 && cmd.args.length >= 1) {
        effective.set(name, { value: cmd.args.join(" "), file: cmd.file, line: cmd.line });
      }
      return;
    }

    if (BUILTIN_COMMANDS.has(name)) return;

    // Alias invocation — expand and rescan.
    const aliasDef = aliases.get(name);
    if (aliasDef) {
      if (aliasStack.includes(name) || aliasStack.length >= MAX_ALIAS_DEPTH) {
        report(
          "warn",
          "alias-depth",
          `alias expansion for \`${name}\` ${aliasStack.includes(name) ? "cycles" : "exceeds depth " + MAX_ALIAS_DEPTH}`,
          cmd,
          ctx.via,
        );
        return;
      }
      scanPayload(aliasDef.payload, cmd, ctx, [...aliasStack, name]);
      return;
    }

    // Unknown token: +forward style actions and one-off community commands land here.
    if (!name.startsWith("+") && !name.startsWith("-")) {
      report("info", "unknown-command", `unrecognized command \`${name}\``, cmd, ctx.via);
    }
  };

  function scanPayload(payload: string, site: Command, ctx: ScanContext, aliasStack: string[]) {
    for (const inner of parseCommands(payload, site.file)) {
      // Payload positions are relative to the payload string; anchor to the site.
      const anchored = { ...inner, line: site.line, col: site.col };
      checkCommand(anchored, ctx, aliasStack);
    }
  }

  // ---- evaluation walk (effective state + exec graph) -----------------------
  const execdFrom = new Set<string>();
  for (const { commands } of parsed.values()) {
    for (const cmd of commands) {
      if (cmd.name === "exec" && cmd.args[0]) {
        const resolved = resolveExec(cmd.args[0]);
        if (resolved) execdFrom.add(resolved);
      }
    }
  }

  const visited = new Set<string>();
  const walkFile = (path: string, execDepth: number, chain: string[]): void => {
    const entry = parsed.get(path);
    if (!entry) return;
    visited.add(path);
    for (const cmd of entry.commands) {
      if (cmd.name === "exec" && cmd.args[0]) {
        const target = cmd.args[0];
        const resolved = resolveExec(target);
        if (!resolved) {
          const bare = target.toLowerCase().replace(/\.cfg$/, "");
          if (externalAllow.has(bare)) {
            // fine — well-known engine/user file
          } else {
            report(
              "block",
              "exec-external",
              `\`exec ${target}\` targets a file outside this upload`,
              cmd,
            );
          }
          continue;
        }
        if (chain.includes(resolved)) {
          report("warn", "exec-cycle", `\`exec ${target}\` creates a cycle`, cmd);
          continue;
        }
        if (execDepth + 1 > MAX_EXEC_DEPTH) {
          report("warn", "exec-depth", `exec chain deeper than ${MAX_EXEC_DEPTH}`, cmd);
          continue;
        }
        walkFile(resolved, execDepth + 1, [...chain, resolved]);
        continue;
      }
      checkCommand(cmd, {}, []);
    }
  };

  // Roots: files nothing else execs. Deterministic order: autoexec first,
  // then class configs, then the rest alphabetically.
  const roots = [...parsed.keys()].filter((p) => !execdFrom.has(p) && basename(p) !== "modules.cfg");
  roots.sort((a, b) => rootRank(a) - rootRank(b) || a.localeCompare(b));
  for (const root of roots) {
    walkFile(root, 0, [root]);
  }
  // Files only reachable through exec cycles have no root — sweep them too.
  for (const path of parsed.keys()) {
    if (!visited.has(path) && basename(path) !== "modules.cfg") {
      walkFile(path, 0, [path]);
    }
  }

  // ---- metadata -------------------------------------------------------------
  const classesTouched = [
    ...new Set(
      [...parsed.keys()]
        .map((p) => CLASS_CFG_NAMES[basename(p)])
        .filter((c): c is TfClass => Boolean(c)),
    ),
  ];

  const tierOrder = { block: 0, warn: 1, info: 2 };
  findings.sort(
    (a, b) =>
      tierOrder[a.tier] - tierOrder[b.tier] ||
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.col - b.col,
  );

  return {
    findings,
    effective,
    binds,
    moduleLevels,
    classesTouched,
    summary: buildSummary(effective),
    ok: !findings.some((f) => f.tier === "block"),
  };
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

function rootRank(path: string): number {
  const base = basename(path);
  if (base === "autoexec.cfg") return 0;
  if (base in CLASS_CFG_NAMES) return 1;
  return 2;
}
