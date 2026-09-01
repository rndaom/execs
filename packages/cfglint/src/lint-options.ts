// Option builders for linting a live TF2 profile (the desktop app's case),
// as opposed to reviewing a config that arrived from somewhere else.
//
// The desktop assembled these inline in two places and they had already
// drifted apart — one call site passed the engine-managed and advisory paths,
// the other passed nothing at all, which silently dropped `config.cfg`'s
// ESCAPE bind and console preference from the derived state. Building the
// option set here keeps every caller on the same rules.

import type { LintOptions } from "./types.ts";

/** Where a cfg in the profile came from. Drives lint strictness. */
export type CfgOrigin = "user" | "app" | "engine" | "hud" | "pack" | "comfigImport";

/** The one file Source itself writes as its settings snapshot. */
export const ENGINE_MANAGED_CONFIG_PATH = "tf/cfg/config.cfg";

/** Valve-shipped cfg that can leak into a profile — never user-authored. */
const ENGINE_EXTRA_NAMES = new Set([
  "mtp.cfg",
  "360controller.cfg",
  "360controller-linux.cfg",
  "undo360controller.cfg",
  "config_default.cfg",
]);

/** Files the app itself serializes (Binds/Gameplay/Comfig/Viewmodels panes). */
const APP_MANAGED_NAMES = new Set([
  "execs_binds.cfg",
  "execs_gameplay.cfg",
  "execs_preload.cfg",
  "modules.cfg",
  "setup_hook.cfg",
]);

export function normalizeCfgPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

export function classifyCfgOrigin(path: string, hudId?: string | null): CfgOrigin {
  const norm = normalizeCfgPath(path);
  const name = norm.split("/").pop() ?? norm;
  if (norm === ENGINE_MANAGED_CONFIG_PATH || ENGINE_EXTRA_NAMES.has(name)) {
    return "engine";
  }
  if (norm.startsWith("tf/custom/comfig-custom/")) {
    return "comfigImport";
  }
  if (norm.startsWith("tf/custom/")) {
    const hud = hudId?.toLowerCase();
    if (hud && (norm.startsWith(`tf/custom/${hud}/`) || norm.startsWith(`tf/custom/-${hud}/`))) {
      return "hud";
    }
    return "pack";
  }
  if (APP_MANAGED_NAMES.has(name)) {
    return "app";
  }
  return "user";
}

/**
 * True for files the user can edit in-app: their own cfg, the ones the app
 * serializes, and `config.cfg` (which stays strict, with narrow engine
 * exemptions). Everything else is provided content.
 */
export function cfgPathIsEditable(path: string, hudId?: string | null): boolean {
  const origin = classifyCfgOrigin(path, hudId);
  return (
    origin === "user" || origin === "app" || normalizeCfgPath(path) === ENGINE_MANAGED_CONFIG_PATH
  );
}

/** Provided files: they still report findings, but never block a save. */
export function cfgPathIsAdvisory(path: string, hudId?: string | null): boolean {
  return !cfgPathIsEditable(path, hudId);
}

/**
 * The option set for linting the user's own TF2 profile.
 *
 * `trust: "self"` because these files are the player's, not a stranger's:
 * a quick-connect bind, `bind f "disconnect"`, or an `exec` of a cfg the app
 * cannot see are all legitimate here and must not refuse a save.
 */
export function engineManagedLintOptions(
  files: readonly { path: string }[],
  hudId?: string | null,
): LintOptions {
  return {
    trust: "self",
    engineManagedConfigPaths: files
      .filter((file) => normalizeCfgPath(file.path) === ENGINE_MANAGED_CONFIG_PATH)
      .map((file) => file.path),
    advisoryPaths: files
      .filter((file) => cfgPathIsAdvisory(file.path, hudId))
      .map((file) => file.path),
  };
}
