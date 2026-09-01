import type { ProfileLibrary } from "./bridge";

export const SETTINGS_TABS = [
  "comfig",
  "binds",
  "gameplay",
  "hud",
  "crosshair",
  "viewmodels",
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
  mods: "Mods",
  files: "Files",
  launch: "Launch",
};

export function showSettingsChrome(library: ProfileLibrary | null): boolean {
  return (
    library?.usable === true &&
    !library.rootMismatch &&
    library.profiles.length > 0 &&
    library.activeProfileId !== null
  );
}

export function canWriteSettings(running: boolean, busy: boolean): boolean {
  return !running && !busy;
}
