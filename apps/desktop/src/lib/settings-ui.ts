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
};

/**
 * The sidebar reads as three short groups instead of one nine-item list:
 * what you set up, how it looks, and everything else.
 */
export const SETTINGS_TAB_GROUPS: { label: string; tabs: readonly SettingsTab[] }[] = [
  { label: "Setup", tabs: ["comfig", "binds", "gameplay"] },
  { label: "Look", tabs: ["hud", "crosshair", "viewmodels", "sounds"] },
  { label: "More", tabs: ["mods", "files", "launch"] },
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
