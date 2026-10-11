import type { HudCatalogEntry, ProfileDetail } from "./bridge";
import { comfigPresetLabel } from "./comfig-catalog";
import type { ComfigUiState } from "./comfig-ui";
import { crosshairLabel } from "./crosshair-labels";
import { tf2ChoiceForFile } from "./crosshair-ui";
import { formatCvarNumber, type GameplaySettings } from "./gameplay-ui";
import { SETUP_GROUPS, type SettingsTab, type SetupGroupId } from "./settings-ui";
import { hudLabel, soundLabel, TF2_OWN } from "./setups-ui";

/** One line on the Edit page: a setting, its current value, and the pane that changes it. */
export type SheetRow = {
  key: string;
  label: string;
  value: string;
  /** Quieter words after the value. */
  more?: string;
  tab: SettingsTab;
};

export type SheetGroup = { id: SetupGroupId; label: string; rows: SheetRow[] };

export type SheetInput = {
  detail: ProfileDetail;
  /** What the panes would show, or null while the startup cfgs cannot be read. */
  gameplay: GameplaySettings | null;
  /** Keys bound by the startup cfgs, or null while they cannot be read. */
  boundKeys: number | null;
  comfig: ComfigUiState;
  launchOptions: string;
  /** Config files the Files pane lists. */
  cfgFiles: number;
  /** Casual setup choices beyond the mods in `detail`. */
  casualChoices: number;
  catalog: readonly HudCatalogEntry[];
};

/** Shown where a value comes from cfgs that could not be read. */
export const UNREADABLE = "Can't read";

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function hudRow({ detail, catalog }: SheetInput): SheetRow {
  const options = Object.keys(detail.hud?.options ?? {}).length;
  return {
    key: "hud",
    label: "HUD",
    value: hudLabel(detail.hud?.id ?? null, catalog),
    more: detail.hud && options > 0 ? `${plural(options, "option")} set` : undefined,
    tab: "hud",
  };
}

function crosshairRow({ detail, gameplay }: SheetInput): SheetRow {
  const row = { key: "crosshair", label: "Crosshair", tab: "crosshair" as const };
  const pack = detail.crosshair && !detail.crosshair.inactive ? detail.crosshair : null;
  if (pack) {
    const designs: Record<string, string> = pack.design ? { designed: pack.design } : {};
    // `id` names the pack; `shape` is the crosshair every weapon gets unless assigned another.
    const picks = new Set([pack.shape, ...Object.values(pack.assignments)]);
    return {
      ...row,
      value: crosshairLabel(pack.shape, designs),
      more: picks.size > 1 ? "different per weapon" : undefined,
    };
  }
  if (!gameplay) return { ...row, value: UNREADABLE };
  const file = gameplay.cl_crosshair_file.trim();
  return {
    ...row,
    value: file === "" ? TF2_OWN : crosshairLabel(tf2ChoiceForFile(file)),
    more: `size ${gameplay.cl_crosshair_scale}`,
  };
}

function viewmodelRow({ detail, gameplay }: SheetInput): SheetRow {
  const row = { key: "viewmodels", label: "Viewmodels", tab: "viewmodels" as const };
  if (!gameplay) return { ...row, value: UNREADABLE };
  const shown =
    gameplay.r_drawviewmodel === 0
      ? "Hidden"
      : gameplay.tf_use_min_viewmodels
        ? "Minimal"
        : "Shown";
  const more = [
    gameplay.r_drawviewmodel === 0
      ? null
      : `field of view ${formatCvarNumber(gameplay.viewmodel_fov)}`,
    gameplay.cl_flipviewmodels ? "left-handed" : null,
    detail.viewmodel ? "own pack" : null,
  ].filter((part) => part !== null);
  return { ...row, value: shown, more: more.length ? more.join(" · ") : undefined };
}

function weaponsValue(gameplay: GameplaySettings): string | null {
  const on = [
    gameplay.cl_autoreload ? "Auto reload" : null,
    gameplay.hud_fastswitch === 1 ? "fast switch" : null,
    gameplay.hud_fastswitch === 2 ? "controller switch" : null,
    gameplay.tf_medigun_autoheal ? "auto heal" : null,
  ].filter((part) => part !== null);
  if (on.length === 0) return null;
  const text = on.join(", ");
  return text[0].toUpperCase() + text.slice(1);
}

