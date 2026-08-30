import type { FirstRunKind, ProfileLibrary, Tf2Install } from "./bridge";
import {
  emptyLibrary,
  previewImportedLibrary,
  previewSavedLibrary,
  previewSwitchLibrary,
} from "./library-ui";
import type { SettingsTab } from "./settings-ui";

export const PREVIEW_STATES = [
  "empty",
  "one",
  "many",
  "confirmed",
  "locked",
  "library",
  "saved",
  "absorb",
  "switch",
  "import",
  "first-existing",
  "first-unused",
  "first-unused-locked",
  "create",
  "settings-comfig",
  "settings-binds",
  "settings-gameplay",
  "settings-hud",
  "settings-hud-installed",
  "settings-crosshair",
  "settings-viewmodels",
  "settings-files",
  "settings-launch",
  "settings-locked",
] as const;

export type PreviewState = (typeof PREVIEW_STATES)[number];

const ONE: Tf2Install = {
  path: "/home/user/.local/share/Steam/steamapps/common/Team Fortress 2",
};

const MANY: Tf2Install[] = [
  ONE,
  { path: "/mnt/games/SteamLibrary/steamapps/common/Team Fortress 2" },
];

const READY: PreviewState[] = [
  "confirmed",
  "locked",
  "library",
  "saved",
  "absorb",
  "switch",
  "import",
  "first-existing",
  "first-unused",
  "first-unused-locked",
  "create",
  "settings-comfig",
  "settings-binds",
  "settings-gameplay",
  "settings-hud",
  "settings-hud-installed",
  "settings-crosshair",
  "settings-viewmodels",
  "settings-files",
  "settings-launch",
  "settings-locked",
];

export function previewStateFromSearch(search: string): PreviewState | null {
  const value = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get(
    "preview",
  );
  return PREVIEW_STATES.find((state) => state === value) ?? null;
}

export function previewInstalls(state: PreviewState): Tf2Install[] {
  if (state === "many") {
    return MANY;
  }
  if (state === "one" || READY.includes(state)) {
    return [ONE];
  }
  return [];
}

export function previewConfirmed(state: PreviewState): Tf2Install | null {
  return READY.includes(state) ? ONE : null;
}

export function previewLocked(state: PreviewState): boolean {
  return state === "locked" || state === "first-unused-locked" || state === "settings-locked";
}

export function previewFirstRunKind(state: PreviewState): FirstRunKind | null {
  if (state === "first-unused" || state === "first-unused-locked") {
    return "unused";
  }
  if (
    state === "first-existing" ||
    state === "confirmed" ||
    state === "library" ||
    state === "locked"
  ) {
    return "existing";
  }
  return null;
}

export function previewFirstRunReasons(state: PreviewState): string[] {
  if (previewFirstRunKind(state) === "existing") {
    return ["Found autoexec.cfg", "Found packs in custom"];
  }
  return [];
}

export function previewLibrary(state: PreviewState): ProfileLibrary | null {
  if (state === "switch") {
    return previewSwitchLibrary(ONE.path);
  }
  if (state === "import") {
    return previewImportedLibrary(ONE.path);
  }
  if (
    state === "saved" ||
    state === "absorb" ||
    state === "create" ||
    previewSettingsTab(state) !== null
  ) {
    return previewSavedLibrary(ONE.path);
  }
  if (
    state === "library" ||
    state === "first-existing" ||
    state === "first-unused" ||
    state === "first-unused-locked"
  ) {
    return emptyLibrary(ONE.path, true);
  }
  if (state === "confirmed" || state === "locked") {
    return emptyLibrary(ONE.path, false);
  }
  return null;
}

export function previewCreating(state: PreviewState): boolean {
  return state === "create";
}

export function previewSettingsTab(state: PreviewState): SettingsTab | null {
  switch (state) {
    case "settings-comfig":
    case "settings-locked":
      return "comfig";
    case "settings-binds":
      return "binds";
    case "settings-gameplay":
      return "gameplay";
    case "settings-hud":
    case "settings-hud-installed":
      return "hud";
    case "settings-crosshair":
      return "crosshair";
    case "settings-viewmodels":
      return "viewmodels";
    case "settings-files":
      return "files";
    case "settings-launch":
      return "launch";
    default:
      return null;
  }
}
