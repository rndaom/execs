import { type CatalogArgument, lookupCommand } from "./catalog.ts";
import type { Command, Finding } from "./types.ts";

/** Only explicit, sourced metadata produces argument diagnostics. Defaults are strings. */
export function argumentFindings(cmd: Command): Finding[] {
  const entry = lookupCommand(cmd.name);
  if (!entry) return [];
  const findings: Finding[] = [];
  const add = (ruleId: string, message: string, index?: number) => {
    const token = index === undefined ? undefined : cmd.tokens[index + 1];
    findings.push({
      ruleId,
      tier: "warn",
      category: "argument",
      message,
      file: cmd.file,
      line: token?.line ?? cmd.line,
      col: token ? token.col + (token.contentFrom - token.from) : cmd.col,
      from: token?.contentFrom ?? cmd.from,
      to: token?.contentTo ?? cmd.to,
    });
  };
  const check = (argument: CatalogArgument, index: number) => {
    const value = cmd.args[index];
    if (value === undefined) return;
    if (argument.values && !argument.values.includes(value)) {
      add(
        "argument-choice",
        `${cmd.name}: ${argument.name} expects ${argument.values.join(", ")} in the cited source`,
        index,
      );
    }
    if (argument.type !== "integer" && argument.type !== "number") return;
    const numeric =
      /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) && Number.isFinite(Number(value));
    if (!numeric || (argument.type === "integer" && !/^[+-]?\d+$/.test(value))) {
      add(
        "argument-number",
        `${cmd.name}: ${argument.name} expects ${argument.type === "integer" ? "an integer" : "a number"}; Source may coerce this text instead of rejecting it`,
        index,
      );
      return;
    }
    const number = Number(value);
    if (
      (argument.min !== undefined && number < argument.min) ||
      (argument.max !== undefined && number > argument.max)
    ) {
      add(
        "argument-range",
        `${cmd.name}: the cited source bounds ${argument.name} to ${argument.min ?? "no minimum"}–${argument.max ?? "no maximum"}; the engine may clamp this value`,
        index,
      );
    }
  };
  if (entry.arguments) {
    const required = entry.arguments.filter((argument) => !argument.optional).length;
    // Metadata establishes the consumed parameters, not an exhaustive arity:
    // e.g. the SDK voicemenu handler ignores trailing arguments.
    if (cmd.args.length < required) {
      add(
        "argument-count",
        `${cmd.name}: expected ${entry.syntax ?? `${required}–${entry.arguments.length} arguments`} in the cited source`,
      );
    }
    entry.arguments.forEach(check);
  }
  if (entry.kind === "cvar" && entry.value && cmd.args.length) check(entry.value, 0);
  if ((cmd.args.length || entry.kind === "command") && entry.flags.includes("cheat")) {
    findings.push({
      ruleId: "runtime-restriction",
      tier: "info",
      category: "availability",
      message: `${cmd.name} is cheat-gated in the pinned source; availability depends on server and game state`,
      file: cmd.file,
      line: cmd.line,
      col: cmd.col,
      from: cmd.from,
      to: cmd.tokens[0].to,
    });
  }
  return findings;
}
