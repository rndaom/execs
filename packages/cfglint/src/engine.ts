import { argumentFindings } from "./arguments.ts";
import { lookupCommand, suggestCvarByRemovingOneCharacter } from "./catalog.ts";
import { lookupCvar } from "./corpus.ts";
import { evaluateStartup } from "./execution.ts";
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
  MAX_COMMAND_VISITS,
  MAX_EXEC_DEPTH,
  MAX_EXEC_VISITS,
  MOUSE_CVARS,
  NETWORK_HIJACK_COMMANDS,
  RCON_NAMES,
  SELF_HARM_COMMANDS,
} from "./rules-data.ts";
import { createCfgResolver } from "./search-paths.ts";
import { buildSummary } from "./summary.ts";
import type {
  CfgFile,
  Command,
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
  /** Payload is defined for a future alias/key invocation, not running now. */
  deferred?: boolean;
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
  let safetyComplete = true;
  const seenFindings = new Set<string>();
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
  const isAdvisorySource = (at: Command): boolean => {
    const origin = payloadOriginStack[payloadOriginStack.length - 1];
    return (
      advisoryPaths.has(normalizePath(at.file)) ||
      (origin !== undefined && advisoryPaths.has(normalizePath(origin)))
    );
  };

  const report = (
    tier: Finding["tier"],
    ruleId: string,
    message: string,
    at: Command,
    via?: string,
  ) => {
    if (
      [
        "analysis-budget",
        "alias-budget",
        "alias-depth",
        "exec-cycle",
        "exec-depth",
        "exec-external",
        "execution-search-path",
      ].includes(ruleId)
    )
      safetyComplete = false;
    const category: Finding["category"] = ruleId.startsWith("syntax-")
      ? "syntax"
      : ruleId.startsWith("argument-")
        ? "argument"
        : ruleId === "unknown-command" || ruleId === "runtime-restriction"
          ? "availability"
          : [
                "analysis-budget",
                "alias-budget",
                "alias-depth",
                "exec-cycle",
                "exec-depth",
                "exec-external",
                "execution-search-path",
                "execution-incomplete",
                "execution-unsupported",
              ].includes(ruleId)
            ? "coverage"
            : tier === "block"
              ? "restriction"
              : "advice";
    const span = { from: at.from, to: at.to, category };
    // Every command inside one payload anchors at the payload's own line/col,
    // so the command name has to be part of the key — otherwise
    // `bind mouse1 "kill; explode"` collapses into a single finding.
    const key = `${ruleId}|${at.file}|${at.line}|${at.col}|${via ?? ""}|${at.name}`;
    if (seenFindings.has(key)) return;
    seenFindings.add(key);
    // Provided (non-user) content never blocks: demote to an advisory warn.
    if (tier === "block" && isAdvisorySource(at)) {
      findings.push({
        ...span,
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
    findings.push({
      ...span,
      ruleId,
      tier,
      message,
      file: at.file,
      line: at.line,
      col: at.col,
      via,
    });
  };

  // Count every command and file visit across both passes. Exec depth does not
  // bound repeated fanout, and payloads must share the same limits as files.
  let commandVisits = 0;
  let execVisits = 0;
  let workExhausted = false;
  function takeWork(kind: "command" | "exec", at: Command, via?: string): boolean {
    if (workExhausted) return false;
    const count = kind === "command" ? commandVisits++ : execVisits++;
    const limit = kind === "command" ? MAX_COMMAND_VISITS : MAX_EXEC_VISITS;
    if (count < limit) return true;
    workExhausted = true;
    report(
      selfTrusted,
      "analysis-budget",
      `Cfg analysis stopped at the ${limit} ${kind} visit limit; results are incomplete`,
      at,
      via,
    );
    return false;
  }

  // A repeated alias/exec may visit the same large payload many times. Parse
  // each distinct payload once; the visit budget still counts every command.
  const payloadCache = new WeakMap<Command, Map<string, Command[]>>();
  const sourceLines = new Map(
    files.map((file) => {
      const starts = [0];
      for (let i = 0; i < file.text.length; i++) if (file.text[i] === "\n") starts.push(i + 1);
      return [file.path, starts] as const;
    }),
  );
  function position(file: string, offset: number) {
    const starts = sourceLines.get(file) ?? [0];
    let low = 0;
    let high = starts.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (starts[middle] <= offset) low = middle;
      else high = middle;
    }
    return { line: low + 1, col: offset - starts[low] + 1 };
  }
  function payloadCommands(payload: string, site: Command): Command[] {
    let siteCache = payloadCache.get(site);
    if (!siteCache) {
      siteCache = new Map();
      payloadCache.set(site, siteCache);
    }
    let commands = siteCache.get(payload);
    if (!commands) {
      // join(" ") matches the engine-facing payload model. Map every UTF-16
      // character back to its original token, including unquoted payloads.
      const tokens = site.tokens.slice(2);
      const offsets: number[] = [];
      for (const [index, token] of tokens.entries()) {
        if (index) offsets.push(tokens[index - 1].contentTo);
        for (let i = 0; i < token.value.length; i++) offsets.push(token.contentFrom + i);
      }
      const end = tokens[tokens.length - 1]?.contentTo ?? site.to;
      const map = (offset: number) => offsets[offset] ?? end;
      commands = parseCommands(payload, site.file).map((inner) => {
        const remap = (token: Command["tokens"][number]) => ({
          ...token,
          from: map(token.from),
          to: token.to > token.from ? map(token.to - 1) + 1 : map(token.to),
          contentFrom: map(token.contentFrom),
          contentTo:
            token.contentTo > token.contentFrom
              ? map(token.contentTo - 1) + 1
              : map(token.contentTo),
          ...position(site.file, map(token.from)),
        });
        const mapped = inner.tokens.map(remap);
        return {
          ...inner,
          from: mapped[0].from,
          to: mapped[mapped.length - 1].to,
          ...position(site.file, mapped[0].from),
          tokens: mapped,
        };
      });
      siteCache.set(payload, commands);
    }
    return commands;
  }

  // ---- parse all files ------------------------------------------------------
  const parsed = new Map<string, { file: CfgFile; commands: Command[] }>();
  for (const file of files) {
    const norm = normalizePath(file.path);
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

  const search = createCfgResolver(
    files.map((file) => file.path),
    opts.bundleRelativeExec,
  );
  const resolveExec = search.resolve;
  if (search.problem) {
    report("warn", "execution-search-path", search.problem.message, {
      name: "exec",
      args: [],
      tokens: [],
      file: search.problem.file,
      line: 1,
      col: 1,
      from: 0,
      to: 0,
    });
  }

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
    safetyComplete = false;
    const bare = target.toLowerCase().replace(/\.cfg$/, "");
    if (externalAllow.has(bare)) return; // well-known engine/user file
    report(
      selfTrusted,
      "exec-external",
      `\`exec ${target}\` is not in this profile's inspected cfg sources; it may exist elsewhere in the install`,
      cmd,
      via,
    );
  };

  const checkCommand = (cmd: Command, ctx: ScanContext, aliasStack: string[]): void => {
    if (!takeWork("command", cmd, ctx.via)) return;
    const { name } = cmd;
    const value = cmd.args[0]?.toLowerCase();
    const isEngineManagedTopLevel =
      ctx.via === undefined && engineManagedConfigPaths.has(normalizePath(cmd.file));

    for (const token of cmd.tokens) {
      if (token.closed) continue;
      safetyComplete = false;
      report(
        "warn",
        "syntax-quote",
        "Unclosed quote; analysis recovers at the next line, so check the intended payload",
        { ...cmd, from: token.from, to: token.to, line: token.line, col: token.col },
        ctx.via,
      );
    }
    // Credentials never enter generic argument messages or reference values.
    if (name !== "password" && !RCON_NAMES.has(name)) {
      for (const finding of argumentFindings(cmd)) {
        report(
          finding.tier,
          finding.ruleId,
          finding.message,
          {
            ...cmd,
            from: finding.from ?? cmd.from,
            to: finding.to ?? cmd.to,
            line: finding.line,
            col: finding.col,
          },
          ctx.via,
        );
      }
    }

    if (NETWORK_HIJACK_COMMANDS.has(name)) {
      report(
        selfTrusted,
        "connect-redirect",
        trust === "self" && !isAdvisorySource(cmd)
          ? `\`${name}\` joins the specified server when this command runs`
          : `\`${name}\` routes the player to a server chosen by the config author`,
        cmd,
        ctx.via,
      );
      return;
    }
    if (name === "password" || RCON_NAMES.has(name)) {
      // Players can save their own cfg bytes, including credentials. The
      // finding points to the command before a profile is shared, without
      // copying its value into diagnostics or a generated summary. Source
      // archives the unset password value into config.cfg; it is not a secret.
      if (cmd.args.length === 0) return;
      if (name === "password" && cmd.args.length === 1 && (value === "" || value === "0")) return;
      if (name === "rcon_password" && cmd.args.length === 1 && value === "") return;
      report(
        "warn",
        "rcon-password",
        `\`${name}\` may contain a credential or remote-console setting. It is saved unchanged; review this line before sharing an exported profile`,
        cmd,
        ctx.via,
      );
      return;
    }
    if (name === "unbindall") {
      if (isEngineManagedTopLevel) return;
      report(
        ctx.via && (trust === "provided" || isAdvisorySource(cmd)) ? "block" : "warn",
        "unbindall",
        ctx.via
          ? `\`unbindall\` inside ${ctx.via} clears every key bind when that payload runs`
          : "`unbindall` clears existing binds; this is normal before a config declares its complete bind set",
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
        `When run in TF2, host_writeconfig serializes current settings and binds to ${cmd.args[0] ? `${cmd.args[0].replace(/\.cfg$/i, "")}.cfg` : "config.cfg"}; it does not preserve this source's comments or alias definitions`,
        cmd,
        ctx.via,
      );
      return;
    }

    if (name === "alias" && cmd.args.length >= 1) {
      const aliasName = cmd.args[0].toLowerCase();
      const bare = aliasName.replace(/^[+-]/, "");
      const entry = lookupCommand(aliasName) ?? lookupCommand(bare);
      if (ALIAS_SHADOW_DENYLIST.has(bare) || entry?.kind === "command") {
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
      if (payload)
        scanPayload(payload, cmd, { via: `alias ${cmd.args[0]}`, deferred: true }, aliasStack);
      return;
    }

    if (name === "bind" && cmd.args.length >= 1) {
      const key = cmd.args[0].toLowerCase();
      if (key === "escape" && cmd.args.length > 1) {
        const payload = cmd.args.slice(1).join(" ").trim().toLowerCase();
        const preservesMenu =
          (isEngineManagedTopLevel || (trust === "self" && !isAdvisorySource(cmd))) &&
          ENGINE_MENU_COMMANDS.has(payload);
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
        scanPayload(payload, cmd, { via: `bind ${key}`, bindKey: key, deferred: true }, aliasStack);
      }
      return;
    }

    if (name === "exec") {
      // The safety walk scans every supplied file, including dormant cfgs.
      // Resolving a deferred `exec` here is useful for missing-source advice,
      // but following it with the defining file's active exec chain falsely
      // reports recursion for `alias reload "exec this_file"`. Startup
      // evaluation follows aliases only when they actually run.
      if (ctx.via === undefined) return;
      const target = cmd.args[0];
      if (!target) return;
      const resolved = resolveExec(target);
      if (!resolved) {
        reportUnresolvedExec(target, cmd, ctx.via);
        return;
      }
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
        if (ctx.deferred && !ctx.bindKey && trust === "self" && !isAdvisorySource(cmd)) return;
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
      if (trust === "self" && !isAdvisorySource(cmd)) return;
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

    // `sensitivity` and the `m_*` family are archived too, so every config.cfg
    // carries them. Warning there would pin a notice to the player's own
    // settings snapshot that they could never clear. This branch falls through
    // either way; startup evaluation is independent of these safety findings.
    if (
      MOUSE_CVARS.has(name) &&
      !isEngineManagedTopLevel &&
      (trust === "provided" || isAdvisorySource(cmd))
    ) {
      report(
        "warn",
        "mouse-tamper",
        `\`${name}\` changes mouse feel — make sure players expect this`,
        cmd,
        ctx.via,
      );
    }

    const entry = lookupCvar(name);
    if (entry && lookupCommand(name)?.kind !== "alias") {
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
        scanPayload(
          aliasDef.payload,
          aliasDef.site,
          { ...ctx, via: ctx.via ? `${ctx.via} → alias ${name}` : `alias ${name}` },
          [...aliasStack, name],
        );
      } finally {
        payloadOriginStack.pop();
      }
      return;
    }

    if (entry) return; // catalogued comfig alias; availability is conditional

    // Unknown token: +forward style actions and one-off community commands land here.
    const suggestion = suggestCvarByRemovingOneCharacter(name);
    report(
      "info",
      "unknown-command",
      `\`${name}\` is not in this offline catalog; a plugin or external alias may define it${suggestion ? `; did you mean \`${suggestion}\`?` : ""}`,
      { ...cmd, to: cmd.tokens[0]?.to ?? cmd.to },
      ctx.via,
    );
  };

  function scanPayload(payload: string, site: Command, ctx: ScanContext, aliasStack: string[]) {
    for (const inner of payloadCommands(payload, site)) {
      if (workExhausted) break;
      checkCommand(inner, ctx, aliasStack);
    }
  }

  // ---- safety walk (all files, including dormant files and payloads) --------
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
    const at = entry.commands[0];
    if (workExhausted || (at && !takeWork("exec", at))) return;
    visited.add(path);
    const prevDepth = execDepth;
    const prevChain = execChain;
    execDepth = depth;
    execChain = chain;
    try {
      for (const cmd of entry.commands) {
        if (workExhausted) break;
        if (cmd.name === "exec" && cmd.args[0]) {
          checkCommand(cmd, {}, []);
          if (workExhausted) break;
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
    if (workExhausted) break;
    walkFile(root, 0, [root]);
  }
  // Files only reachable through exec cycles have no root — sweep them too.
  for (const path of parsed.keys()) {
    if (workExhausted) break;
    if (!visited.has(path) && !isModulesData(path)) {
      walkFile(path, 0, [path]);
    }
  }

  // ---- actual supported startup execution ---------------------------------
  // Startup uses the same mounted namespace as nested execs. Exact entry
  // paths remain available for callers that already resolved layer hooks.
  const entryPoints = (
    opts.entryPoints ??
    [search.startup("config"), search.startup("autoexec")].filter((path) => path !== null)
  )
    .map(normalizePath)
    .filter((path) => parsed.has(path) && !isModulesData(path));
  const execution: ReturnType<typeof evaluateStartup> =
    workExhausted || search.problem
      ? { effective: new Map(), binds: new Map(), executionComplete: false }
      : evaluateStartup({
          files: parsed,
          entryPoints,
          resolveExec,
          payloadCommands,
          takeCommand: (at) => takeWork("command", at),
          takeExec: (at) => takeWork("exec", at),
          incomplete: (rule, message, at) => report("warn", rule, message, at),
          allowMalformedBinds: trust === "self",
        });
  const { effective, binds, executionComplete } = execution;

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

  // Nothing on the hot path reads `summary`: the desktop lints on every
  // keystroke and only ever looks at `findings`. It is here for callers that
  // want to show what a config actually changes — the CLI prints it. Build it
  // on first access, then cache.
  let summaryCache: SummarySection[] | undefined;

  return {
    safetyComplete,
    findings,
    effective,
    binds,
    executionComplete,
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
