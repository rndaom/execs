import type { ProfileDetail } from "./bridge";
import { comfigPresetLabel } from "./comfig-catalog";
import type { ComfigUiState } from "./comfig-ui";
import type { SettingsTab } from "./settings-ui";

/** One line of the Overview: an area of the setup, what it holds now, and where to change it. */
export type OverviewRow = {
  tab: SettingsTab;
  label: string;
  value: string;
};

export type OverviewInput = {
  detail: ProfileDetail | null;
  comfig: ComfigUiState;
  /** Startup settings; empty when they could not be read. */
  effective: Record<string, string>;
  binds: Record<string, string>;
  /** Whether the startup settings above are complete. */
  settingsComplete: boolean;
  launchOptions: string;
};

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function shapeLabel(shape: string) {
  const words = shape.replace(/^execs-/, "").replaceAll("-", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function number(value: string | undefined) {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function graphics({ comfig, detail }: OverviewInput) {
  if (detail?.layer !== "comfig") return "TF2's own graphics settings";
  const parts = [`${comfigPresetLabel(comfig.preset)} preset`];
  const modules = Object.keys(comfig.modules).length;
  if (modules > 0) parts.push(plural(modules, "module change"));
  if (comfig.addons.length > 0) parts.push(plural(comfig.addons.length, "addon"));
  return parts.join(" · ");
}

function hud({ detail }: OverviewInput) {
  return detail?.hud ? detail.hud.id : "TF2 default";
}

function crosshair({ detail, effective }: OverviewInput) {
  const record = detail?.crosshair;
  if (record && !record.inactive) {
    const overrides = Object.keys(record.assignments ?? {}).length;
    const parts = [`Custom ${shapeLabel(record.shape).toLowerCase()}`];
    if (overrides > 0) parts.push(plural(overrides, "weapon override"));
    return parts.join(" · ");
  }
  const file = effective.cl_crosshair_file?.replaceAll('"', "").trim();
  return file ? `In-game · ${file}` : "In-game";
}

function viewmodels({ detail, effective }: OverviewInput) {
  const parts: string[] = [];
  const fov = number(effective.viewmodel_fov);
  if (fov !== null) parts.push(`FOV ${fov}°`);
  const record = detail?.viewmodel;
  if (record?.source === "stockBuilt") {
    const changed = record.buildRecipe?.choices.length ?? 0;
    parts.push(changed > 0 ? plural(changed, "weapon hidden", "weapons hidden") : "Built pack");
  } else if (record) {
    parts.push("Imported pack");
  }
  return parts.length > 0 ? parts.join(" · ") : "TF2 default";
}

function sounds({ detail }: OverviewInput) {
  const hit = detail?.hitsound?.hit?.name ?? "default";
  const kill = detail?.hitsound?.kill?.name ?? "default";
  if (hit === "default" && kill === "default") return "TF2 default";
  return `Hit: ${hit} · Kill: ${kill}`;
}

function gameplay({ effective }: OverviewInput) {
  const parts: string[] = [];
  const fov = number(effective.fov_desired);
  if (fov !== null) parts.push(`FOV ${fov}°`);
  const sensitivity = number(effective.sensitivity);
  if (sensitivity !== null) parts.push(`Sensitivity ${sensitivity}`);
  return parts.length > 0 ? parts.join(" · ") : "TF2 default";
}

function binds({ binds }: OverviewInput) {
  const count = Object.keys(binds).length;
  return count > 0 ? plural(count, "key bound", "keys bound") : "No keys bound";
}

function mods({ detail }: OverviewInput) {
  const count = detail?.mods?.length ?? 0;
  return count > 0 ? plural(count, "custom pack") : "None";
}

function launch({ launchOptions }: OverviewInput) {
  const count = launchOptions
    .trim()
    .split(/\s+/)
    .filter((token) => /^[-+]/.test(token)).length;
  return count > 0 ? plural(count, "launch option") : "None";
}

/**
 * The Overview reads the same records and startup settings the panes use and
 * only summarises them; it never becomes a second place to change anything.
 * Values that depend on startup cfgs are omitted while those cannot be read.
 */
export function overviewRows(input: OverviewInput): OverviewRow[] {
  const settings = input.settingsComplete ? input : { ...input, effective: {}, binds: {} };
  const unread = "Needs review";
  return [
    { tab: "comfig", label: "Graphics", value: graphics(settings) },
    { tab: "hud", label: "HUD", value: hud(settings) },
    {
      tab: "crosshair",
      label: "Crosshair",
      value: input.settingsComplete || input.detail?.crosshair ? crosshair(settings) : unread,
    },
    {
      tab: "viewmodels",
      label: "Viewmodels",
      value: input.settingsComplete ? viewmodels(settings) : unread,
    },
    { tab: "sounds", label: "Sounds", value: sounds(settings) },
    {
      tab: "gameplay",
      label: "Gameplay",
      value: input.settingsComplete ? gameplay(settings) : unread,
    },
    { tab: "binds", label: "Binds", value: input.settingsComplete ? binds(settings) : unread },
    { tab: "mods", label: "Mods", value: mods(settings) },
    { tab: "launch", label: "Launch", value: launch(settings) },
  ];
}
