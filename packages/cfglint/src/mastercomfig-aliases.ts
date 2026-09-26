/**
 * Aliases mastercomfig defines before it executes the player's hooks.
 *
 * `comfig/comfig.cfg` runs `comfig/define_presets.cfg` and only then
 * `overrides/setup_hook.cfg`, where a player (or execs' Comfig pane) chooses a
 * preset with `preset=<level>`. Each selector only re-points the `preset`
 * alias that mastercomfig runs afterwards, so it changes no setting on its
 * own. Payloads are copied from the pinned source:
 * https://github.com/mastercomfig/mastercomfig/blob/c7b52734b252bb521cd22e8243bca6f81dd3ab41/config/mastercomfig/cfg/comfig/define_presets.cfg
 * (MIT, mastercomfig contributors).
 *
 * Pass these as `startupAliases` only when the mastercomfig cfg layer is the
 * one that runs; a vanilla autoexec has no such aliases in game either.
 */
export const MASTERCOMFIG_STARTUP_ALIASES: Readonly<Record<string, string>> = {
  "preset=destitute": "alias preset preset_destitute",
  "preset=low": "alias preset preset_low",
  "preset=medium": "alias preset preset_medium",
  "preset=high": "alias preset preset_high",
  "preset=ultra": "alias preset preset_ultra",
  "preset=custom": "alias preset preset_custom",
};
