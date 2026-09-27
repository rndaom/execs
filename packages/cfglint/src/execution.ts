import { lookupCommand } from "./catalog.ts";
import { lookupCvar } from "./corpus.ts";
import { BUILTIN_COMMANDS, MAX_ALIAS_DEPTH, MAX_EXEC_DEPTH, RCON_NAMES } from "./rules-data.ts";
import type { Command, CvarValue } from "./types.ts";

type ExecutionContext = {
  files: Map<string, { commands: Command[] }>;
  entryPoints: string[];
  /** Loader-defined aliases available before the first entry point. */
  startupAliases: Readonly<Record<string, string>>;
  resolveExec: (target: string) => string | null;
  payloadCommands: (payload: string, site: Command) => Command[];
  takeCommand: (at: Command) => boolean;
  takeExec: (at: Command) => boolean;
  incomplete: (rule: string, message: string, at: Command) => void;
  allowMalformedBinds: boolean;
};

/**
 * Derive only the supported startup execution path. This has no access to the
 * safety scanner's alias table: a definition becomes available when executed,
 * and defining a bind/alias never runs its payload. Class, key, server and
 * external engine events are deliberately outside this startup model.
 */
export function evaluateStartup(ctx: ExecutionContext): {
  effective: Map<string, CvarValue>;
  binds: Map<string, string>;
  bindSources: Map<string, { file: string; line: number }>;
  executionComplete: boolean;
} {
  const effective = new Map<string, CvarValue>();
  const binds = new Map<string, string>();
  const bindSources = new Map<string, { file: string; line: number }>();
  const aliases = new Map<string, { payload: string; site: Command | null; malformed: boolean }>();
  // Loader definitions have no user file; their payload is reported at the
  // line that invokes them.
  for (const [name, payload] of Object.entries(ctx.startupAliases)) {
    aliases.set(name.toLowerCase(), { payload, site: null, malformed: false });
  }
  let complete = true;

  function stop(rule: string, message: string, at: Command) {
    complete = false;
    ctx.incomplete(rule, message, at);
  }

  function commands(list: Command[], chain: string[], aliasStack: string[]): void {
    for (const cmd of list) {
      if (!complete) break;
      if (!ctx.takeCommand(cmd)) {
        complete = false;
        break;
      }
      const { name, args } = cmd;
      if (cmd.tokens.some((token) => !token.closed)) {
        // A malformed bind cannot establish that key, but a newline-bound
        // parser recovery can still establish later, unrelated settings.
        // Keep the syntax finding from the safety pass for the user to fix.
        if (ctx.allowMalformedBinds && name === "bind") continue;
        // Defining an alias does not run its payload. Keep it unresolved until
        // invocation so a dormant alias with nested/unmatched quotes cannot
        // erase reliable, unrelated startup settings.
        if (name === "alias" && args[0]) {
          aliases.set(args[0].toLowerCase(), { payload: "", site: cmd, malformed: true });
          continue;
        }
        stop(
          "execution-incomplete",
          "Startup contains an unclosed quote; settings are incomplete",
          cmd,
        );
        continue;
      }
      // Findings identify credentials without exposing their bytes through
      // the returned settings map or its human-readable summary.
      if (name === "password" || RCON_NAMES.has(name)) continue;
      if (name === "exec") {
        if (!args[0]) continue;
        const resolved = ctx.resolveExec(args[0]);
        if (!resolved) {
          stop(
            "execution-incomplete",
            `Startup \`exec ${args[0]}\` could not be resolved; settings are incomplete`,
            cmd,
          );
        } else if (chain.includes(resolved)) {
          stop("exec-cycle", `\`exec ${args[0]}\` creates a cycle`, cmd);
        } else if (chain.length > MAX_EXEC_DEPTH) {
          stop("exec-depth", `exec chain deeper than ${MAX_EXEC_DEPTH}`, cmd);
        } else {
          file(resolved, [...chain, resolved], aliasStack, cmd);
        }
        continue;
      }
      if (name === "alias") {
        if (args[0])
          aliases.set(args[0].toLowerCase(), {
            payload: args.slice(1).join(" "),
            site: cmd,
            malformed: false,
          });
        continue;
      }
      if (name === "bind") {
        // With no payload Source queries the key; an explicitly empty payload removes it.
        if (args.length >= 2) {
          const key = args[0].toLowerCase();
          const payload = args.slice(1).join(" ");
          if (payload) {
            binds.set(key, payload);
            bindSources.set(key, { file: cmd.file, line: cmd.line });
          } else {
            binds.delete(key);
            bindSources.delete(key);
          }
        }
        continue;
      }
      if (name === "unbind") {
        if (args[0]) {
          binds.delete(args[0].toLowerCase());
          bindSources.delete(args[0].toLowerCase());
        }
        continue;
      }
      if (name === "unbindall") {
        binds.clear();
        bindSources.clear();
        continue;
      }
      // These mutate settings or add commands conditionally. Do not pretend
      // their arguments are ordinary cvar writes or retain a partial result.
      if (
        ["toggle", "incrementvar", "multvar", "bindtoggle", "execifexists", "stuffcmds"].includes(
          name,
        )
      ) {
        stop(
          "execution-unsupported",
          `Startup \`${name}\` needs engine state; settings are incomplete`,
          cmd,
        );
        continue;
      }
      const entry = lookupCvar(name);
      if (BUILTIN_COMMANDS.has(name)) continue;
      if (entry && lookupCommand(name)?.kind !== "alias") {
        if (entry.c === 0 && args.length > 0) {
          effective.set(name, { value: args.join(" "), file: cmd.file, line: cmd.line });
        }
        continue;
      }
      const alias = aliases.get(name);
      if (alias) {
        if (alias.malformed) {
          stop(
            "execution-incomplete",
            `Startup alias \`${name}\` has unmatched quotes; settings are incomplete`,
            cmd,
          );
          continue;
        }
        if (aliasStack.includes(name) || aliasStack.length >= MAX_ALIAS_DEPTH) {
          stop(
            "alias-depth",
            `Startup alias \`${name}\` cycles or exceeds depth ${MAX_ALIAS_DEPTH}`,
            cmd,
          );
          continue;
        }
        commands(ctx.payloadCommands(alias.payload, alias.site ?? cmd), chain, [
          ...aliasStack,
          name,
        ]);
      } else {
        stop(
          "execution-incomplete",
          `Startup ${name} has no inspected implementation; plugin and external alias effects are unknown`,
          cmd,
        );
      }
    }
  }

  function file(path: string, chain: string[], aliasStack: string[], site?: Command): void {
    const entry = ctx.files.get(path);
    if (!entry) return;
    const at = site ?? entry.commands[0];
    if (at && !ctx.takeExec(at)) {
      complete = false;
      return;
    }
    commands(entry.commands, chain, aliasStack);
  }

  for (const path of ctx.entryPoints) {
    if (!complete) break;
    file(path, [path], []);
  }
  // Consumers must not accidentally treat the prefix before a limit as the
  // final settings and serialize it back on an unrelated edit.
  if (!complete) {
    effective.clear();
    binds.clear();
    bindSources.clear();
  }
  return { effective, binds, bindSources, executionComplete: complete };
}
