import type { ViewmodelRecord, ViewmodelSource } from "./bridge";

export const EXECS_VIEWMODELS_PACK = "execs-viewmodels";
export const EXECS_VIEWMODELS_VPK = `tf/custom/${EXECS_VIEWMODELS_PACK}.vpk`;
export const EXECS_PRELOAD_STEM = "execs_preload";
export const EXECS_PRELOAD_OVERRIDES_STEM = "overrides/execs_preload";
export const EXECS_PRELOAD_LAUNCH = `+exec ${EXECS_PRELOAD_STEM}`;

export const VIEWMODEL_CASUAL_COPY =
  "Animation packs need the first-party preload to apply on Valve Casual. Community and listen servers work without it. File-safe FOV and min viewmodels stay on the Gameplay pane.";

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

/** What the pane edits: preload plus the Yttrium-style hidden group ids. */
export type ViewmodelDraft = {
  preload: boolean;
  hidden: string[];
};

export function emptyViewmodelDraft(): ViewmodelDraft {
  return { preload: true, hidden: [] };
}

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
  };
}

export function toggleHiddenGroup(hidden: string[], id: string): string[] {
  return hidden.includes(id) ? hidden.filter((entry) => entry !== id) : [...hidden, id].sort();
}

export function hasPreloadLaunch(options: string): boolean {
  const tokens = options.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] === "+exec" && isPreloadStem(tokens[i + 1])) {
      return true;
    }
  }
  return false;
}

export function withPreloadLaunch(options: string, enabled: boolean): string {
  const tokens = options.split(/\s+/).filter(Boolean);
  const filtered: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] === "+exec" && isPreloadStem(tokens[i + 1])) {
      i += 1;
      continue;
    }
    filtered.push(tokens[i]);
  }
  if (enabled) {
    filtered.push("+exec", EXECS_PRELOAD_STEM);
  }
  return filtered.join(" ");
}

function isPreloadStem(value: string | undefined): boolean {
  return value === EXECS_PRELOAD_STEM || value === EXECS_PRELOAD_OVERRIDES_STEM;
}

export function previewViewmodelRecord(source: ViewmodelSource = "compiled"): ViewmodelRecord {
  return {
    id: EXECS_VIEWMODELS_PACK,
    source,
    preload: true,
    options: { hidden: "scout/melee,scout/scatterguns", schema: "yttrium-1" },
  };
}

/** First-party itemtest listen preload. Must mirror the Rust serializer in
 * core/src/viewmodel.rs. Never stores +quit. */
export function serializePreloadCfg(): string {
  return [
    "// execs preload — managed, do not edit by hand",
    // -1 loads without any pure whitelist; the point_servercommand cvar must
    // be set before the map loads or Casual resets it.
    "sv_pure -1",
    "sv_allow_point_servercommand always",
    "map itemtest",
    // wait counts frames; 10 gives heavier animation packs margin to finish caching.
    "wait 10; disconnect",
    // A beat for the disconnect to settle, then clean the console and restart
    // the menu music the map load cut off.
    "wait 1; clear",
    "playmenumusic",
    "",
  ].join("\n");
}
