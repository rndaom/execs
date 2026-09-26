import { lookupCvar, parseCommands } from "@execs/cfglint";
import {
  autoexecFilePath,
  EXECS_GAMEPLAY_STEM,
  ensureAutoexecExecLine,
  ownedCfgPath,
} from "./binds-ui";

export { autoexecFilePath, EXECS_GAMEPLAY_STEM, ensureAutoexecExecLine };

export const GAMEPLAY_STEM = EXECS_GAMEPLAY_STEM;

export const GAMEPLAY_HEADER = "// execs gameplay — managed, do not edit by hand";

export const FLIP_VIEWMODELS_NOTE = "Not while connected to a server.";

/// r_drawtracers is FCVAR_CHEAT: the engine refuses it on any server without
/// sv_cheats, logging "Can't use cheat cvar r_drawtracers in multiplayer".
export const ALL_TRACERS_NOTE = "Ignored on live servers; needs sv_cheats.";

export const FOV_MIN = 54;
export const FOV_MAX = 90;
/** TF2's viewmodel ConVar limits are independent of world FOV and menu limits. */
export const VIEWMODEL_FOV_MIN = 0.1;
export const VIEWMODEL_FOV_MAX = 179.9;
/** Neither mouse cvar has a documented range; this only rejects typos. */
export const SENSITIVITY_MAX = 1000;
/** Mouse cvars kept at full precision; only positive values are valid. */
export const MOUSE_CVARS = ["sensitivity", "zoom_sensitivity_ratio"] as const;
/** Comfort toggles that are plain 0/1 client cvars (none needs sv_cheats). */
export const COMFORT_TOGGLES = [
  "tf_medigun_autoheal",
  "hud_combattext",
  "hud_combattext_batching",
  "hud_combattext_healing",
] as const;
/**
 * Gameplay cvars TF2's own options can change in-game. They follow config.cfg
 * after a game session so the managed cfg does not put the old value back.
 */
export const GAME_SYNCED_CVARS = [
  ...MOUSE_CVARS,
  "cl_autoreload",
  "hud_fastswitch",
  ...COMFORT_TOGGLES,
] as const;
export const CROSSHAIR_SCALE_MIN = 16;
export const CROSSHAIR_SCALE_MAX = 64;
export const COLOR_MIN = 0;
export const COLOR_MAX = 255;
/** `tf_dingaling_pitch*` bounds, from the engine's ConVar declaration. */
export const PITCH_MIN = 1;
export const PITCH_MAX = 255;
export const HITSOUND_EFFECT_MAX = 8;

export const CROSSHAIR_FILES = [
  "",
  "crosshair1",
  "crosshair2",
  "crosshair3",
  "crosshair4",
  "crosshair5",
  "crosshair6",
  "crosshair7",
] as const;

export type StockCrosshairFile = (typeof CROSSHAIR_FILES)[number];
/** TF2 also accepts material names supplied by HUDs and other custom packs. */
export type CrosshairFile = string;

export type GameplayLayer = "comfig" | "vanilla";

export type GameplayToggle = 0 | 1;

export type GameplaySettings = {
  fov_desired: number;
  viewmodel_fov: number;
  tf_use_min_viewmodels: GameplayToggle;
  r_drawviewmodel: GameplayToggle;
  r_drawtracers_firstperson: GameplayToggle;
  r_drawtracers: GameplayToggle;
  cl_flipviewmodels: GameplayToggle;
  cl_autoreload: GameplayToggle;
  /** Preserve controller/custom modes until the player explicitly changes this control. */
  hud_fastswitch: number;
  /** Kept at full precision; never rounded through a slider. */
  sensitivity: number;
  zoom_sensitivity_ratio: number;
  /** Medigun primary fire toggles healing instead of being held. */
  tf_medigun_autoheal: GameplayToggle;
  /** Damage numbers over targets you hit. */
  hud_combattext: GameplayToggle;
  /** Merge damage numbers that land close together. */
  hud_combattext_batching: GameplayToggle;
  /** Health restored per second over heal targets. */
  hud_combattext_healing: GameplayToggle;
  cl_crosshair_file: CrosshairFile;
  cl_crosshair_scale: number;
  cl_crosshair_red: number;
  cl_crosshair_green: number;
  cl_crosshair_blue: number;
  /** Hit sound: on/off, 0–1 volume, damage-pitch range, built-in effect 0–8. */
  tf_dingalingaling: GameplayToggle;
  tf_dingaling_volume: number;
  tf_dingaling_pitchmindmg: number;
  tf_dingaling_pitchmaxdmg: number;
  tf_dingalingaling_effect: number;
  /** Seconds between hit sounds; 0 = every damage instance. */
  tf_dingalingaling_repeat_delay: number;
  /** Kill sound: same shape. */
  tf_dingalingaling_lasthit: GameplayToggle;
  tf_dingaling_lasthit_volume: number;
  tf_dingaling_lasthit_pitchmindmg: number;
  tf_dingaling_lasthit_pitchmaxdmg: number;
  tf_dingalingaling_last_effect: number;
};

