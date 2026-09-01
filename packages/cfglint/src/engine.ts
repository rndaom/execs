import { lookupCvar } from "./corpus.ts";
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
  MAX_ALIAS_EXPANSIONS,
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
  FindingTier,
  LintOptions,
  LintResult,
  SummarySection,
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
const ENGINE_MENU_COMMANDS = new Set(["cancelselect", "escape"]);

/**
 * mastercomfig's `modules.cfg` is `name=level` data, not commands — but only
 * at the two locations mastercomfig actually reads. A `modules.cfg` shipped
 * anywhere else in a pack is a normal cfg and gets linted like one.
 */
function isModulesData(path: string): boolean {
  return (
    path === "modules.cfg" ||
    path === "overrides/modules.cfg" ||
    path.endsWith("/overrides/modules.cfg")
  );
}

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
  const engineManagedConfigPaths = new Set(
    (opts.engineManagedConfigPaths ?? []).map(normalizePath),
  );
  const advisoryPaths = new Set((opts.advisoryPaths ?? []).map(normalizePath));
  const trust = opts.trust ?? "provided";
  // Rules that exist to catch a hostile config, not a bad one. In the player's
  // own cfg these are legitimate things to bind, so they advise instead of
  // refusing the save.
  const selfTrusted: FindingTier = trust === "self" ? "warn" : "block";
  // Files whose text authored the payload currently being scanned. An alias
  // defined in an advisory (provided) file keeps its advisory status even when
  // a user file invokes it — the finding anchors at the invocation site, but
  // the dangerous text belongs to the provider.
  const payloadOriginStack: string[] = [];

  const report = (
    tier: Finding["tier"],
    ruleId: string,
    message: string,
    at: Command,
    via?: string,
  ) => {
    // Every command inside one payload anchors at the payload's own line/col,
    // so the command name has to be part of the key — otherwise
    // `bind mouse1 "kill; explode"` collapses into a single finding.
    const key = `${ruleId}|${at.file}|${at.line}|${at.col}|${via ?? ""}|${at.name}`;
    if (seenFindings.has(key)) return;
    seenFindings.add(key);
    const origin = payloadOriginStack[payloadOriginStack.length - 1];
    // Provided (non-user) content never blocks: demote to an advisory warn.
    if (
      tier === "block" &&
      (advisoryPaths.has(normalizePath(at.file)) ||
        (origin !== undefined && advisoryPaths.has(normalizePath(origin))))
    ) {
      findings.push({
        ruleId,
        tier: "warn",
        message,
        file: at.file,
        line: at.line,
        col: at.col,
        via,
        advisory: true,
      });
      return;
    }
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
    if (!isModulesData(path)) continue;
    for (const line of file.text.split("\n")) {
      const m = line.trim().match(MODULE_LINE_RE);
      if (m) moduleLevels[m[1].toLowerCase()] = m[2].toLowerCase();
    }
  }

  // exec target -> bundle path resolution (case-insensitive). The engine
  // resolves exec targets relative to each search path's cfg folder, never
  // relative to the exec'ing file — `exec execs_binds` issued from
  // overrides/autoexec.cfg does NOT find overrides/execs_binds.cfg in game,
  // so it must not resolve here either. `bundleRelativeExec` re-enables the
  // exact-path match for flat bundles with no cfg/ folder at all.
  const resolveExec = (target: string): string | null => {
    let t = target.replace(/\\/g, "/").toLowerCase().replace(/^\.\//, "");
    if (!t.endsWith(".cfg")) t += ".cfg";
    if (opts.bundleRelativeExec && parsed.has(t)) return t;
    for (const path of parsed.keys()) {
      if (path.endsWith(`/cfg/${t}`)) return path;
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
  // Exec position of the file currently being walked. Payload `exec`s continue
  // the same chain so a bind cannot be used to escape the depth/cycle budget.
  let execDepth = 0;
  let execChain: string[] = [];
  let aliasExpansions = 0;
  let aliasBudgetSpent = false;

  /** Reports an `exec` whose target is not part of the linted set. */
  const reportUnresolvedExec = (target: string, cmd: Command, via?: string): void => {
    const bare = target.toLowerCase().replace(/\.cfg$/, "");
    if (externalAllow.has(bare)) return; // well-known engine/user file
    report(
      selfTrusted,
      "exec-external",
      `\`exec ${target}\` targets a cfg that is not in this profile`,
      cmd,
      via,
    );
  };

  const checkCommand = (cmd: Command, ctx: ScanContext, aliasStack: string[]): void => {
    const { name } = cmd;
    const value = cmd.args[0]?.toLowerCase();
    const isEngineManagedTopLevel =
      ctx.via === undefined && engineManagedConfigPaths.has(normalizePath(cmd.file));

    if (NETWORK_HIJACK_COMMANDS.has(name)) {
      report(
        selfTrusted,
        "connect-redirect",
        `\`${name}\` routes the player to a server chosen by the config author`,
        cmd,
        ctx.via,
      );
      return;
    }
    if (name === "password" || RCON_NAMES.has(name)) {
      report(
        "block",
        "rcon-password",
        `\`${name}\` is never legitimate in a shared config`,
        cmd,
        ctx.via,
      );
      return;
    }
    if (name === "unbindall") {
      if (isEngineManagedTopLevel) return;
      report(
        "block",
        "unbindall",
        "`unbindall` wipes every key bind (classic griefing payload)",
        cmd,
        ctx.via,
      );
      return;
    }
    if (name === "unbind" && value === "escape") {
      report(
        "block",
        "console-lockout",
        "unbinding ESCAPE locks the player out of the menu",
        cmd,
        ctx.via,
      );
      return;
    }
    if (name === "con_enable" && value === "0") {
      // `con_enable` is archived by Source into config.cfg. A zero there is a
      // saved user preference, not a command smuggled into an executed script.
      if (isEngineManagedTopLevel) {
        effective.set(name, { value: cmd.args.join(" "), file: cmd.file, line: cmd.line });
        return;
      }
      report(
        "block",
        "console-lockout",
        "`con_enable 0` disables the console, blocking recovery",
        cmd,
        ctx.via,
      );
      return;
    }
    if (name === "sv_cheats" && value !== undefined && value !== "0") {
      report(
        "block",
        "sv-cheats",
        "`sv_cheats` has no place in a shared client config",
        cmd,
        ctx.via,
      );
      return;
    }
    if (name === "con_logfile") {
      report(
        "warn",
        "con-logfile",
        "`con_logfile` redirects console output to a file",
        cmd,
        ctx.via,
      );
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
        const payload = cmd.args.slice(1).join(" ").trim().toLowerCase();
        const preservesMenu = isEngineManagedTopLevel && ENGINE_MENU_COMMANDS.has(payload);
        if (!preservesMenu) {
          report(
            "block",
            "console-lockout",
            "rebinding ESCAPE locks the player out of the menu",
            cmd,
            ctx.via,
          );
          return;
        }
      }
      const payload = cmd.args.slice(1).join(" ");
      if (payload) {
        binds.set(key, payload);
        scanPayload(payload, cmd, { via: `bind ${key}`, bindKey: key }, aliasStack);
      }
      return;
    }

    if (name === "exec") {
      // Top-level execs belong to the evaluation walk below, which owns the
      // exec graph. An exec *inside a bind or alias payload* never reaches
      // that walk, so it is resolved and followed here — hiding a payload
      // behind `bind f "exec sketchy"` must not launder it.
      if (ctx.via === undefined) return;
      const target = cmd.args[0];
      if (!target) return;
      const resolved = resolveExec(target);
      if (!resolved) {
        reportUnresolvedExec(target, cmd, ctx.via);
        return;
      }
      if (execChain.includes(resolved)) {
        report("warn", "exec-cycle", `\`exec ${target}\` creates a cycle`, cmd, ctx.via);
        return;
      }
      if (execDepth + 1 > MAX_EXEC_DEPTH) {
        report("warn", "exec-depth", `exec chain deeper than ${MAX_EXEC_DEPTH}`, cmd, ctx.via);
        return;
      }
      walkFile(resolved, execDepth + 1, [...execChain, resolved]);
      return;
    }

    // Disruptive / chat / self-harm commands matter inside key payloads.
    if (DISRUPTIVE_COMMANDS.has(name)) {
      if (ctx.bindKey && GAMEPLAY_KEYS.has(ctx.bindKey)) {
        report(
          selfTrusted,
          "disruptive-bind",
          `\`${name}\` bound to gameplay key "${ctx.bindKey}" ends the session mid-game`,
          cmd,
          ctx.via,
        );
      } else if (ctx.via) {
        report("warn", "disruptive-bind", `\`${name}\` inside ${ctx.via}`, cmd, ctx.via);
      } else {
        // Top level of an exec'd file: runs the moment the config loads.
        report(
          "warn",
          "disruptive-immediate",
          `\`${name}\` runs immediately when this config loads`,
          cmd,
        );
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
          `alias expansion for \`${name}\` ${aliasStack.includes(name) ? "cycles" : `exceeds depth ${MAX_ALIAS_DEPTH}`}`,
          cmd,
          ctx.via,
        );
        return;
      }
      if (aliasExpansions >= MAX_ALIAS_EXPANSIONS) {
        // Depth is bounded but breadth is not: a fan-out of aliases is
        // exponential and this runs synchronously while the user types.
        if (!aliasBudgetSpent) {
          aliasBudgetSpent = true;
          report(
            "warn",
            "alias-budget",
            `alias expansion stopped after ${MAX_ALIAS_EXPANSIONS} steps — some payloads were not scanned`,
            cmd,
            ctx.via,
          );
        }
        return;
      }
      aliasExpansions++;
      payloadOriginStack.push(aliasDef.site.file);
      try {
        scanPayload(aliasDef.payload, cmd, ctx, [...aliasStack, name]);
      } finally {
        payloadOriginStack.pop();
      }
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
  function walkFile(path: string, depth: number, chain: string[]): void {
    const entry = parsed.get(path);
    if (!entry) return;
    visited.add(path);
    const prevDepth = execDepth;
    const prevChain = execChain;
    execDepth = depth;
    execChain = chain;
    try {
      for (const cmd of entry.commands) {
        if (cmd.name === "exec" && cmd.args[0]) {
          const target = cmd.args[0];
          const resolved = resolveExec(target);
          if (!resolved) {
            reportUnresolvedExec(target, cmd);
            continue;
          }
          if (chain.includes(resolved)) {
            report("warn", "exec-cycle", `\`exec ${target}\` creates a cycle`, cmd);
            continue;
          }
          if (depth + 1 > MAX_EXEC_DEPTH) {
            report("warn", "exec-depth", `exec chain deeper than ${MAX_EXEC_DEPTH}`, cmd);
            continue;
          }
          walkFile(resolved, depth + 1, [...chain, resolved]);
          continue;
        }
        checkCommand(cmd, {}, []);
      }
    } finally {
      execDepth = prevDepth;
      execChain = prevChain;
    }
  }

  // Roots: files nothing else execs. Deterministic order: autoexec first,
  // then class configs, then the rest alphabetically.
  const roots = [...parsed.keys()].filter((p) => !execdFrom.has(p) && !isModulesData(p));
  roots.sort((a, b) => rootRank(a) - rootRank(b) || a.localeCompare(b));
  for (const root of roots) {
    walkFile(root, 0, [root]);
  }
  // Files only reachable through exec cycles have no root — sweep them too.
  for (const path of parsed.keys()) {
    if (!visited.has(path) && !isModulesData(path)) {
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

  // The summary is only read by the review UI; the desktop lints on every
  // keystroke and never touches it. Build it on first access, then cache.
  let summaryCache: SummarySection[] | undefined;

  return {
    findings,
    effective,
    binds,
    moduleLevels,
    classesTouched,
    get summary(): SummarySection[] {
      if (summaryCache === undefined) {
        summaryCache = buildSummary(effective);
      }
      return summaryCache;
    },
    ok: !findings.some((f) => f.tier === "block"),
  };
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function rootRank(path: string): number {
  const base = basename(path);
  if (base === "autoexec.cfg") return 0;
  if (base in CLASS_CFG_NAMES) return 1;
  return 2;
}
