import { type CfgFile, parseCommands } from "@execs/cfglint";
import { launchOptionGroups } from "./launch-ui";

export type ConditionalCfgSource =
  | { kind: "launch"; label: string }
  | { kind: "class"; label: string; path: string; line: number };

export const GAMEPLAY_CVARS = new Set([
  "fov_desired",
  "r_drawtracers_firstperson",
  "r_drawtracers",
  "cl_autoreload",
  "hud_fastswitch",
  "sensitivity",
  "zoom_sensitivity_ratio",
  "tf_medigun_autoheal",
  "hud_combattext",
  "hud_combattext_batching",
  "hud_combattext_healing",
]);

export const VIEWMODEL_CVARS = new Set([
  "viewmodel_fov",
  "r_drawviewmodel",
  "tf_use_min_viewmodels",
  "cl_flipviewmodels",
]);

export const CROSSHAIR_CVARS = new Set([
  "crosshair",
  "cl_crosshair_file",
  "cl_crosshair_scale",
  "cl_crosshair_red",
  "cl_crosshair_green",
  "cl_crosshair_blue",
]);

export const SOUNDS_CVARS = new Set([
  "tf_dingalingaling",
  "tf_dingaling_volume",
  "tf_dingaling_pitchmindmg",
  "tf_dingaling_pitchmaxdmg",
  "tf_dingalingaling_effect",
  "tf_dingalingaling_repeat_delay",
  "tf_dingalingaling_lasthit",
  "tf_dingaling_lasthit_volume",
  "tf_dingaling_lasthit_pitchmindmg",
  "tf_dingaling_lasthit_pitchmaxdmg",
  "tf_dingalingaling_last_effect",
]);

export function relevantCvars(tab: string): Set<string> | null {
  switch (tab) {
    case "gameplay":
      return GAMEPLAY_CVARS;
    case "viewmodels":
      return VIEWMODEL_CVARS;
    case "crosshair":
      return CROSSHAIR_CVARS;
    case "sounds":
      return SOUNDS_CVARS;
    default:
      return null;
  }
}

export function isClassCfg(path: string): boolean {
  return /^tf\/(?:custom\/[^/]+\/)?cfg\/(?:overrides\/)?(?:scout|soldier|pyro|demoman|heavy|heavyweapons|engineer|medic|sniper|spy)\.cfg$/i.test(
    path.replaceAll("\\", "/"),
  );
}

/**
 * This is a source index, not a simulation of the engine's later command
 * buffer or conditional class execution. Keep it read-only and bounded.
 */
export function conditionalCfgSources(
  files: CfgFile[],
  launchOptions: string,
  tab: string,
  hudProjection?: { hudRoots?: readonly string[]; selectedHudRoot?: string | null },
): ConditionalCfgSource[] {
  if (!["binds", "gameplay", "viewmodels", "crosshair", "sounds"].includes(tab)) return [];
  const sources: ConditionalCfgSource[] = [];
  const cvars = relevantCvars(tab);
  const groups = launchOptionGroups(launchOptions);
  if (groups === null) {
    if (/(?:^|\s)\+[a-z_]/i.test(launchOptions)) {
      sources.push({ kind: "launch", label: "Launch options contain commands that need review" });
    }
  } else {
    for (const group of groups) {
      const match = /^\+([a-z_][\w]*)\b/i.exec(group.text);
      if (!match) continue;
      const name = match[1].toLowerCase();
      if (name === "exec") {
        const target = /^\+exec\s+("[^"]+"|'[^']+'|\S+)/i.exec(group.text)?.[1];
        sources.push({ kind: "launch", label: target ? `+exec ${target}` : "+exec" });
      } else if (
        (tab === "binds" && ["bind", "unbind", "unbindall", "bindtoggle"].includes(name)) ||
        cvars?.has(name)
      ) {
        sources.push({ kind: "launch", label: `+${name}` });
      }
    }
  }

  const retainedHudRoots = new Set(
    (hudProjection?.hudRoots ?? []).map((root) => root.toLowerCase()),
  );
  const selectedHudRoot = hudProjection?.selectedHudRoot?.toLowerCase() ?? null;
  for (const file of files) {
    const root = /^tf\/custom\/([^/]+)\//.exec(file.path.replaceAll("\\", "/").toLowerCase())?.[1];
    if (root && selectedHudRoot && retainedHudRoots.has(root) && root !== selectedHudRoot) continue;
    const classCfg = isClassCfg(file.path);
    for (const command of parseCommands(file.text, file.path)) {
      const name = command.name;
      if (
        !classCfg &&
        name === "alias" &&
        /^class_config_(?:scout|soldier|pyro|demoman|heavyweapons|engineer|medic|sniper|spy)$/i.test(
          command.args[0] ?? "",
        )
      ) {
        sources.push({
          kind: "class",
          label: `class route ${command.args[0]}`,
          path: file.path,
          line: command.line,
        });
        continue;
      }
      if (!classCfg) continue;
      const relevant =
        name === "exec" ||
        (tab === "binds" && ["bind", "unbind", "unbindall", "bindtoggle"].includes(name)) ||
        cvars?.has(name) ||
        (["toggle", "incrementvar", "multvar"].includes(name) &&
          Boolean(command.args[0] && cvars?.has(command.args[0].toLowerCase())));
      if (relevant) {
        sources.push({
          kind: "class",
          label: name,
          path: file.path,
          line: command.line,
        });
      }
    }
  }
  const seen = new Set<string>();
  return sources.filter((source) => {
    const id = JSON.stringify(source);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