const CROSSHAIR_FILE_SET = new Set<string>(CROSSHAIR_FILES);

export function isStockCrosshairFile(file: string): file is StockCrosshairFile {
  return CROSSHAIR_FILE_SET.has(file);
}

function corpusNumber(name: string, fallback: number): number {
  const raw = lookupCvar(name)?.d;
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

function corpusFloat(name: string, fallback: number): number {
  const raw = lookupCvar(name)?.d;
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function corpusToggle(name: string, fallback: GameplayToggle): GameplayToggle {
  const raw = lookupCvar(name)?.d;
  if (raw === undefined) {
    return fallback;
  }
  return parseToggle(raw, fallback);
}

export function defaultGameplay(): GameplaySettings {
  return {
    fov_desired: 90,
    viewmodel_fov: corpusNumber("viewmodel_fov", 54),
    tf_use_min_viewmodels: corpusToggle("tf_use_min_viewmodels", 0),
    r_drawviewmodel: corpusToggle("r_drawviewmodel", 1),
    r_drawtracers_firstperson: corpusToggle("r_drawtracers_firstperson", 1),
    r_drawtracers: corpusToggle("r_drawtracers", 1),
    cl_flipviewmodels: corpusToggle("cl_flipviewmodels", 0),
    cl_autoreload: corpusToggle("cl_autoreload", 1),
    hud_fastswitch: corpusNumber("hud_fastswitch", 0),
    sensitivity: corpusFloat("sensitivity", 3),
    zoom_sensitivity_ratio: corpusFloat("zoom_sensitivity_ratio", 1),
    tf_medigun_autoheal: corpusToggle("tf_medigun_autoheal", 0),
    hud_combattext: corpusToggle("hud_combattext", 1),
    hud_combattext_batching: corpusToggle("hud_combattext_batching", 0),
    hud_combattext_healing: corpusToggle("hud_combattext_healing", 1),
    cl_crosshair_file: "",
    cl_crosshair_scale: corpusNumber("cl_crosshair_scale", 32),
    cl_crosshair_red: corpusNumber("cl_crosshair_red", 200),
    cl_crosshair_green: corpusNumber("cl_crosshair_green", 200),
    cl_crosshair_blue: corpusNumber("cl_crosshair_blue", 200),
    tf_dingalingaling: corpusToggle("tf_dingalingaling", 0),
    // The engine's ConVar default (tf_hud_account.cpp); the corpus dump
    // records the archived value of whoever generated it.
    tf_dingaling_volume: 0.75,
    tf_dingaling_pitchmindmg: corpusNumber("tf_dingaling_pitchmindmg", 100),
    tf_dingaling_pitchmaxdmg: corpusNumber("tf_dingaling_pitchmaxdmg", 100),
    tf_dingalingaling_effect: corpusNumber("tf_dingalingaling_effect", 0),
    tf_dingalingaling_repeat_delay: corpusFloat("tf_dingalingaling_repeat_delay", 0),
    tf_dingalingaling_lasthit: corpusToggle("tf_dingalingaling_lasthit", 0),
    tf_dingaling_lasthit_volume: 0.75,
    tf_dingaling_lasthit_pitchmindmg: corpusNumber("tf_dingaling_lasthit_pitchmindmg", 100),
    tf_dingaling_lasthit_pitchmaxdmg: corpusNumber("tf_dingaling_lasthit_pitchmaxdmg", 100),
    tf_dingalingaling_last_effect: corpusNumber("tf_dingalingaling_last_effect", 0),
  };
}

/** Clamp a float to a range at two decimals (cvar files stay readable). */
export function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.round(Math.min(max, Math.max(min, value)) * 100) / 100;
}

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function clampGameplay(settings: GameplaySettings): GameplaySettings {
  return {
    fov_desired: clampInt(settings.fov_desired, FOV_MIN, FOV_MAX),
    viewmodel_fov: Number.isFinite(settings.viewmodel_fov)
      ? Math.min(VIEWMODEL_FOV_MAX, Math.max(VIEWMODEL_FOV_MIN, settings.viewmodel_fov))
      : VIEWMODEL_FOV_MIN,
    tf_use_min_viewmodels: settings.tf_use_min_viewmodels ? 1 : 0,
    r_drawviewmodel: settings.r_drawviewmodel ? 1 : 0,
    r_drawtracers_firstperson: settings.r_drawtracers_firstperson ? 1 : 0,
    r_drawtracers: settings.r_drawtracers ? 1 : 0,
    cl_flipviewmodels: settings.cl_flipviewmodels ? 1 : 0,
    cl_autoreload: settings.cl_autoreload ? 1 : 0,
    hud_fastswitch: Number.isFinite(settings.hud_fastswitch) ? settings.hud_fastswitch : 0,
    sensitivity: positiveOr(settings.sensitivity, 3),
    zoom_sensitivity_ratio: positiveOr(settings.zoom_sensitivity_ratio, 1),
    tf_medigun_autoheal: settings.tf_medigun_autoheal ? 1 : 0,
    hud_combattext: settings.hud_combattext ? 1 : 0,
    hud_combattext_batching: settings.hud_combattext_batching ? 1 : 0,
    hud_combattext_healing: settings.hud_combattext_healing ? 1 : 0,
    cl_crosshair_file: parseCrosshairFile(settings.cl_crosshair_file),
    cl_crosshair_scale: clampInt(
      settings.cl_crosshair_scale,
      CROSSHAIR_SCALE_MIN,
      CROSSHAIR_SCALE_MAX,
    ),
    cl_crosshair_red: clampInt(settings.cl_crosshair_red, COLOR_MIN, COLOR_MAX),
    cl_crosshair_green: clampInt(settings.cl_crosshair_green, COLOR_MIN, COLOR_MAX),
    cl_crosshair_blue: clampInt(settings.cl_crosshair_blue, COLOR_MIN, COLOR_MAX),
    tf_dingalingaling: settings.tf_dingalingaling ? 1 : 0,
    tf_dingaling_volume: clampFloat(settings.tf_dingaling_volume, 0, 1),
    tf_dingaling_pitchmindmg: clampInt(settings.tf_dingaling_pitchmindmg, PITCH_MIN, PITCH_MAX),
    tf_dingaling_pitchmaxdmg: clampInt(settings.tf_dingaling_pitchmaxdmg, PITCH_MIN, PITCH_MAX),
    tf_dingalingaling_effect: clampInt(settings.tf_dingalingaling_effect, 0, HITSOUND_EFFECT_MAX),
    tf_dingalingaling_repeat_delay: clampFloat(settings.tf_dingalingaling_repeat_delay, 0, 10),
    tf_dingalingaling_lasthit: settings.tf_dingalingaling_lasthit ? 1 : 0,
    tf_dingaling_lasthit_volume: clampFloat(settings.tf_dingaling_lasthit_volume, 0, 1),
    tf_dingaling_lasthit_pitchmindmg: clampInt(
      settings.tf_dingaling_lasthit_pitchmindmg,
      PITCH_MIN,
      PITCH_MAX,
    ),
    tf_dingaling_lasthit_pitchmaxdmg: clampInt(
      settings.tf_dingaling_lasthit_pitchmaxdmg,
      PITCH_MIN,
      PITCH_MAX,
    ),
    tf_dingalingaling_last_effect: clampInt(
      settings.tf_dingalingaling_last_effect,
      0,
      HITSOUND_EFFECT_MAX,
    ),
  };
}

export function gameplayPath(layer: GameplayLayer): string {
  return ownedCfgPath(layer, `${EXECS_GAMEPLAY_STEM}.cfg`);
}

export function parseCvarMap(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const command of parseCommands(text, "execs_gameplay.cfg")) {
    if (command.args.length === 0) {
      continue;
    }
    values[command.name] = command.args[0];
  }
  return values;
}

