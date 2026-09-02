import type { ViewmodelHideMode, ViewmodelRecord, ViewmodelSource } from "./bridge";

export const EXECS_VIEWMODELS_PACK = "execs-viewmodels";

export const VIEWMODEL_CASUAL_COPY =
  "Packs need the preload on Valve Casual; community and listen servers work without it. A hidden weapon is also hidden in third person. FOV and min viewmodels live on the Gameplay pane.";

/** Upstream (and our) rule: hiding any Soldier group also hides the Original. */
export const SOLDIER_ORIGINAL_NOTE =
  "Hiding any Soldier group also hides the Original; leaving it stock glitches in game.";

export const VIEWMODEL_CLASSES = [
  "scout",
  "soldier",
  "pyro",
  "demoman",
  "heavy",
  "engineer",
  "medic",
  "sniper",
  "spy",
] as const;

export type ViewmodelClass = (typeof VIEWMODEL_CLASSES)[number];

/** What the pane edits: preload, the hidden group ids, and how much of the
 * viewmodel a hidden group removes. */
export type ViewmodelDraft = {
  preload: boolean;
  hidden: string[];
  hideMode: ViewmodelHideMode;
};

export function parseHideMode(raw: string | undefined | null): ViewmodelHideMode {
  return raw === "weapon" ? "weapon" : "full";
}

export const HIDE_MODE_LABELS: Record<ViewmodelHideMode, string> = {
  full: "Weapon and hands",
  weapon: "Weapon only, keep hands",
};

export function serializeHiddenGroups(hidden: string[]): string {
  return [...new Set(hidden)].sort().join(",");
}

export function parseHiddenGroups(raw: string | undefined | null): string[] {
  if (!raw) {
    return [];
  }
  return [
    ...new Set(
      raw
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ].sort();
}

export function seedViewmodelDraft(record: ViewmodelRecord | null | undefined): ViewmodelDraft {
  return {
    preload: record?.preload ?? true,
    // Legacy compiled-era records stored per-weapon JSON blobs under other
    // keys; only the hidden list matters now and unknown keys are ignored.
    hidden: parseHiddenGroups(record?.options?.hidden),
    // Packs built before the option existed hid everything.
    hideMode: parseHideMode(record?.options?.mode),
  };
}

export function toggleHiddenGroup(hidden: string[], id: string): string[] {
  return hidden.includes(id) ? hidden.filter((entry) => entry !== id) : [...hidden, id].sort();
}

export function previewViewmodelRecord(source: ViewmodelSource = "compiled"): ViewmodelRecord {
  return {
    id: EXECS_VIEWMODELS_PACK,
    source,
    preload: true,
    options: { hidden: "scout/melee,scout/scatterguns", mode: "full", schema: "yttrium-1" },
  };
}
