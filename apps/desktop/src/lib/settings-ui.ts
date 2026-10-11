import type { ProfileLibrary } from "./bridge";
import { canWrite } from "./write-gate";

export const SETTINGS_TABS = [
  "hud",
  "crosshair",
  "viewmodels",
  "gameplay",
  "binds",
  "sounds",
  "mods",
  "comfig",
  "files",
  "launch",
  "inventory",
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  comfig: "Performance",
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
 * What a setup is made of, in the order the Edit page and the sidebar list it.
 * The ids name the Edit page's sections.
 */
export const SETUP_GROUPS = [
  { id: "look", label: "Look", tabs: ["hud", "crosshair", "viewmodels"] },
  { id: "feel", label: "Feel", tabs: ["gameplay", "binds"] },
  { id: "sound", label: "Sound", tabs: ["sounds"] },
  { id: "mods", label: "Mods", tabs: ["mods"] },
  { id: "performance", label: "Performance", tabs: ["comfig"] },
  { id: "advanced", label: "Advanced", tabs: ["files", "launch"] },
] as const satisfies readonly { id: string; label: string; tabs: readonly SettingsTab[] }[];

export type SetupGroupId = (typeof SETUP_GROUPS)[number]["id"];

function sidebarGroups(): { label: string; tabs: readonly SettingsTab[] }[] {
  const groups: { label: string; tabs: SettingsTab[] }[] = [];
  for (const group of SETUP_GROUPS) {
    // A heading over a single pane only repeats its name, so neighbouring
    // one-pane groups share one group without a heading.
    const last = groups.at(-1);
    if (group.tabs.length === 1 && last?.label === "") last.tabs.push(...group.tabs);
    else if (group.tabs.length === 1) groups.push({ label: "", tabs: [...group.tabs] });
    else groups.push({ label: group.label, tabs: [...group.tabs] });
  }
  return [...groups, { label: "Steam", tabs: ["inventory"] }];
}

/**
 * The sidebar: the setup's groups, then the Steam account's own Inventory,
 * which belongs to no setup. A group with no label shows no heading.
 */
export const SETTINGS_TAB_GROUPS = sidebarGroups();

/** The sidebar item and title for the Edit page of the setup in the game. */
export function editLabel(name: string | null): string {
  const trimmed = name?.trim();
  return trimmed ? `Edit ${trimmed}` : "Edit";
}

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
    // Remembering the pane is a convenience; opening on Performance is fine.
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
