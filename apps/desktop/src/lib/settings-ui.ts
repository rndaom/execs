import type { ProfileLibrary } from "./bridge";
import { canWrite } from "./write-gate";

export const SETTINGS_TABS = [
  "comfig",
  "binds",
  "gameplay",
  "hud",
  "crosshair",
  "viewmodels",
  "sounds",
  "mods",
  "files",
  "launch",
  "inventory",
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  comfig: "Comfig",
  binds: "Binds",
  gameplay: "Gameplay",
  hud: "HUD",
  crosshair: "Crosshair",
  viewmodels: "Viewmodels",
  sounds: "Sounds",
  mods: "Mods",
  files: "Files",
  launch: "Launch",
  inventory: "Inventory",
};

/**
 * The sidebar reads as short groups instead of one long list: what you set up,
 * how it looks, everything else, and the Steam account's own Inventory. A group
 * with no label shows no heading.
 */
export const SETTINGS_TAB_GROUPS: { label: string; tabs: readonly SettingsTab[] }[] = [
  { label: "Setup", tabs: ["comfig", "binds", "gameplay"] },
  { label: "Look", tabs: ["hud", "crosshair", "viewmodels", "sounds"] },
  { label: "More", tabs: ["mods", "files", "launch"] },
  { label: "Steam", tabs: ["inventory"] },
];

export function showSettingsChrome(library: ProfileLibrary | null): boolean {
  return (
    library?.usable === true &&
    !library.rootMismatch &&
    library.profiles.length > 0 &&
    library.activeProfileId !== null
  );
}

export function canWriteSettings(running: boolean, busy: boolean): boolean {
  return canWrite(running, busy);
}

/** Why a pane's saved settings cannot be copied to other profiles right now. */
export function copySettingsBlocked(
  running: boolean,
  busy: boolean,
  dirty: boolean,
): string | null {
  if (running) return "Close TF2 to copy settings to other profiles.";
  if (dirty) return "Wait for your changes to save, then copy them.";
  if (busy) return "Wait for the current change to finish.";
  return null;
}

const LAST_PANE_KEY = "execs:last-pane";

/** The pane execs showed when it last closed; a blocked store forgets it. */
export function readLastPane(storage: Pick<Storage, "getItem"> | null): SettingsTab | null {
  try {
    const stored = storage?.getItem(LAST_PANE_KEY);
    return SETTINGS_TABS.find((tab) => tab === stored) ?? null;
  } catch {
    return null;
  }
}

export function writeLastPane(storage: Pick<Storage, "setItem"> | null, tab: SettingsTab): void {
  try {
    storage?.setItem(LAST_PANE_KEY, tab);
  } catch {
    // Remembering the pane is a convenience; opening on Comfig is fine.
  }
}

/** `window.localStorage`, or null where it is unavailable. */
export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
