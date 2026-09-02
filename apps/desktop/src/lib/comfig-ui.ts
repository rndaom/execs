import type { ComfigPreset, OfficialAddon, ProfileDetail } from "./bridge";
import { toggleAddon } from "./first-run-ui";

const ADDON_FILE = /^mastercomfig-addon-(.+)\.vpk$/i;
const BASE_VPK = "mastercomfig-base.vpk";
const CUSTOM_PREFIX = "tf/custom/comfig-custom/";

/** The preset / module-override / addon triple the Comfig pane renders. */
export type ComfigUiState = {
  preset: ComfigPreset;
  modules: Record<string, string>;
  addons: OfficialAddon[];
};

export const PREVIEW_COMFIG_STATE: ComfigUiState = {
  preset: "medium",
  modules: { texture_quality: "high" },
  addons: ["no-tutorial"],
};

/** One line per official addon, shared by the Comfig pane and the wizard. */
export const OFFICIAL_ADDON_DETAILS: Record<OfficialAddon, string> = {
  "no-footsteps": "Remove player footstep sounds.",
  "no-pyroland": "Disable Pyroland visual effects.",
  "no-soundscapes": "Remove ambient map soundscapes.",
  "no-tutorial": "Skip tutorial hints and prompts.",
  lowmem: "Reduce memory use on limited systems.",
  "null-canceling-movement": "Keep opposite movement keys responsive.",
  "flat-mouse": "Use direct, unaccelerated mouse input.",
  "transparent-viewmodels": "Make weapon viewmodels transparent.",
};

export function defaultComfigState(): ComfigUiState {
  return {
    preset: "medium",
    modules: {},
    addons: [],
  };
}

export function setModuleLevel(
  modules: Record<string, string>,
  id: string,
  level: string,
): Record<string, string> {
  const next = { ...modules };
  if (!level) {
    delete next[id];
  } else {
    next[id] = level;
  }
  return next;
}

export function toggleComfigAddon(selected: OfficialAddon[], id: OfficialAddon): OfficialAddon[] {
  return toggleAddon(selected, id);
}

export function addonsFromFilePaths(paths: string[]): OfficialAddon[] {
  const found: OfficialAddon[] = [];
  for (const path of paths) {
    const name = path.replace(/\\/g, "/").split("/").pop() ?? "";
    const match = name.match(ADDON_FILE);
    if (!match) {
      continue;
    }
    const id = match[1].toLowerCase();
    if (isOfficialAddon(id) && !found.includes(id)) {
      found.push(id);
    }
  }
  return found;
}

export function hasBaseVpk(paths: string[]): boolean {
  return paths.some((path) => {
    const name = path.replace(/\\/g, "/").split("/").pop() ?? "";
    return name.toLowerCase() === BASE_VPK;
  });
}

export function hasComfigCustom(paths: string[]): boolean {
  return paths.some((path) => path.replace(/\\/g, "/").toLowerCase().startsWith(CUSTOM_PREFIX));
}

export function inferComfigState(detail: ProfileDetail | null): ComfigUiState {
  const state = defaultComfigState();
  if (!detail) {
    return state;
  }
  const paths = detail.files.map((file) => file.path);
  return {
    ...state,
    addons: addonsFromFilePaths(paths),
  };
}

function isOfficialAddon(value: string): value is OfficialAddon {
  return (
    value === "no-footsteps" ||
    value === "no-pyroland" ||
    value === "no-soundscapes" ||
    value === "no-tutorial" ||
    value === "lowmem" ||
    value === "null-canceling-movement" ||
    value === "flat-mouse" ||
    value === "transparent-viewmodels"
  );
}
