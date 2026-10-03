import type { ComfigPreset, ComfigRelease, OfficialAddon, ProfileDetail } from "./bridge";
import { toggleAddon } from "./first-run-ui";

const ADDON_FILE = /^mastercomfig-addon-(.+)\.vpk$/i;
const BASE_VPK = "mastercomfig-base.vpk";
const CUSTOM_PREFIX = "tf/custom/comfig-custom/";

/** The preset / module-override / addon triple the Comfig pane renders. */
export type ComfigUiState = {
  preset: ComfigPreset;
  modules: Record<string, string>;
  addons: OfficialAddon[];
  supportedLoader?: boolean;
  release?: ComfigRelease | null;
};

export const PREVIEW_COMFIG_STATE: ComfigUiState = {
  preset: "medium",
  modules: { texture_quality: "high" },
  addons: ["no-tutorial"],
};

/**
 * Addon names speak for themselves; only a real side effect gets a line,
 * shared by the Comfig pane, the wizard and Viewmodels.
 */
export const OFFICIAL_ADDON_DETAILS: Partial<Record<OfficialAddon, string>> = {
  lowmem: "For PCs with little memory.",
  "null-canceling-movement": "Holding both directions moves the way you pressed last.",
  "flat-mouse": "Raw input, no acceleration.",
  "transparent-viewmodels": "Needs DirectX 9 and a HUD that supports it. Turns off anti-aliasing.",
};

/** This official addon is part of a Comfig profile, even before packages are installed. */
export function canUseTransparentViewmodels(layer: ProfileDetail["layer"] | null): boolean {
  return layer === "comfig";
}

export function defaultComfigState(): ComfigUiState {
  return {
    preset: "medium",
    modules: {},
    addons: [],
  };
}

/** Only a strictly newer stable numeric release is an update; unusual tags stay explicit. */
export function comfigUpdateAvailable(installed: string, latest: string): boolean {
  const parse = (value: string) =>
    /^v?\d+\.\d+\.\d+$/.test(value) ? value.replace(/^v/, "").split(".").map(BigInt) : null;
  const current = parse(installed);
  const candidate = parse(latest);
  if (!current || !candidate) return false;
  for (let index = 0; index < 3; index++) {
    if (candidate[index] !== current[index]) return candidate[index] > current[index];
  }
  return false;
}

export type ComfigReleaseView = {
  /** One short line on where this profile's packages stand. */
  status: string;
  checking: boolean;
  /** The one action that helps right now; orange only when there is something to get. */
  action: { label: string; primary: boolean } | null;
};

/**
 * The packages row: the profile's mastercomfig release against the latest one,
 * with an update button only when it would change something.
 */
export function comfigReleaseView({
  installed,
  packagesInstalled,
  latest,
  error,
  checking,
  checkable,
}: {
  installed: string | null;
  packagesInstalled: boolean;
  latest: string | null;
  error: string | null;
  checking: boolean;
  checkable: boolean;
}): ComfigReleaseView {
  if (!packagesInstalled) {
    return {
      status: error ?? (checking ? "Checking for the latest release…" : "Packages are missing."),
      checking,
      action: { label: "Install packages", primary: true },
    };
  }
  if (error)
    return { status: error, checking: false, action: { label: "Update packages", primary: false } };
  if (checking) return { status: "Checking for updates…", checking: true, action: null };
  if (!latest) {
    return {
      status: checkable ? "Updates not checked yet." : "Updates have not been checked.",
      checking: false,
      action: { label: "Update packages", primary: false },
    };
  }
  if (!installed) {
    return {
      status: `Latest is ${latest}. Update before adding addons.`,
      checking: false,
      action: { label: `Update to ${latest}`, primary: true },
    };
  }
  if (installed === latest) return { status: "Up to date.", checking: false, action: null };
  if (comfigUpdateAvailable(installed, latest)) {
    return {
      status: `Update available: ${latest}.`,
      checking: false,
      action: { label: `Update to ${latest}`, primary: true },
    };
  }
  return { status: `Latest release: ${latest}.`, checking: false, action: null };
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
