import { lookupCvar, parseCommands } from "@execs/cfglint";
import {
  type AutoexecPatch,
  autoexecExecPatch,
  autoexecFilePath,
  EXECS_GAMEPLAY_STEM,
  ensureAutoexecExecLine,
  ownedCfgPath,
} from "./binds-ui";

export { type AutoexecPatch, autoexecFilePath, EXECS_GAMEPLAY_STEM, ensureAutoexecExecLine };

export const GAMEPLAY_STEM = EXECS_GAMEPLAY_STEM;

export const GAMEPLAY_HEADER = "// execs gameplay — managed, do not edit by hand";

export const FLIP_VIEWMODELS_NOTE = "Does not apply while connected to a server.";

export const FOV_MIN = 54;
export const FOV_MAX = 90;
export const CROSSHAIR_SCALE_MIN = 16;
export const CROSSHAIR_SCALE_MAX = 64;
export const COLOR_MIN = 0;
export const COLOR_MAX = 255;

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

export type CrosshairFile = (typeof CROSSHAIR_FILES)[number];

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
  cl_crosshair_file: CrosshairFile;
  cl_crosshair_scale: number;
  cl_crosshair_red: number;
  cl_crosshair_green: number;
  cl_crosshair_blue: number;
  cl_crosshair_alpha: number;
};

const CROSSHAIR_FILE_SET = new Set<string>(CROSSHAIR_FILES);

function corpusNumber(name: string, fallback: number): number {
  const raw = lookupCvar(name)?.d;
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? Math.round(value) : fallback;
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
    cl_crosshair_file: "",
    cl_crosshair_scale: corpusNumber("cl_crosshair_scale", 32),
    cl_crosshair_red: corpusNumber("cl_crosshair_red", 200),
    cl_crosshair_green: corpusNumber("cl_crosshair_green", 200),
    cl_crosshair_blue: corpusNumber("cl_crosshair_blue", 200),
    cl_crosshair_alpha: corpusNumber("cl_crosshair_alpha", 200),
  };
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
    viewmodel_fov: clampInt(settings.viewmodel_fov, FOV_MIN, FOV_MAX),
    tf_use_min_viewmodels: settings.tf_use_min_viewmodels ? 1 : 0,
    r_drawviewmodel: settings.r_drawviewmodel ? 1 : 0,
    r_drawtracers_firstperson: settings.r_drawtracers_firstperson ? 1 : 0,
    r_drawtracers: settings.r_drawtracers ? 1 : 0,
    cl_flipviewmodels: settings.cl_flipviewmodels ? 1 : 0,
    cl_crosshair_file: parseCrosshairFile(settings.cl_crosshair_file),
    cl_crosshair_scale: clampInt(
      settings.cl_crosshair_scale,
      CROSSHAIR_SCALE_MIN,
      CROSSHAIR_SCALE_MAX,
    ),
    cl_crosshair_red: clampInt(settings.cl_crosshair_red, COLOR_MIN, COLOR_MAX),
    cl_crosshair_green: clampInt(settings.cl_crosshair_green, COLOR_MIN, COLOR_MAX),
    cl_crosshair_blue: clampInt(settings.cl_crosshair_blue, COLOR_MIN, COLOR_MAX),
    cl_crosshair_alpha: clampInt(settings.cl_crosshair_alpha, COLOR_MIN, COLOR_MAX),
  };
}

export function gameplayPath(layer: GameplayLayer): string {
  return ownedCfgPath(layer, `${EXECS_GAMEPLAY_STEM}.cfg`);
}

export function autoexecPath(layer: GameplayLayer): string {
  return autoexecFilePath(layer);
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

export function gameplayFromEffective(effective: Record<string, string>): GameplaySettings {
  return applyCvars(defaultGameplay(), effective);
}

export function parseGameplay(text: string): GameplaySettings {
  return applyCvars(defaultGameplay(), parseCvarMap(text));
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
  const file = next.cl_crosshair_file === "" ? '""' : next.cl_crosshair_file;
  return [
    GAMEPLAY_HEADER,
    `fov_desired ${next.fov_desired}`,
    `viewmodel_fov ${next.viewmodel_fov}`,
    `tf_use_min_viewmodels ${next.tf_use_min_viewmodels}`,
    `r_drawviewmodel ${next.r_drawviewmodel}`,
    `r_drawtracers_firstperson ${next.r_drawtracers_firstperson}`,
    `r_drawtracers ${next.r_drawtracers}`,
    `cl_flipviewmodels ${next.cl_flipviewmodels}`,
    `cl_crosshair_file ${file}`,
    `cl_crosshair_scale ${next.cl_crosshair_scale}`,
    `cl_crosshair_red ${next.cl_crosshair_red}`,
    `cl_crosshair_green ${next.cl_crosshair_green}`,
    `cl_crosshair_blue ${next.cl_crosshair_blue}`,
    `cl_crosshair_alpha ${next.cl_crosshair_alpha}`,
    "",
  ].join("\n");
}

export function gameplayDirty(draft: GameplaySettings, saved: GameplaySettings): boolean {
  return serializeGameplay(draft) !== serializeGameplay(saved);
}

/** Pane write-lock: Apply stays off while TF2 is running or a write is in flight. */
export function canApplyGameplay(running: boolean, busy: boolean): boolean {
  return !running && !busy;
}

export function gameplayAutoexecPatch(
  layer: GameplayLayer,
  existing = "",
): AutoexecPatch | undefined {
  return autoexecExecPatch(layer, existing, EXECS_GAMEPLAY_STEM);
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
    next.viewmodel_fov = parseIntish(viewmodel, next.viewmodel_fov);
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
  const alpha = read("cl_crosshair_alpha");
  if (alpha !== undefined) {
    next.cl_crosshair_alpha = parseIntish(alpha, next.cl_crosshair_alpha);
  }

  return clampGameplay(next);
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
  const value = String(raw)
    .trim()
    .toLowerCase()
    .replace(/\.vtf$/i, "");
  if (value === "" || value === "0" || value === "default") {
    return "";
  }
  if (CROSSHAIR_FILE_SET.has(value)) {
    return value as CrosshairFile;
  }
  return "";
}