function feelRows({ gameplay, boundKeys }: SheetInput): SheetRow[] {
  const keys: SheetRow = {
    key: "binds",
    label: "Keys",
    value: boundKeys === null ? UNREADABLE : `${plural(boundKeys, "key")} bound`,
    tab: "binds",
  };
  if (!gameplay) {
    return [
      { key: "fov", label: "Field of view", value: UNREADABLE, tab: "gameplay" },
      { key: "sensitivity", label: "Sensitivity", value: UNREADABLE, tab: "gameplay" },
      { key: "weapons", label: "Weapons", value: UNREADABLE, tab: "gameplay" },
      keys,
    ];
  }
  return [
    {
      key: "fov",
      label: "Field of view",
      value: `${formatCvarNumber(gameplay.fov_desired)}°`,
      tab: "gameplay",
    },
    {
      key: "sensitivity",
      label: "Sensitivity",
      value: formatCvarNumber(gameplay.sensitivity),
      more: `zoomed ${formatCvarNumber(gameplay.zoom_sensitivity_ratio)}`,
      tab: "gameplay",
    },
    {
      key: "weapons",
      label: "Weapons",
      value: weaponsValue(gameplay) ?? "No helpers",
      tab: "gameplay",
    },
    keys,
  ];
}

function soundRows({ detail, gameplay }: SheetInput): SheetRow[] {
  const sound = (on: boolean | null, name: string | undefined) => {
    if (on === false) return "Off";
    return soundLabel(name ?? null);
  };
  return [
    {
      key: "volume",
      label: "Volume",
      value: gameplay ? percent(gameplay.volume) : UNREADABLE,
      more: gameplay
        ? gameplay.snd_musicvolume === 0
          ? "music off"
          : `music ${percent(gameplay.snd_musicvolume)}`
        : undefined,
      tab: "sounds",
    },
    {
      key: "hit-sound",
      label: "Hit sound",
      value: sound(gameplay ? gameplay.tf_dingalingaling === 1 : null, detail.hitsound?.hit?.name),
      tab: "sounds",
    },
    {
      key: "kill-sound",
      label: "Kill sound",
      value: sound(
        gameplay ? gameplay.tf_dingalingaling_lasthit === 1 : null,
        detail.hitsound?.kill?.name,
      ),
      tab: "sounds",
    },
  ];
}

function modsRow({ detail, casualChoices }: SheetInput): SheetRow {
  const names = (detail.mods ?? []).map((mod) => mod.name);
  const casual = casualChoices > 0 ? plural(casualChoices, "Casual choice") : null;
  const row = { key: "mods", label: "In this setup", tab: "mods" as const };
  if (names.length === 0) return { ...row, value: casual ?? "None" };
  return { ...row, value: names.join(", "), more: casual ?? undefined };
}

function performanceRow({ detail, comfig }: SheetInput): SheetRow {
  const row = { key: "performance", label: "Config", tab: "comfig" as const };
  if (detail.layer !== "comfig") return { ...row, value: "No mastercomfig" };
  const addons = comfig.addons.length;
  return {
    ...row,
    value:
      comfig.preset === "none"
        ? "mastercomfig, no preset"
        : `mastercomfig ${comfigPresetLabel(comfig.preset)}`,
    more: addons > 0 ? plural(addons, "addon") : undefined,
  };
}

function advancedRows({ launchOptions, cfgFiles }: SheetInput): SheetRow[] {
  const options = launchOptions.trim();
  return [
    {
      key: "launch",
      label: "Launch options",
      value: options === "" ? "None" : options,
      tab: "launch",
    },
    { key: "files", label: "Config files", value: plural(cfgFiles, "file"), tab: "files" },
  ];
}

/** Every setting of the setup in the game, grouped the way the sidebar groups the panes. */
export function sheetGroups(input: SheetInput): SheetGroup[] {
  const rows: Record<SetupGroupId, SheetRow[]> = {
    look: [hudRow(input), crosshairRow(input), viewmodelRow(input)],
    feel: feelRows(input),
    sound: soundRows(input),
    mods: [modsRow(input)],
    performance: [performanceRow(input)],
    advanced: advancedRows(input),
  };
  return SETUP_GROUPS.map(({ id, label }) => ({ id, label, rows: rows[id] }));
}
