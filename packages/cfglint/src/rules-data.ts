// Shared rule data. Everything lowercased.

/** Keys a player plausibly presses constantly during gameplay. */
export const GAMEPLAY_KEYS = new Set([
  "mouse1",
  "mouse2",
  "mouse3",
  "mouse4",
  "mouse5",
  "mwheelup",
  "mwheeldown",
  "w",
  "a",
  "s",
  "d",
  "e",
  "r",
  "q",
  "f",
  "space",
  "tab",
  "shift",
  "ctrl",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "0",
]);

/** Commands that end or damage the play session when triggered unexpectedly. */
export const DISRUPTIVE_COMMANDS = new Set(["quit", "exit", "disconnect", "retry", "restart"]);

/** Commands that route the client to another server / leak control. */
export const NETWORK_HIJACK_COMMANDS = new Set(["connect", "redirect"]);

export const RCON_NAMES = new Set(["rcon", "rcon_address", "rcon_password", "rcon_port"]);

// Text chat only — voicemenu binds are standard practice, not a spam vector.
export const CHAT_COMMANDS = new Set(["say", "say_team", "say_party"]);

export const SELF_HARM_COMMANDS = new Set(["kill", "explode"]);

export const MOUSE_CVARS = new Set([
  "sensitivity",
  "m_yaw",
  "m_pitch",
  "m_forward",
  "m_side",
  "zoom_sensitivity_ratio",
]);

/**
 * Engine names that an alias must never shadow — shadowing these lets a
 * config silently change what reviewed commands do.
 */
export const ALIAS_SHADOW_DENYLIST = new Set([
  "exec",
  "alias",
  "bind",
  "unbind",
  "unbindall",
  "connect",
  "disconnect",
  "retry",
  "quit",
  "exit",
  "say",
  "say_team",
  "rcon",
  "kill",
  "explode",
  "toggleconsole",
]);

/** Engine commands absent from the cvar dump (hidden/special) but universally used. */
export const BUILTIN_COMMANDS = new Set(["wait", "toggleconsole", "slot10"]);

/** exec targets outside the bundle that are always fine. */
export const DEFAULT_EXTERNAL_EXEC_ALLOWLIST = ["config_default", "undo360controller"];

export const MAX_ALIAS_DEPTH = 8;
export const MAX_EXEC_DEPTH = 4;

/** Sane ranges for net cvars; outside → warn. */
export const NET_CVAR_RANGES: Record<string, { min: number; max: number }> = {
  cl_interp: { min: 0, max: 0.5 },
  cl_interp_ratio: { min: 0, max: 5 },
  cl_cmdrate: { min: 10, max: 132 },
  cl_updaterate: { min: 10, max: 132 },
  rate: { min: 20000, max: 10000000 },
  cl_timeout: { min: 10, max: 300 },
};

export const CLASS_CFG_NAMES: Record<string, string> = {
  "scout.cfg": "scout",
  "soldier.cfg": "soldier",
  "pyro.cfg": "pyro",
  "demoman.cfg": "demoman",
  "heavyweapons.cfg": "heavy",
  "engineer.cfg": "engineer",
  "medic.cfg": "medic",
  "sniper.cfg": "sniper",
  "spy.cfg": "spy",
};

/** Summary domain classification by cvar prefix / exact name. */
export const DOMAIN_LABELS: Record<string, string> = {
  graphics: "Graphics & performance",
  network: "Network & interpolation",
  mouse: "Mouse & input",
  audio: "Audio",
  hud: "HUD & viewmodels",
  gameplay: "Gameplay",
  other: "Other settings",
};

const DOMAIN_PREFIXES: Array<[string, string]> = [
  ["r_", "graphics"],
  ["mat_", "graphics"],
  ["lod_", "graphics"],
  ["mp_usehwmmodels", "graphics"],
  ["gl_", "graphics"],
  ["props_", "graphics"],
  ["cl_ragdoll", "graphics"],
  ["cl_burninggibs", "graphics"],
  ["cl_phys", "graphics"],
  ["violence_", "graphics"],
  ["fps_max", "graphics"],
  ["net_", "network"],
  ["cl_interp", "network"],
  ["cl_cmdrate", "network"],
  ["cl_updaterate", "network"],
  ["rate", "network"],
  ["cl_timeout", "network"],
  ["m_", "mouse"],
  ["sensitivity", "mouse"],
  ["zoom_sensitivity", "mouse"],
  ["snd_", "audio"],
  ["volume", "audio"],
  ["dsp_", "audio"],
  ["voice_", "audio"],
  ["hud_", "hud"],
  ["cl_hud", "hud"],
  ["viewmodel_", "hud"],
  ["crosshair", "hud"],
  ["cl_crosshair", "hud"],
  ["tf_use_min_viewmodels", "hud"],
  ["fov_", "hud"],
  ["tf_", "gameplay"],
  ["cl_autoreload", "gameplay"],
  ["cl_autorezoom", "gameplay"],
];

export function classifyDomain(cvar: string): string {
  for (const [prefix, domain] of DOMAIN_PREFIXES) {
    if (cvar.startsWith(prefix)) return domain;
  }
  return "other";
}
