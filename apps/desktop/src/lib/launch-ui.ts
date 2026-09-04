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

/**
 * Forbidden tokens present in `options`, in the order they are listed above.
 * `-dxlevel` matches its value argument too, and the match is case-insensitive
 * because Steam's own launch strings are.
 */
export function forbiddenLaunchTokens(options: string): ForbiddenLaunchToken[] {
  const lowered = options.toLowerCase();
  const words = lowered.split(/\s+/).filter((word) => word.length > 0);
  return FORBIDDEN_LAUNCH_TOKENS.filter((token) =>
    token === "%command%" ? lowered.includes(token) : words.includes(token),
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