function gameplayFromEffective(effective: Record<string, string>): GameplaySettings {
  return applyCvars(defaultGameplay(), effective);
}

/** Managed file wins for keys it actually sets; effective fills the rest. */
export function seedGameplay(
  managedText: string,
  effective: Record<string, string>,
): GameplaySettings {
  return applyCvars(gameplayFromEffective(effective), parseCvarMap(managedText));
}

export function serializeGameplay(settings: GameplaySettings): string {
  const next = clampGameplay(settings);
  const file =
    next.cl_crosshair_file === ""
      ? '""'
      : /^[a-zA-Z0-9_./-]+$/.test(next.cl_crosshair_file)
        ? next.cl_crosshair_file
        : JSON.stringify(next.cl_crosshair_file);
  return [
    GAMEPLAY_HEADER,
    `fov_desired ${next.fov_desired}`,
    `viewmodel_fov ${next.viewmodel_fov}`,
    `tf_use_min_viewmodels ${next.tf_use_min_viewmodels}`,
    `r_drawviewmodel ${next.r_drawviewmodel}`,
    `r_drawtracers_firstperson ${next.r_drawtracers_firstperson}`,
    `r_drawtracers ${next.r_drawtracers}`,
    `cl_flipviewmodels ${next.cl_flipviewmodels}`,
    `cl_autoreload ${next.cl_autoreload}`,
    `hud_fastswitch ${next.hud_fastswitch}`,
    `sensitivity ${formatCvarNumber(next.sensitivity)}`,
    `zoom_sensitivity_ratio ${formatCvarNumber(next.zoom_sensitivity_ratio)}`,
    `tf_medigun_autoheal ${next.tf_medigun_autoheal}`,
    `hud_combattext ${next.hud_combattext}`,
    `hud_combattext_batching ${next.hud_combattext_batching}`,
    `hud_combattext_healing ${next.hud_combattext_healing}`,
    `cl_crosshair_file ${file}`,
    `cl_crosshair_scale ${next.cl_crosshair_scale}`,
    `cl_crosshair_red ${next.cl_crosshair_red}`,
    `cl_crosshair_green ${next.cl_crosshair_green}`,
    `cl_crosshair_blue ${next.cl_crosshair_blue}`,
    `tf_dingalingaling ${next.tf_dingalingaling}`,
    `tf_dingaling_volume ${next.tf_dingaling_volume}`,
    `tf_dingaling_pitchmindmg ${next.tf_dingaling_pitchmindmg}`,
    `tf_dingaling_pitchmaxdmg ${next.tf_dingaling_pitchmaxdmg}`,
    `tf_dingalingaling_effect ${next.tf_dingalingaling_effect}`,
    `tf_dingalingaling_repeat_delay ${next.tf_dingalingaling_repeat_delay}`,
    `tf_dingalingaling_lasthit ${next.tf_dingalingaling_lasthit}`,
    `tf_dingaling_lasthit_volume ${next.tf_dingaling_lasthit_volume}`,
    `tf_dingaling_lasthit_pitchmindmg ${next.tf_dingaling_lasthit_pitchmindmg}`,
    `tf_dingaling_lasthit_pitchmaxdmg ${next.tf_dingaling_lasthit_pitchmaxdmg}`,
    `tf_dingalingaling_last_effect ${next.tf_dingalingaling_last_effect}`,
    "",
  ].join("\n");
}

