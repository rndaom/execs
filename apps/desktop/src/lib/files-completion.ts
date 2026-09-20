import { tokenizeCommands } from "@execs/cfglint";

export type CompletionEntry = { label: string; type: string; detail?: string; info?: string };
export type CompletionCatalog = {
  commands: CompletionEntry[];
  keys: CompletionEntry[];
  arguments: Readonly<Record<string, CompletionEntry[]>>;
  positionalArguments?: Readonly<Record<string, readonly CompletionEntry[][]>>;
};

/** Source quotes have no backslash escapes. Recurse only into command payloads. */
export function cfgCompletionContext(
  text: string,
  position: number,
): {
  from: number;
  to: number;
  command: string;
  argument: number;
} | null {
  const lineStart = text.lastIndexOf("\n", position - 1) + 1;
  let tokens: string[] = [];
  let i = lineStart;
  let from = position;
  while (i < position) {
    if (text.startsWith("//", i)) return null;
    if (text[i] === ";") {
      tokens = [];
      i++;
      continue;
    }
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }
    const quoted = text[i] === '"';
    const start = i + (quoted ? 1 : 0);
    i = start;
    while (
      i < position &&
      (quoted ? text[i] !== '"' : !/[\s;"\n]/.test(text[i]) && !text.startsWith("//", i))
    )
      i++;
    if (i === position) {
      if (quoted && tokens.length === 2 && /^(bind|alias)$/i.test(tokens[0])) {
        const nested = cfgCompletionContext(text.slice(start), position - start);
        return nested && { ...nested, from: nested.from + start, to: nested.to + start };
      }
      from = start;
      break;
    }
    tokens.push(text.slice(start, i));
    if (quoted) i++;
  }
  let to = position;
  while (to < text.length && !/[\s;"\n]/.test(text[to]) && !text.startsWith("//", to)) to++;
  return { from, to, command: tokens[0]?.toLowerCase() ?? "", argument: tokens.length };
}

export function cfgCompletions(
  text: string,
  position: number,
  files: readonly { path: string; text: string }[],
  catalog: CompletionCatalog,
) {
  const context = cfgCompletionContext(text, position);
  if (!context) return null;
  const { command, argument } = context;
  let options: CompletionEntry[] = [];
  if (argument === 0) {
    const aliases = new Set<string>();
    for (const file of files) {
      for (const tokens of tokenizeCommands(file.text)) {
        if (
          tokens[0]?.value.toLowerCase() === "alias" &&
          tokens[1]?.value &&
          /^[+\-\w]+$/.test(tokens[1].value)
        )
          aliases.add(tokens[1].value);
      }
    }
    options = [
      ...catalog.commands,
      ...Array.from(aliases, (label) => ({
        label,
        type: "function",
        detail: "Local alias",
        info: "Defined in this profile’s loaded cfg files. Availability depends on execution order.",
      })),
    ];
  } else if (argument === 1 && /^(bind|unbind)$/i.test(command)) options = catalog.keys;
  else if (argument === 1 && /^(exec|execifexists)$/i.test(command)) {
    options = files.flatMap(({ path }) => {
      const normalized = path.replaceAll("\\", "/");
      const match = /^(?:tf\/)?cfg\/(.+)\.cfg$/i.exec(normalized);
      return match
        ? [
            {
              label: match[1],
              type: "text",
              detail: "Cfg file",
              info: `Loaded file: ${path}. Resolved relative to tf/cfg.`,
            },
          ]
        : [];
    });
  } else
    options =
      catalog.positionalArguments?.[command]?.[argument - 1] ??
      (argument === 1 ? (catalog.arguments[command] ?? []) : []);
  return { from: context.from, to: context.to, options };
}
