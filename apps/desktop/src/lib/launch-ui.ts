export type SteamWriteStatus = "written" | "steam_open" | "no_account" | "write_failed";

/**
 * TF2-relevant options documented by comfig, Steam Support, and the Valve
 * Developer Community. Keep the guided list focused on options a player can
 * reasonably choose; the launch string remains available for other flags.
 * https://docs.comfig.app/latest/customization/launch_options/
 * https://help.steampowered.com/en/faqs/view/7D01-D2DD-D75E-2955
 * https://developer.valvesoftware.com/wiki/Command_line_options
 */
export const LAUNCH_PRESETS = [
  {
    id: "novid",
    label: "Skip intro video",
    token: "-novid",
    kind: "flag",
    detail: "Skip the Valve startup video.",
  },
  {
    id: "nojoy",
    label: "Disable joystick",
    token: "-nojoy",
    kind: "flag",
    detail: "Do not initialize Source joystick support.",
  },
  {
    id: "nosteamcontroller",
    label: "Disable Steam controller",
    token: "-nosteamcontroller",
    kind: "flag",
    detail: "Skip Source's controller system; Steam Input remains available.",
  },
  {
    id: "nohltv",
    label: "Disable SourceTV hosting",
    token: "-nohltv",
    kind: "flag",
    detail: "Do not host SourceTV locally.",
  },
  {
    id: "particles",
    label: "Reduce beam count",
    token: "-particles 1",
    kind: "flag",
    detail: "Use the minimum beam allocation documented by comfig.",
  },
  {
    id: "console",
    label: "Open developer console",
    token: "-console",
    kind: "flag",
    detail: "Show the console when TF2 starts.",
  },
  {
    id: "nostartupsound",
    label: "Mute menu music",
    token: "-nostartupsound",
    kind: "flag",
    detail: "Skip main menu music at startup.",
  },
  {
    id: "freq",
    label: "Refresh rate",
    token: "-freq",
    kind: "refresh",
    detail: "Force a refresh rate only if TF2 detects it incorrectly.",
  },
  {
    id: "resolution",
    label: "Resolution",
    token: "-w",
    kind: "resolution",
    detail: "Force a width and height; prefer TF2 Video settings when they work.",
  },
  {
    id: "windowed",
    label: "Windowed mode",
    token: "-windowed",
    kind: "flag",
    detail: "Start in a window. May override the video mode selected in TF2.",
  },
  {
    id: "fullscreen",
    label: "Fullscreen mode",
    token: "-fullscreen",
    kind: "flag",
    detail: "Start fullscreen. May override the video mode selected in TF2.",
  },
  {
    id: "noborder",
    label: "Borderless window",
    token: "-noborder",
    kind: "flag",
    detail: "Remove the window border; use with windowed mode.",
  },
  {
    id: "no_texture_stream",
    label: "Disable texture streaming",
    token: "-no_texture_stream",
    kind: "flag",
    detail: "For systems with fast texture access and enough video memory.",
  },
  {
    id: "audiolanguage",
    label: "English voice lines",
    token: "-audiolanguage english",
    kind: "flag",
    detail: "Use English voice audio while keeping another game language.",
  },
  {
    id: "vulkan",
    label: "Vulkan renderer",
    token: "-vulkan",
    kind: "flag",
    detail: "Windows: run TF2 through DXVK. Performance depends on GPU and driver.",
  },
  {
    id: "displayindex",
    label: "Display index",
    token: "-displayindex",
    kind: "displayindex",
    detail: "Linux/macOS: choose a monitor by index; 0 is the primary display.",
  },
  {
    id: "nouserclip",
    label: "Software clip planes",
    token: "-nouserclip",
    kind: "flag",
    detail: "Use software clipping; performance varies by CPU and GPU.",
  },
  {
    id: "small",
    label: "Allow small resolutions",
    token: "-small",
    kind: "flag",
    detail: "Permit compact video modes such as 640 × 360.",
  },
  {
    id: "dev",
    label: "Developer output",
    token: "-dev",
    kind: "flag",
    detail: "Show extra console messages during debugging.",
  },
  {
    id: "condebug",
    label: "Log console output",
    token: "-condebug",
    kind: "flag",
    detail: "Write console output to tf/console.log.",
  },
  {
    id: "conclearlog",
    label: "Clear console log on launch",
    token: "-conclearlog",
    kind: "flag",
    detail: "Clear tf/console.log at startup; requires -condebug.",
  },
] as const;

export type LaunchPreset = (typeof LAUNCH_PRESETS)[number];
export type LaunchPresetId = LaunchPreset["id"];
export type LaunchPresetValues = {
  refresh: string;
  width: string;
  height: string;
  displayIndex?: string;
};

export const LAUNCH_PRESET_PAGE_SIZE = 8;

export function searchLaunchPresets(query: string): LaunchPreset[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return LAUNCH_PRESETS.filter((preset) => {
    const haystack = `${preset.label} ${preset.token} ${preset.detail}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export function launchPresetPresent(raw: string, preset: LaunchPreset): boolean {
  const groups = launchOptionGroups(raw);
  if (!groups) return false;
  const tokens = groups.map((group) => group.text.split(/\s+/, 1)[0].toLowerCase());
  if (preset.kind === "resolution")
    return ["-w", "-h", "-width", "-height"].some((token) => tokens.includes(token));
  if (preset.kind === "refresh")
    return ["-freq", "-refresh", "-refreshrate"].some((token) => tokens.includes(token));
  if (preset.id === "windowed")
    return ["-windowed", "-window", "-sw", "-startwindowed"].some((token) =>
      tokens.includes(token),
    );
  if (preset.id === "fullscreen")
    return ["-fullscreen", "-full"].some((token) => tokens.includes(token));
  return tokens.includes(preset.token.split(" ", 1)[0].toLowerCase());
}

export function launchPresetConflict(raw: string, preset: LaunchPreset): string | null {
  const tokens = launchOptionGroups(raw)?.map((group) =>
    group.text.split(/\s+/, 1)[0].toLowerCase(),
  );
  if (!tokens) return null;
  if (preset.id === "windowed" && ["-fullscreen", "-full"].some((token) => tokens.includes(token)))
    return "-fullscreen";
  if (
    preset.id === "fullscreen" &&
    ["-windowed", "-window", "-sw", "-startwindowed"].some((token) => tokens.includes(token))
  )
    return "-windowed";
  return null;
}

/** Only known options and bounded decimal values can enter the guided composer. */
export function buildLaunchPreset(
  preset: LaunchPreset,
  values: LaunchPresetValues,
  allowSmall = false,
): string | null {
  if (preset.kind === "flag") return preset.token;
  const decimal = (raw: string, min: number, max: number) => {
    if (!/^[0-9]{1,5}$/.test(raw)) return null;
    const value = Number(raw);
    return value >= min && value <= max ? String(value) : null;
  };
  if (preset.kind === "refresh") {
    const refresh = decimal(values.refresh, 30, 1000);
    return refresh === null ? null : `-freq ${refresh}`;
  }
  if (preset.kind === "displayindex") {
    const index = decimal(values.displayIndex ?? "", 0, 16);
    return index === null ? null : `-displayindex ${index}`;
  }
  const width = decimal(values.width, 640, 16384);
  const height = decimal(values.height, allowSmall ? 360 : 480, 16384);
  return width === null || height === null ? null : `-w ${width} -h ${height}`;
}

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
