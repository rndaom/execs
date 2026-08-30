import type { ComfigPreset, OfficialAddon, ProfileLibrary } from "./bridge";

export type FirstRunKind = "unused" | "existing";

export type FirstRunSurface = "ready" | "first-existing" | "first-unused" | "loading";

export const COMFIG_PRESETS = [
  { id: "ultra", label: "Ultra" },
  { id: "high", label: "High" },
  { id: "medium_high", label: "Medium high" },
  { id: "medium", label: "Medium" },
  { id: "medium_low", label: "Medium low" },
  { id: "low", label: "Low" },
  { id: "very_low", label: "Very low" },
  { id: "none", label: "None" },
] as const;

export type ComfigPresetId = ComfigPreset;

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

export function wizardApplyCopy(running: boolean): string {
  return running ? "Close TF2 to apply" : "Apply";
}