export function gameplayDirty(draft: GameplaySettings, saved: GameplaySettings): boolean {
  return serializeGameplay(draft) !== serializeGameplay(saved);
}

/** Everything the Gameplay pane owns in the shared managed cfg. */
export const GAMEPLAY_SCOPE_CVARS: ReadonlySet<string> = new Set([
  "fov_desired",
  "viewmodel_fov",
  "tf_use_min_viewmodels",
  "r_drawviewmodel",
  "r_drawtracers_firstperson",
  "r_drawtracers",
  "cl_flipviewmodels",
  ...GAME_SYNCED_CVARS,
]);

/** Sibling panes share a cfg file, but acknowledge only their own controls. */
export function serializeGameplayScope(
  settings: GameplaySettings,
  scope: "gameplay" | "crosshair" | "sounds",
): string {
  return JSON.stringify(
    Object.entries(clampGameplay(settings)).filter(([name]) => {
      if (scope === "crosshair") {
        return name.startsWith("cl_crosshair_");
      }
      if (scope === "sounds") {
        return name.startsWith("tf_dingaling");
      }
      return GAMEPLAY_SCOPE_CVARS.has(name);
    }),
  );
}

function applyCvars(base: GameplaySettings, values: Record<string, string>): GameplaySettings {
  const next = { ...base };
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    normalized[name.toLowerCase()] = value;
  }
  const read = (name: string) => normalized[name];

  const fov = read("fov_desired");
  if (fov !== undefined) {
    next.fov_desired = parseIntish(fov, next.fov_desired);
  }
  const viewmodel = read("viewmodel_fov");
  if (viewmodel !== undefined) {
    const value = Number(String(viewmodel).trim());
    if (Number.isFinite(value)) next.viewmodel_fov = value;
  }
  const minView = read("tf_use_min_viewmodels");
  if (minView !== undefined) {
    next.tf_use_min_viewmodels = parseToggle(minView, next.tf_use_min_viewmodels);
  }
  const drawView = read("r_drawviewmodel");
  if (drawView !== undefined) {
    next.r_drawviewmodel = parseToggle(drawView, next.r_drawviewmodel);
  }
  const tracersFp = read("r_drawtracers_firstperson");
  if (tracersFp !== undefined) {
    next.r_drawtracers_firstperson = parseToggle(tracersFp, next.r_drawtracers_firstperson);
  }
  const tracers = read("r_drawtracers");
  if (tracers !== undefined) {
    next.r_drawtracers = parseToggle(tracers, next.r_drawtracers);
  }
  const flip = read("cl_flipviewmodels");
  if (flip !== undefined) {
    next.cl_flipviewmodels = parseToggle(flip, next.cl_flipviewmodels);
  }
  const autoreload = read("cl_autoreload");
  if (autoreload !== undefined) {
    next.cl_autoreload = parseToggle(autoreload, next.cl_autoreload);
  }
  const fastswitch = read("hud_fastswitch");
  if (fastswitch !== undefined) {
    const value = Number(fastswitch.trim());
    if (Number.isFinite(value)) next.hud_fastswitch = value;
  }
  for (const name of MOUSE_CVARS) {
    const raw = read(name);
    if (raw !== undefined) {
      const value = Number(String(raw).trim());
      if (Number.isFinite(value) && value > 0) next[name] = value;
    }
  }
  for (const name of COMFORT_TOGGLES) {
    const raw = read(name);
    if (raw !== undefined) {
      next[name] = parseToggle(raw, next[name]);
    }
  }
  const file = read("cl_crosshair_file");
  if (file !== undefined) {
    next.cl_crosshair_file = parseCrosshairFile(file);
  }
  const scale = read("cl_crosshair_scale");
  if (scale !== undefined) {
    next.cl_crosshair_scale = parseIntish(scale, next.cl_crosshair_scale);
  }
  const red = read("cl_crosshair_red");
  if (red !== undefined) {
    next.cl_crosshair_red = parseIntish(red, next.cl_crosshair_red);
  }
  const green = read("cl_crosshair_green");
  if (green !== undefined) {
    next.cl_crosshair_green = parseIntish(green, next.cl_crosshair_green);
  }
  const blue = read("cl_crosshair_blue");
  if (blue !== undefined) {
    next.cl_crosshair_blue = parseIntish(blue, next.cl_crosshair_blue);
  }
  const toggles: Array<"tf_dingalingaling" | "tf_dingalingaling_lasthit"> = [
    "tf_dingalingaling",
    "tf_dingalingaling_lasthit",
  ];
  for (const name of toggles) {
    const raw = read(name);
    if (raw !== undefined) {
      next[name] = parseToggle(raw, next[name]);
    }
  }
  const ints: Array<
    | "tf_dingaling_pitchmindmg"
    | "tf_dingaling_pitchmaxdmg"
    | "tf_dingalingaling_effect"
    | "tf_dingaling_lasthit_pitchmindmg"
    | "tf_dingaling_lasthit_pitchmaxdmg"
    | "tf_dingalingaling_last_effect"
  > = [
    "tf_dingaling_pitchmindmg",
    "tf_dingaling_pitchmaxdmg",
    "tf_dingalingaling_effect",
    "tf_dingaling_lasthit_pitchmindmg",
    "tf_dingaling_lasthit_pitchmaxdmg",
    "tf_dingalingaling_last_effect",
  ];
  for (const name of ints) {
    const raw = read(name);
    if (raw !== undefined) {
      next[name] = parseIntish(raw, next[name]);
    }
  }
  const floats: Array<
    "tf_dingaling_volume" | "tf_dingaling_lasthit_volume" | "tf_dingalingaling_repeat_delay"
  > = ["tf_dingaling_volume", "tf_dingaling_lasthit_volume", "tf_dingalingaling_repeat_delay"];
  for (const name of floats) {
    const raw = read(name);
    if (raw !== undefined) {
      const value = Number(String(raw).trim());
      next[name] = Number.isFinite(value) ? value : next[name];
    }
  }
  return clampGameplay(next);
}

function positiveOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Plain decimal text for a cfg: 2.35 stays "2.35", never "2.35e+0" or rounded. */
export function formatCvarNumber(value: number): string {
  const text = String(value);
  if (!/e/i.test(text)) return text;
  return value.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * What a typed sensitivity means, or why it cannot be saved. Accepts plain
 * decimals only, so "2.35" keeps exactly the digits the player typed.
 */
export function parseSensitivityInput(
  raw: string,
): { value: number; problem: null } | { value: null; problem: string } {
  const text = raw.trim();
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(text)) {
    return { value: null, problem: "Enter a number, like 2.5." };
  }
  const value = Number(text);
  if (!(value > 0)) return { value: null, problem: "Use a number above 0." };
  if (value > SENSITIVITY_MAX) {
    return { value: null, problem: `Use ${SENSITIVITY_MAX} or less.` };
  }
  return { value, problem: null };
}

/** A config.cfg value TF2's options could have written, or null when it is not one. */
function gameOptionValue(name: (typeof GAME_SYNCED_CVARS)[number], raw: string): number | null {
  const text = raw.trim();
  if (text === "") return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  if ((MOUSE_CVARS as readonly string[]).includes(name)) return value > 0 ? value : null;
  if (name === "hud_fastswitch") return Number.isInteger(value) ? value : null;
  return value === 0 || value === 1 ? value : null;
}

