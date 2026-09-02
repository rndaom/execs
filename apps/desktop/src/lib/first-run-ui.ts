import type { ComfigPreset, OfficialAddon, ProfileLibrary, StartFrom } from "./bridge";

export type FirstRunKind = "unused" | "existing";

export type FirstRunSurface = "ready" | "first-existing" | "first-unused" | "loading";

export type ComfigPresetId = ComfigPreset;

/**
 * "Start from": the Create-new wizard's two tiles. `current` keeps the active
 * profile's binds, audio, console preferences and tutorial "already shown"
 * flags; `fresh` is Valve's `config_default.cfg`. First run has no active
 * profile to copy, so it is always Fresh TF2.
 */
export const START_FROM_OPTIONS: {
  id: StartFrom;
  label: string;
  description: string;
}[] = [
  {
    id: "current",
    label: "Current setup",
    description: "Keeps your binds, audio and console options; no tutorial pop-ups.",
  },
  {
    id: "fresh",
    label: "Fresh TF2",
    description: "Valve defaults, as if newly installed.",
  },
];

/**
 * The choice only exists when there is an active profile whose `config.cfg` we
 * can copy: the first-run wizard shows no tiles and stays Fresh.
 */
export function showStartFromChoice(library: ProfileLibrary | null, creating: boolean): boolean {
  return creating && library !== null && library.activeProfileId !== null;
}

export function defaultStartFrom(library: ProfileLibrary | null): StartFrom {
  return library?.activeProfileId ? "current" : "fresh";
}

export const OFFICIAL_ADDONS = [
  { id: "no-footsteps", label: "No footsteps" },
  { id: "no-pyroland", label: "No Pyroland" },
  { id: "no-soundscapes", label: "No soundscapes" },
  { id: "no-tutorial", label: "No tutorial" },
  { id: "lowmem", label: "Low memory" },
  { id: "null-canceling-movement", label: "Null-canceling movement" },
  { id: "flat-mouse", label: "Flat mouse" },
  { id: "transparent-viewmodels", label: "Transparent viewmodels" },
] as const;

export type OfficialAddonId = OfficialAddon;

export function firstRunSurface(
  library: ProfileLibrary | null,
  kind: FirstRunKind | null,
): FirstRunSurface {
  if (!library || library.rootMismatch || !library.usable) {
    return "ready";
  }
  if (library.profiles.length > 0) {
    return "ready";
  }
  if (kind === "existing") {
    return "first-existing";
  }
  if (kind === "unused") {
    return "first-unused";
  }
  return "loading";
}

export function canApplyWizard(name: string, running: boolean, busy: boolean): boolean {
  return !running && !busy && name.trim().length > 0;
}

export function toggleAddon(selected: OfficialAddonId[], id: OfficialAddonId): OfficialAddonId[] {
  return selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
}

export function wizardApplyCopy(running: boolean, creating = false): string {
  if (running) {
    return "Close TF2 to apply";
  }
  return creating ? "Create" : "Apply";
}
