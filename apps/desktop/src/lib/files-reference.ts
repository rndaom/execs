import {
  createCfgResolver,
  enumerateCatalog,
  normalizeCfgPath,
  parseCommands,
} from "@execs/cfglint";

export const CLASS_CFG_NAMES = [
  "scout",
  "soldier",
  "pyro",
  "demoman",
  "heavyweapons",
  "engineer",
  "medic",
  "sniper",
  "spy",
] as const;
export const REFERENCE_REVIEWED = "2026-09-22";
/** Bounded, name-first lookup over the pinned offline catalog. */
export function searchCfgCommands(query: string, limit = 12) {
  const term = query.trim().toLowerCase();
  if (!term) return [];
  const prefix = [];
  const other = [];
  for (const entry of enumerateCatalog()) {
    if (entry.name.startsWith(term)) prefix.push(entry);
    else if (entry.name.includes(term)) other.push(entry);
  }
  return [...prefix, ...other].slice(0, limit);
}

/** Mirrors the native HUD manifest resolver: exact record wins, then a unique HUD marker. */
export function cfgHudFolder(
  files: readonly { path: string }[],
  hud: { id: string } | null | undefined,
): string | null {
  if (!hud) return null;
  const roots = files
    .map((file) => normalizeCfgPath(file.path))
    .map((path) => /^tf\/custom\/([^/]+)\/(.+)$/.exec(path))
    .filter((match) => match !== null);
  const exact = roots.find((match) => match[1] === hud.id.toLowerCase());
  if (exact) return exact[1];
  const marked = new Set(
    roots
      .filter((match) => match[2] === "info.vdf" || match[2].startsWith("resource/ui/"))
      .map((match) => match[1]),
  );
  return marked.size === 1 ? [...marked][0] : null;
}

export type CfgSourceLink = {
  kind: "exec" | "alias";
  file: string;
  line: number;
  target: string | null;
  targetLine?: number;
  label: string;
  deferred: boolean;
};
export const CFG_SOURCE_LINK_LIMIT = 1000;

/** Only labels are exposed; never forward command arguments or cfg excerpts. */
export function cfgSourceLinks(files: readonly { path: string; text: string }[]): CfgSourceLink[] {
  const resolver = createCfgResolver(files.map((file) => file.path));
  const commands = files.flatMap((file) => parseCommands(file.text, file.path));
  const aliases = new Map<string, { file: string; line: number }[]>();
  for (const command of commands) {
    if (command.name !== "alias" || !command.args[0]) continue;
    const key = command.args[0].toLowerCase();
    aliases.set(key, [...(aliases.get(key) ?? []), { file: command.file, line: command.line }]);
  }
  const links: CfgSourceLink[] = [];
  const visit = (command: (typeof commands)[number], deferred: boolean) => {
    if (links.length >= CFG_SOURCE_LINK_LIMIT) return;
    if (command.name === "exec" && command.args[0]) {
      const resolved = resolver.problem ? null : resolver.resolve(command.args[0]);
      links.push({
        kind: "exec",
        file: command.file,
        line: command.line,
        target: files.find((file) => normalizeCfgPath(file.path) === resolved)?.path ?? null,
        label: "Exec target",
        deferred,
      });
    } else if (aliases.has(command.name)) {
      for (const definition of aliases.get(command.name) ?? []) {
        if (links.length >= CFG_SOURCE_LINK_LIMIT) break;
        links.push({
          kind: "alias",
          file: command.file,
          line: command.line,
          target: definition.file,
          targetLine: definition.line,
          label: "Alias definition candidate",
          deferred,
        });
      }
    }
  };
  for (const command of commands) {
    if (links.length >= CFG_SOURCE_LINK_LIMIT) break;
    visit(command, false);
    if ((command.name === "bind" || command.name === "alias") && command.args[1]) {
      for (const nested of parseCommands(command.args.slice(1).join(" "), command.file))
        visit({ ...nested, line: command.line }, true);
    }
  }
  return links;
}

export function cfgExecutionRole(
  path: string,
  files: readonly { path: string }[],
  mastercomfig: boolean,
): string {
  const resolver = createCfgResolver(files.map((file) => file.path));
  const normalized = normalizeCfgPath(path);
  if (resolver.problem) return "Unknown: ambiguous cfg mount ordering";
  if (["config", "autoexec"].some((name) => resolver.startup(name) === normalized))
    return "Startup entry candidate";
  if (CLASS_CFG_NAMES.some((name) => resolver.resolve(name) === normalized))
    return "Class-change entry candidate";
  if (mastercomfig && normalized === "tf/cfg/overrides/autoexec.cfg")
    return "mastercomfig startup hook";
  if (mastercomfig && CLASS_CFG_NAMES.some((name) => normalized === `tf/cfg/overrides/${name}.cfg`))
    return "mastercomfig class hook";
  if (mastercomfig && normalized === "tf/cfg/overrides/game_overrides.cfg")
    return "mastercomfig shared class hook";
  return "Helper or unknown: requires an exec, alias or manual invocation";
}

/** Deliberately masks the entire line, including quoted/nested credential payloads. */
export function maskCfgPreview(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) =>
      /\b(?:password|rcon_password|sv_password|tv_password|tv_relaypassword)\b/i.test(line)
        ? "[Credential-containing line hidden]"
        : line,
    )
    .join("\n");
}
