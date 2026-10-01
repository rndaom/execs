export const GAMEPLAY_CVARS = new Set([
  "fov_desired",
  "r_drawtracers_firstperson",
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
  "volume",
  "snd_musicvolume",
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
