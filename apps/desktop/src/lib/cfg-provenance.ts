import { type CfgFile, classifyCfgOrigin, normalizeCfgPath, parseCommands } from "@execs/cfglint";
import { mapsFromFiles } from "./cfg-state";
import { isClassCfg, relevantCvars } from "./conditional-cfg-sources";
import type { GameplayLayer } from "./gameplay-ui";

type SourceLocation = { file: string; line: number };

export type CfgValueOrigin = "managed" | "config" | "user" | "hud" | "pack" | "comfig";

export type CfgValueSource = {
  cvar: string;
  value: string;
  path: string;
  line: number;
  origin: CfgValueOrigin;
  /** Class cfgs that set this cvar again when that class is chosen. */
  classes: { name: string; path: string; line: number }[];
};

export type CfgOverride = { cvar: string; path: string; line: number };

export type CfgProvenance = {
  /** Startup values, in the pane's cvar order, with the line that set them last. */
  sources: CfgValueSource[];
  /** Pane cvars no startup cfg sets; TF2's defaults apply. */
  unset: string[];
  /**
   * Pane cvars a later startup line sets again after the execs file, so a saved
   * change here cannot reach the game until that line changes.
   */
  overrides: CfgOverride[];
};

export const CFG_ORIGIN_LABELS: Record<CfgValueOrigin, string> = {
  managed: "Saved by execs",
  config: "TF2 config.cfg",
  user: "Your cfg",
  hud: "HUD",
  pack: "Custom pack",
  comfig: "comfig import",
};

const CLASS_NAMES: Record<string, string> = {
  scout: "Scout",
  soldier: "Soldier",
  pyro: "Pyro",
  demoman: "Demoman",
  heavy: "Heavy",
  heavyweapons: "Heavy",
  engineer: "Engineer",
  medic: "Medic",
  sniper: "Sniper",
  spy: "Spy",
};

// Any bytes work: the probe compares where each value came from, never the value.
const PROBE_VALUE = "execs-probe";

function originOf(path: string, managedPath: string, hudId: string | null): CfgValueOrigin {
  if (normalizeCfgPath(path) === normalizeCfgPath(managedPath)) return "managed";
  switch (classifyCfgOrigin(path, hudId)) {
    case "engine":
      return "config";
    case "hud":
      return "hud";
    case "pack":
      return "pack";
    case "comfigImport":
      return "comfig";
    default:
      return "user";
  }
}

function className(path: string): string {
  const stem =
    normalizeCfgPath(path)
      .split("/")
      .pop()
      ?.replace(/\.cfg$/, "") ?? "";
  return CLASS_NAMES[stem] ?? stem;
}

/**
 * Re-run the startup resolver with the execs file setting every pane cvar. A
 * cvar whose final source is then another file is set again after the execs
 * file runs. When the execs file is not executed at all, nothing is claimed.
 */
function laterOverrides(
  files: CfgFile[],
  layer: GameplayLayer,
  managedPath: string,
  cvars: readonly string[],
  inventory: readonly { path: string }[] | undefined,
  hudProjection: { hudRoots?: readonly string[]; selectedHudRoot?: string | null } | undefined,
): CfgOverride[] {
  const managed = normalizeCfgPath(managedPath);
  const existing = files.find((file) => normalizeCfgPath(file.path) === managed);
  if (!existing) return [];
  const probeText = `${existing.text}\n${cvars.map((cvar) => `${cvar} ${PROBE_VALUE}`).join("\n")}\n`;
  const probed = files.map((file) => (file === existing ? { ...file, text: probeText } : file));
  const result = mapsFromFiles(probed, layer, inventory ?? probed, hudProjection);
  if (!result.complete) return [];
  const sources = result.effectiveSources as Record<string, SourceLocation>;
  if (!cvars.some((cvar) => sources[cvar] && normalizeCfgPath(sources[cvar].file) === managed)) {
    return [];
  }
  return cvars.flatMap((cvar) => {
    const source = sources[cvar];
    if (!source || normalizeCfgPath(source.file) === managed) return [];
    return [{ cvar, path: source.file, line: source.line }];
  });
}

/**
 * Explain where the startup value behind each control of a settings pane comes
 * from. Every claim comes from the bounded startup resolver or a direct class
 * cfg read; nothing here simulates in-game class switching.
 */
export function cfgProvenance({
  files,
  layer,
  tab,
  managedPath,
  effective,
  effectiveSources,
  complete,
  inventory,
  hudProjection,
  hudId = null,
}: {
  files: CfgFile[];
  layer: GameplayLayer;
  tab: string;
  managedPath: string;
  effective: Record<string, string>;
  effectiveSources: Record<string, SourceLocation>;
  complete: boolean;
  inventory?: readonly { path: string }[];
  hudProjection?: { hudRoots?: readonly string[]; selectedHudRoot?: string | null };
  hudId?: string | null;
}): CfgProvenance {
  const relevant = relevantCvars(tab);
  if (!complete || !relevant) return { sources: [], unset: [], overrides: [] };
  const cvars = [...relevant];

  const classes = new Map<string, CfgValueSource["classes"]>();
  const retained = new Set((hudProjection?.hudRoots ?? []).map((root) => root.toLowerCase()));
  const selected = hudProjection?.selectedHudRoot?.toLowerCase() ?? null;
  for (const file of files) {
    if (!isClassCfg(file.path)) continue;
    const root = /^tf\/custom\/([^/]+)\//.exec(normalizeCfgPath(file.path))?.[1];
    if (root && selected && retained.has(root) && root !== selected) continue;
    for (const command of parseCommands(file.text, file.path)) {
      if (!relevant.has(command.name) || command.args.length === 0) continue;
      const list = classes.get(command.name) ?? [];
      const name = className(file.path);
      const last = list.findIndex((entry) => entry.path === file.path);
      if (last >= 0) list.splice(last, 1);
      list.push({ name, path: file.path, line: command.line });
      classes.set(command.name, list);
    }
  }

  const sources: CfgValueSource[] = [];
  const unset: string[] = [];
  for (const cvar of cvars) {
    const source = effectiveSources[cvar];
    const value = effective[cvar];
    if (!source || value === undefined) {
      unset.push(cvar);
      continue;
    }
    sources.push({
      cvar,
      value,
      path: source.file,
      line: source.line,
      origin: originOf(source.file, managedPath, hudId),
      classes: classes.get(cvar) ?? [],
    });
  }
  return {
    sources,
    unset,
    overrides: laterOverrides(files, layer, managedPath, cvars, inventory, hudProjection),
  };
}