/**
 * After a game session, TF2's own options may have changed Gameplay cvars in
 * config.cfg (mouse sensitivity, auto reload, damage numbers and so on). The
 * managed Gameplay cfg runs later and would put the old values back, so its
 * matching lines follow config.cfg. Only lines the managed file already sets
 * change; every other byte stays.
 */
export function syncGameOptionsFromConfig(managedText: string, configText: string): string {
  const config: Record<string, string> = {};
  for (const [name, value] of Object.entries(parseCvarMap(configText))) {
    config[name.toLowerCase()] = value;
  }
  let next = managedText;
  for (const name of GAME_SYNCED_CVARS) {
    const raw = config[name];
    const value = raw === undefined ? null : gameOptionValue(name, String(raw));
    if (value === null) continue;
    const line = new RegExp(`^([ \\t]*)${name}[ \\t]+[^\\r\\n]*$`, "gim");
    next = next.replace(line, (whole, indent: string) => {
      const current = Number(whole.trim().split(/\s+/)[1]?.replace(/"/g, ""));
      return current === value ? whole : `${indent}${name} ${formatCvarNumber(value)}`;
    });
  }
  return next;
}

function parseIntish(raw: string, fallback: number): number {
  const value = Number(String(raw).trim());
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

function parseToggle(raw: string, fallback: GameplayToggle): GameplayToggle {
  const value = String(raw).trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes" || value === "on") {
    return 1;
  }
  if (value === "0" || value === "false" || value === "no" || value === "off") {
    return 0;
  }
  const numeric = Number(value);
  if (numeric === 1) {
    return 1;
  }
  if (numeric === 0) {
    return 0;
  }
  return fallback;
}

function parseCrosshairFile(raw: string): CrosshairFile {
  const value = String(raw);
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\.vtf$/i, "");
  if (normalized === "" || normalized === "0" || normalized === "default") {
    return "";
  }
  if (isStockCrosshairFile(normalized)) {
    return normalized;
  }
  return value;
}
