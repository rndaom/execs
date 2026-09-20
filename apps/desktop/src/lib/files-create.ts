import type { CfgLayer } from "./bridge";
import { editorPathFits, utf8ByteLengthAtMost } from "./files-limits";

const RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;
const DOS_SHORT_NAME = /^[^.]{1,6}~\d+(?:\.[^.]{1,3})?$/i;
const MAX_COMPONENT_BYTES = 255;
const MAX_PATH_DEPTH = 64;
const FORBIDDEN_ROOT_FOLDERS = new Set(["user", "app", "overrides", "comfig"]);
const JUNK_COMPONENTS = new Set([
  ".ds_store",
  "thumbs.db",
  "desktop.ini",
  ".git",
  ".svn",
  ".hg",
  "node_modules",
  "__macosx",
  "sound.cache",
]);
const MANAGED = new Set([
  "config",
  "config_default",
  "execs_binds",
  "execs_gameplay",
  "execs_preload",
  "setup_hook",
  "modules",
  "mtp",
  "360controller",
  "360controller-linux",
  "undo360controller",
  "skill",
  "skill_manifest",
  "joystick",
  "replay",
  "sourcevr",
  "sourcevr_tf",
]);

export type NewCfgPathResult = { path: string; error?: never } | { path?: never; error: string };

/** A directory relative to the active profile's writable cfg layer. */
export type CfgDestination = {
  /** Stable value for controls. Empty means the cfg-layer root. */
  id: string;
  /** Short user-facing name that still makes nesting clear. */
  label: string;
  /** Complete profile-relative directory, without a trailing slash. */
  path: string;
};

export function cfgLayerRoot(layer: CfgLayer): string {
  return layer === "comfig" ? "tf/cfg/overrides" : "tf/cfg";
}

function cfgNameError(stem: string, layer: CfgLayer): string | null {
  const parts = stem.split("/");
  const finalComponent = `${parts.at(-1) ?? ""}.cfg`;
  if (
    !stem ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[\\<>:"|?*]/.test(part) ||
        [...part].some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ) ||
        /[. ]$/.test(part) ||
        part.startsWith(".") ||
        RESERVED.test(part) ||
        DOS_SHORT_NAME.test(part) ||
        utf8ByteLengthAtMost(part, MAX_COMPONENT_BYTES) === null,
    ) ||
    utf8ByteLengthAtMost(finalComponent, MAX_COMPONENT_BYTES) === null ||
    parts.length + (layer === "comfig" ? 3 : 2) > MAX_PATH_DEPTH
  ) {
    return "Use a relative cfg name with ordinary folder and filename characters.";
  }
  const lower = parts.map((part) => part.toLowerCase());
  if (
    FORBIDDEN_ROOT_FOLDERS.has(lower[0]) ||
    lower.some(
      (part) =>
        JUNK_COMPONENTS.has(part) ||
        part.endsWith(".cache") ||
        part.endsWith(".ztmp") ||
        part.endsWith(".bak") ||
        part.endsWith(".execs-part"),
    ) ||
    MANAGED.has(lower[lower.length - 1]) ||
    /^(?:chapter|sourcevr).*$/i.test(parts[parts.length - 1])
  ) {
    return "Choose a user cfg name outside managed, engine and reserved folders.";
  }
  return null;
}

/**
 * Resolve a user-entered name or relative path into the active writable cfg layer.
 * This mirrors the native new-file gate so invalid drafts fail before Save.
 */
export function newCfgPath(name: string, layer: CfgLayer): NewCfgPathResult {
  const stem = name.trim().replace(/\.cfg$/i, "");
  const error = cfgNameError(stem, layer);
  if (error) return { error };
  const path = `${cfgLayerRoot(layer)}/${stem}.cfg`;
  if (!editorPathFits(path)) return { error: "The cfg path is too long." };
  return { path };
}

/** Whether a complete profile-relative path is a valid new target in this cfg layer. */
export function isNewCfgPath(path: string, layer: CfgLayer): boolean {
  const root = cfgLayerRoot(layer);
  const prefix = `${root}/`;
  if (!path.startsWith(prefix) || !path.toLowerCase().endsWith(".cfg")) return false;
  const relative = path.slice(prefix.length, -4);
  return newCfgPath(relative, layer).path === path;
}

/** Resolve a filename inside a separately selected destination. */
export function newCfgPathIn(name: string, destination: string, layer: CfgLayer): NewCfgPathResult {
  const trimmedName = name.trim();
  if (/[\\/]/.test(trimmedName)) {
    return { error: "Use only a file name here, then choose its folder separately." };
  }
  const trimmedDestination = destination.trim();
  if (trimmedDestination && /(^|\/)\s|\s(\/|$)/.test(trimmedDestination)) {
    return { error: "Choose a folder without leading or trailing spaces." };
  }
  return newCfgPath(
    trimmedDestination ? `${trimmedDestination}/${trimmedName}` : trimmedName,
    layer,
  );
}

/** Find a portable, case-insensitive collision before creating or copying a cfg. */
export function cfgPathCollision(path: string, existingPaths: readonly string[]): string | null {
  const key = path.replaceAll("\\", "/").toLowerCase();
  return (
    existingPaths.find((candidate) => candidate.replaceAll("\\", "/").toLowerCase() === key) ?? null
  );
}

/**
 * List the active layer's root and reusable subdirectories already represented
 * by profile cfgs. Provided pack/HUD paths and the other cfg layer never leak in.
 */
export function cfgDestinations(
  existingPaths: readonly string[],
  layer: CfgLayer,
): CfgDestination[] {
  const root = cfgLayerRoot(layer);
  const rootPrefix = `${root}/`;
  const byKey = new Map<string, CfgDestination>();
  const remember = (id: string) => {
    const key = id.toLowerCase();
    if (byKey.has(key)) return;
    const probe = newCfgPath(id ? `${id}/destination-probe` : "destination-probe", layer);
    if (!probe.path) return;
    byKey.set(key, {
      id,
      label: id ? id.replaceAll("/", " / ") : layer === "comfig" ? "Overrides" : "CFG",
      path: id ? `${root}/${id}` : root,
    });
  };
  remember("");
  for (const candidate of existingPaths) {
    const normalized = candidate.replaceAll("\\", "/");
    if (!normalized.toLowerCase().startsWith(rootPrefix.toLowerCase())) continue;
    const relative = normalized.slice(rootPrefix.length);
    if (!relative.toLowerCase().endsWith(".cfg")) continue;
    const directories = relative.split("/").slice(0, -1);
    for (let depth = 1; depth <= directories.length; depth += 1) {
      remember(directories.slice(0, depth).join("/"));
    }
  }
  return [...byKey.values()].sort((left, right) => {
    if (!left.id) return -1;
    if (!right.id) return 1;
    return left.id.localeCompare(right.id, undefined, { sensitivity: "base" });
  });
}
