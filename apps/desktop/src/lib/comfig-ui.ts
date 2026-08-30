import type { ComfigPreset, OfficialAddon, ProfileDetail } from "./bridge";
import { COMFIG_PRESETS, toggleAddon } from "./first-run-ui";

const PRESET_IDS = new Set<string>(COMFIG_PRESETS.map((item) => item.id));
const MODULE_LINE = /^([a-z0-9_]+)=([a-z0-9_.-]+)$/i;
const PRESET_LINE = /^\s*preset=([a-z0-9_]+)\s*$/i;
const ADDON_FILE = /^mastercomfig-addon-(.+)\.vpk$/i;
const BASE_VPK = "mastercomfig-base.vpk";
const CUSTOM_PREFIX = "tf/custom/comfig-custom/";

export type PreviewComfigState = {
  preset: ComfigPreset;
  modules: Record<string, string>;
  addons: OfficialAddon[];
  versionLabel?: string;
};

export const PREVIEW_COMFIG_STATE: PreviewComfigState = {
  preset: "medium",
  modules: { texture_quality: "high" },
  addons: ["no-tutorial"],
  versionLabel: "mastercomfig latest",
};

export function defaultComfigState(): PreviewComfigState {
  return {
    preset: "medium",
    modules: {},
    addons: [],
  };
}

export function isComfigPreset(value: string): value is ComfigPreset {
  return PRESET_IDS.has(value);
}

export function parseSetupHook(text: string): ComfigPreset {
  let preset: ComfigPreset = "medium";
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(PRESET_LINE);
    if (!match) {
      continue;
    }
    const value = match[1].toLowerCase();
    if (isComfigPreset(value)) {
      preset = value;
    }
  }
  return preset;
}

export function serializeSetupHook(preset: ComfigPreset, existing = ""): string {
  const lines = existing.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const out: string[] = [];
  let wrote = false;
  for (const line of lines) {
    if (PRESET_LINE.test(line)) {
      if (!wrote) {
        out.push(`preset=${preset}`);
        wrote = true;
      }
      continue;
    }
    out.push(line);
  }
  if (!wrote) {
    out.unshift(`preset=${preset}`);
  }
  return `${out.join("\n")}\n`;
}

export function parseModulesCfg(text: string): Record<string, string> {
  const modules: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("#")) {
      continue;
    }
    const match = line.match(MODULE_LINE);
    if (!match) {
      continue;
    }
    modules[match[1].toLowerCase()] = match[2];
  }
  return modules;
}

export function serializeModulesCfg(modules: Record<string, string>): string {
  return Object.entries(modules)
    .filter(([name, level]) => name.trim().length > 0 && level.trim().length > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, level]) => `${name}=${level}\n`)
    .join("");
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

export function toggleComfigAddon(
  selected: OfficialAddon[],
  id: OfficialAddon,
): OfficialAddon[] {
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

export function inferComfigState(detail: ProfileDetail | null): PreviewComfigState {
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

export function resolveComfigState(
  preview: boolean,
  previewState: PreviewComfigState | undefined,
  detail: ProfileDetail | null,
): PreviewComfigState {
  if (previewState) {
    return previewState;
  }
  if (preview) {
    return defaultComfigState();
  }
  return inferComfigState(detail);
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
