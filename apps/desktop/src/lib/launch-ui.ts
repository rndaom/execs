export type SteamWriteStatus = "written" | "steam_open" | "no_account" | "write_failed";

/** The official mastercomfig set new and wizard profiles start from. */
export function recommendedLaunchOptions(): string {
  return "-novid -nojoy -nosteamcontroller -nohltv -particles 1";
}

/**
 * Flags a profile must never store (AGENTS.md). The backend strips
 * these on save; the pane flags them as you type so the textarea never changes
 * under the user without an explanation.
 */
export const FORBIDDEN_LAUNCH_TOKENS = [
  "-autoconfig",
  "-default",
  "-dxlevel",
  "+quit",
  "gamemoderun",
  "%command%",
] as const;

export type ForbiddenLaunchToken = (typeof FORBIDDEN_LAUNCH_TOKENS)[number];

type LaunchWord = { start: number; end: number; value: string };

/** Preserve source ranges and quoted arguments; these are editing aids, not a shell parser. */
function launchWords(raw: string): { words: LaunchWord[]; simple: boolean } {
  const words: LaunchWord[] = [];
  let quote: string | null = null;
  let escaped = false;
  let start = -1;
  let value = "";
  let simple = true;
  function push(end: number) {
    if (start >= 0) words.push({ start, end, value });
    start = -1;
    value = "";
  }
  for (let i = 0; i < raw.length; i++) {
    const character = raw[i];
    if (!quote && /\s/.test(character)) {
      push(i);
      escaped = false;
      continue;
    }
    if (!quote && character === ";") simple = false;
    if (start < 0) start = i;
    if ((character === '"' || character === "'") && !escaped) {
      if (quote === character) quote = null;
      else if (!quote) quote = character;
      else value += character;
      escaped = false;
      continue;
    }
    value += character;
    escaped = character === "\\" && !escaped;
  }
  push(raw.length);
  return { words, simple: simple && !quote };
}

export type LaunchOptionGroup = { start: number; end: number; text: string };

/** Removing one option also removes its values, while preserving every other byte. */
export function launchOptionGroups(raw: string): LaunchOptionGroup[] | null {
  const { words, simple } = launchWords(raw);
  if (!simple) return null;
  const groups: LaunchOptionGroup[] = [];
  for (const word of words) {
    const option = /^[-+][a-z_]/i.test(word.value);
    // A quoted option-looking word can be either a flag or argument data.
    // Keep that ambiguity in the raw editor rather than guessing a removal span.
    if (option && !/^[-+]/.test(raw.slice(word.start, word.end))) return null;
    if (groups.length === 0 && !option) return null;
    if (option) {
      groups.push({ start: word.start, end: word.end, text: "" });
    } else groups[groups.length - 1].end = word.end;
  }
  return groups.map((group) => ({ ...group, text: raw.slice(group.start, group.end) }));
}

/** Appending must not rewrite the spelling, quotes or whitespace already entered. */
export function appendLaunchOption(raw: string, option: string): string {
  const next = option.trim();
  if (!next) return raw;
  return `${raw}${raw && !/\s$/.test(raw) ? " " : ""}${next}`;
}

export function removeLaunchOption(raw: string, group: LaunchOptionGroup): string {
  // Refuse a stale chip after its underlying launch string changed.
  if (raw.slice(group.start, group.end) !== group.text) return raw;
  const before = raw.slice(0, group.start);
  const after = raw.slice(group.end);
  return before && after ? before + after.replace(/^\s+/, "") : (before || after).trim();
}

/**
 * Forbidden tokens present in `options`, in the order they are listed above.
 * `-dxlevel` matches its value argument too, and the match is case-insensitive
 * because Steam's own launch strings are.
 */
export function forbiddenLaunchTokens(options: string): ForbiddenLaunchToken[] {
  const lowered = options.toLowerCase();
  const words = launchWords(lowered).words.flatMap((word) =>
    word.value
      .replace(/\\(?=["'])/g, "")
      .replace(/["']/g, "")
      .split(/[;\s]+/),
  );
  return FORBIDDEN_LAUNCH_TOKENS.filter((token) =>
    token === "%command%"
      ? words.some((word) => word.includes(token))
      : token === "-dxlevel"
        ? words.some((word) => word.startsWith(token))
        : words.includes(token),
  );
}

/** What the backend actually removed, comparing the sent and echoed strings. */
export function strippedLaunchTokens(sent: string, saved: string): ForbiddenLaunchToken[] {
  const kept = new Set(forbiddenLaunchTokens(saved));
  return forbiddenLaunchTokens(sent).filter((token) => !kept.has(token));
}

export function forbiddenLaunchNotice(tokens: ForbiddenLaunchToken[]): string {
  if (tokens.length === 0) {
    return "";
  }
  return `${tokens.join(", ")} will be removed on save.`;
}

export function strippedLaunchNotice(tokens: ForbiddenLaunchToken[]): string {
  if (tokens.length === 0) {
    return "";
  }
  return `Removed on save: ${tokens.join(", ")}.`;
}

export function steamWriteCopy(status: SteamWriteStatus): string {
  switch (status) {
    case "written":
      return "Wrote Steam launch options.";
    case "steam_open":
      return "Saved. Steam is open — copy into TF2 Properties yourself.";
    case "no_account":
      return "Saved. No Steam userdata folder found.";
    case "write_failed":
      return "Saved to the profile. Steam could not be updated yet.";
  }
}
