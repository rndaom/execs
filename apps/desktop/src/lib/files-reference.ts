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
export const CFG_GUIDES = [
  {
    id: "first",
    title: "Your first cfg",
    text: "Create autoexec.cfg in the detected user layer. Add the Console marker snippet, review its destination, then save. On the next TF2 launch, open the console to find the marker. Saving a draft does not execute it in the running game.",
  },
  {
    id: "files",
    title: "config.cfg and autoexec.cfg",
    text: "config.cfg is engine-managed but editable here. TF2 saves archived settings and binds back to it; engine serialization need not preserve your comments or alias definitions. Put authored scripts in autoexec.cfg. Later commands can replace earlier values.",
  },
  {
    id: "profile",
    title: "Profile and live files",
    text: "Files edits the selected profile. Saving an active profile also projects its supported user files into the confirmed install while TF2 is closed. Inactive profiles remain in the library. Unsaved drafts have no game effect. Engine, HUD and pack sources are provided read-only.",
  },
  {
    id: "layers",
    title: "Vanilla and mastercomfig",
    text: "Vanilla user scripts live in tf/cfg. Supported mastercomfig user scripts live in tf/cfg/overrides: autoexec.cfg at launch and class cfgs at class change. game_overrides.cfg is the shared class hook. Use Comfig for preset/modules, Binds for managed binds, and Gameplay for its managed controls; saving those panes may rewrite their cfg commands.",
  },
  {
    id: "classes",
    title: "All nine class files",
    text: `${CLASS_CFG_NAMES.map((name) => `${name}.cfg`).join(", ")}. Heavy uses heavyweapons.cfg. Class scripts run on class changes; values are not automatically reset when leaving a class. Review the other class files before assuming a setting only affects one class.`,
  },
  {
    id: "syntax",
    title: "Comments, quotes and semicolons",
    text: "Use // for a line comment. Quote multi-word arguments. A semicolon separates commands outside quotes. A quoted bind or alias payload can contain several commands; those commands run later when invoked. Keep scripts small and check diagnostics before saving.",
  },
  {
    id: "bind",
    title: "Binds and press/release pairs",
    text: 'bind "KEY" "+action" assigns a key. A + command starts on press and its matching - command ends on release. Custom held actions need both +name and -name aliases. Avoid combining held actions in a bind without a deliberate release path. The Binds pane handles usual actions.',
  },
  {
    id: "alias",
    title: "Alias definition and invocation",
    text: 'alias "name" "commands" defines a command; writing name invokes it. A definition alone does not apply its payload. Definitions can be replaced later. Static links show candidate definitions, not proof of which definition exists at runtime.',
  },
  {
    id: "exec",
    title: "Exec paths and load order",
    text: "exec resolves from cfg search roots, not the current file’s folder. For tf/cfg/overrides/helper.cfg use exec overrides/helper. Custom mounts can shadow tf/cfg files. Files scans dormant and deferred content too; a finding does not prove startup execution. An unresolved target does not prove a file is absent: VPKs, unreadable files and inventory limits can hide sources.",
  },
  {
    id: "restrictions",
    title: "Server and cheat restrictions",
    text: "A recognized command may still be unavailable in your game build or disallowed by the server. Cheat-flagged settings require server permission; replicated values can be server-controlled. A documented default is source metadata, never your draft value or a measurement of the running game. This bundled reference may lag TF2 updates.",
  },
  {
    id: "findings",
    title: "Issues and catalog gaps",
    text: "Issues flag syntax, safety or analysis limits. Catalog gaps mean a name is absent from the pinned offline reference; they do not prove that TF2 rejects it. Files checks dormant class scripts and bind or alias payloads too, so a finding does not mean that command ran at startup.",
  },
  {
    id: "credentials",
    title: "Saved credentials",
    text: "TF2 can archive a server password into config.cfg. A nonempty password or remote-console setting is a save restriction because profiles and exports must not copy credentials. Remove the command explicitly in Files after reviewing what it is used for; execs will not silently strip it.",
  },
  {
    id: "incomplete",
    title: "Unresolved startup settings",
    text: "Binds, Gameplay, Crosshair and Sounds need a reliable startup cfg map before saving. An unresolved exec, unknown command or dynamic setting command can make that map incomplete. Open Files at the startup cfg and review Issues and Catalog gaps. Plugin or external alias effects cannot be inferred from a command name alone.",
  },
] as const;

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

export const CFG_SNIPPETS = [
  {
    id: "marker",
    title: "Console marker",
    text: '// Confirm this file ran by looking in the TF2 console.\necho "execs: my config loaded"\n',
    effect: "Prints a harmless console message when this cfg executes.",
  },
  {
    id: "helper",
    title: "Named console message",
    text: 'alias "execs_hello" "echo Hello from my config"\n',
    effect:
      "Defines execs_hello. Enter execs_hello in the console after this file runs to print the message.",
  },
] as const;

export function searchCfgGuides(query: string) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return CFG_GUIDES.filter((guide) =>
    terms.every((term) => `${guide.title} ${guide.text}`.toLowerCase().includes(term)),
  );
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
