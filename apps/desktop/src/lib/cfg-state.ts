import { type CfgFile, engineManagedLintOptions, lint } from "@execs/cfglint";
import type { GameplayLayer } from "./gameplay-ui";

/** Startup user settings only; Files independently reviews every cfg's safety. */
export function mapsFromFiles(files: CfgFile[], layer: GameplayLayer) {
  // mastercomfig's packaged autoexec owns launch and calls these user hooks in
  // order. Its user autoexec lives in overrides; a stray vanilla autoexec is
  // not another startup root for that layer.
  const entryPoints =
    layer === "comfig"
      ? [
          "tf/cfg/config.cfg",
          "tf/cfg/overrides/pre_init.cfg",
          "tf/cfg/overrides/setup_hook.cfg",
          "tf/cfg/overrides/autoexec.cfg",
        ]
      : ["tf/cfg/config.cfg", "tf/cfg/autoexec.cfg"];
  const result = lint(files, { ...engineManagedLintOptions(files), entryPoints });
  return {
    binds: Object.fromEntries(result.binds),
    effective: Object.fromEntries(
      [...result.effective].map(([name, entry]) => [name, entry.value]),
    ),
    complete: result.executionComplete,
  };
}

export const CFG_INCOMPLETE_MESSAGE =
  "Startup settings could not be resolved. Review cfg findings in Files before changing these settings.";

export function usesCfgState(tab: string): boolean {
  return ["binds", "gameplay", "crosshair", "sounds"].includes(tab);
}
