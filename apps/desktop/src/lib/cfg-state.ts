import { type CfgFile, createCfgResolver, engineManagedLintOptions, lint } from "@execs/cfglint";
import type { GameplayLayer } from "./gameplay-ui";

/** Startup user settings only; Files independently reviews every cfg's safety. */
export function mapsFromFiles(
  files: CfgFile[],
  layer: GameplayLayer,
  inventory: readonly { path: string }[] = files,
) {
  const search = createCfgResolver(files.map((file) => file.path));
  // mastercomfig's packaged autoexec owns launch and calls these user hooks in
  // order. Its user autoexec lives in overrides; a stray vanilla autoexec is
  // not another startup root for that layer.
  const startupTargets =
    layer === "comfig"
      ? ["config", "overrides/pre_init", "overrides/setup_hook", "overrides/autoexec"]
      : ["config", "autoexec"];
  const entryPoints = startupTargets.map(search.startup).filter((path) => path !== null);
  const result = lint(files, { ...engineManagedLintOptions(files), entryPoints });
  const prefix = layer === "comfig" ? "overrides/" : "";
  // Native saves update only the user's autoexec and managed cfgs. If a pack
  // shadows that route, a successful disk write cannot establish the selected
  // settings. Do not rewrite provided pack files to make the save execute.
  const shadowed =
    ["autoexec", "execs_binds", "execs_gameplay"].some((stem) => {
      const target = `${prefix}${stem}`;
      const resolved = search.resolve(target);
      return resolved !== null && resolved !== `tf/cfg/${target}.cfg`;
    }) ||
    (layer === "comfig" && search.resolve("autoexec")?.startsWith("tf/custom/") === true);
  // The native switch keeps extra legacy HUDs in the library but projects
  // only its selected HUD. This manifest-only IPC does not identify which
  // roots are projected, so do not infer that selection a second time here.
  const hudRoots = new Set(
    inventory.flatMap(({ path }) => {
      const marker = /^tf\/custom\/([^/]+)\/(?:info\.vdf$|resource\/ui\/)/.exec(
        path.replaceAll("\\", "/").toLowerCase(),
      );
      return marker ? [marker[1]] : [];
    }),
  );
  const uncertainHuds =
    hudRoots.size > 1 &&
    files.some(({ path }) => {
      const cfg = /^tf\/custom\/([^/]+)\/cfg\//.exec(path.replaceAll("\\", "/").toLowerCase());
      return cfg !== null && hudRoots.has(cfg[1]);
    });
  const complete = result.executionComplete && !shadowed && !uncertainHuds;
  return {
    binds: complete ? Object.fromEntries(result.binds) : {},
    effective: complete
      ? Object.fromEntries([...result.effective].map(([name, entry]) => [name, entry.value]))
      : {},
    complete,
    reason: uncertainHuds ? CFG_HUD_PROJECTION_MESSAGE : shadowed ? CFG_SHADOWED_MESSAGE : null,
  };
}

export const CFG_INCOMPLETE_MESSAGE =
  "Startup settings could not be resolved. Review cfg findings in Files before changing these settings.";

export const CFG_SHADOWED_MESSAGE =
  "A custom pack overrides the cfg files used to save these settings. Adjust or remove that pack before changing these controls.";

export const CFG_HUD_PROJECTION_MESSAGE =
  "This profile keeps more than one HUD's cfg files. Use Save current as… to capture only the currently mounted setup before changing these controls.";

export function usesCfgState(tab: string): boolean {
  return ["binds", "gameplay", "crosshair", "sounds"].includes(tab);
}
