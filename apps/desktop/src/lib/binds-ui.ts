import { parseCommands } from "@execs/cfglint";

export type BindsLayer = "comfig" | "vanilla";

export type ManagedExecStem = "execs_binds" | "execs_gameplay";

export const EXECS_BINDS_STEM = "execs_binds" satisfies ManagedExecStem;
export const EXECS_GAMEPLAY_STEM = "execs_gameplay" satisfies ManagedExecStem;

export const MANAGED_BINDS_HEADER = "// execs binds — managed, do not edit by hand";
export const MANAGED_EXEC_COMMENT = "// execs:managed";

export const BIND_ACTIONS = [
  { id: "forward", label: "Forward", command: "+forward" },
  { id: "back", label: "Back", command: "+back" },
  { id: "moveleft", label: "Move left", command: "+moveleft" },
  { id: "moveright", label: "Move right", command: "+moveright" },
  { id: "jump", label: "Jump", command: "+jump" },
  { id: "duck", label: "Duck", command: "+duck" },
  { id: "medic", label: "Call medic", command: "voicemenu 0 0" },
  { id: "use", label: "Use", command: "+use" },
  { id: "voice", label: "Voice chat", command: "+voicerecord" },
  { id: "loadout0", label: "Loadout A", command: "load_itempreset 0" },
  { id: "loadout1", label: "Loadout B", command: "load_itempreset 1" },
  { id: "loadout2", label: "Loadout C", command: "load_itempreset 2" },
  { id: "loadout3", label: "Loadout D", command: "load_itempreset 3" },
] as const;

export type BindAction = (typeof BIND_ACTIONS)[number];
export type BindActionId = BindAction["id"];

export type BindMap = Map<string, string> | Record<string, string>;

const ACTION_IDS = new Set<string>(BIND_ACTIONS.map((action) => action.id));

const COMMAND_TO_ACTION = new Map<string, BindAction>(
  BIND_ACTIONS.map((action) => [normalizeBindCommand(action.command), action]),
);

const CODE_TO_SOURCE: Record<string, string> = {
  Space: "space",
  ShiftLeft: "shift",
  ShiftRight: "shift",
  ControlLeft: "ctrl",
  ControlRight: "ctrl",
  AltLeft: "alt",
  AltRight: "alt",
  Tab: "tab",
  Enter: "enter",
  NumpadEnter: "kp_enter",
  Escape: "escape",
  Backspace: "backspace",
  Semicolon: "semicolin",
  Comma: "comma",
  Period: "period",
  Slash: "slash",
  Backslash: "backslash",
  Quote: "apostrophe",
  Minus: "minus",
  Equal: "equal",
  BracketLeft: "[",
  BracketRight: "]",
  Backquote: "`",
  CapsLock: "capslock",
  Insert: "ins",
  Delete: "del",
  Home: "home",
  End: "end",
  PageUp: "pgup",
  PageDown: "pgdn",
  ArrowUp: "uparrow",
  ArrowDown: "downarrow",
  ArrowLeft: "leftarrow",
  ArrowRight: "rightarrow",
  Mouse0: "mouse1",
  Mouse1: "mouse2",
  Mouse2: "mouse3",
  Mouse3: "mouse4",
  Mouse4: "mouse5",
  Numpad0: "kp_ins",
  Numpad1: "kp_end",
  Numpad2: "kp_downarrow",
  Numpad3: "kp_pgdn",
  Numpad4: "kp_leftarrow",
  Numpad5: "kp_5",
  Numpad6: "kp_rightarrow",
  Numpad7: "kp_home",
  Numpad8: "kp_uparrow",
  Numpad9: "kp_pgup",
  NumpadDecimal: "kp_del",
  NumpadDivide: "kp_slash",
  NumpadMultiply: "kp_multiply",
  NumpadSubtract: "kp_minus",
  NumpadAdd: "kp_plus",
};

const NUMPAD_KEY_TO_SOURCE: Record<string, string> = {
  "0": "kp_ins",
  "1": "kp_end",
  "2": "kp_downarrow",
  "3": "kp_pgdn",
  "4": "kp_leftarrow",
  "5": "kp_5",
  "6": "kp_rightarrow",
  "7": "kp_home",
  "8": "kp_uparrow",
  "9": "kp_pgup",
  Insert: "kp_ins",
  End: "kp_end",
  ArrowDown: "kp_downarrow",
  PageDown: "kp_pgdn",
  ArrowLeft: "kp_leftarrow",
  Clear: "kp_5",
  ArrowRight: "kp_rightarrow",
  Home: "kp_home",
  ArrowUp: "kp_uparrow",
  PageUp: "kp_pgup",
  Delete: "kp_del",
  ".": "kp_del",
  "/": "kp_slash",
  "*": "kp_multiply",
  "-": "kp_minus",
  "+": "kp_plus",
  Enter: "kp_enter",
};

const PUNCTUATION_KEY_TO_SOURCE: Record<string, string> = {
  ";": "semicolin",
  ":": "semicolin",
  ",": "comma",
  "<": "comma",
  ".": "period",
  ">": "period",
  "/": "slash",
  "?": "slash",
  "\\": "backslash",
  "|": "backslash",
  "'": "apostrophe",
  '"': "apostrophe",
  "-": "minus",
  _: "minus",
  "=": "equal",
  "+": "equal",
  "[": "[",
  "{": "[",
  "]": "]",
  "}": "]",
  "`": "`",
  "~": "`",
};

const DOM_KEY_LOCATION_NUMPAD = 3;

for (let index = 1; index <= 12; index += 1) {
  CODE_TO_SOURCE[`F${index}`] = `f${index}`;
}

export function isBindActionId(value: string): value is BindActionId {
  return ACTION_IDS.has(value);
}

export function bindActionById(id: string): BindAction | undefined {
  return BIND_ACTIONS.find((action) => action.id === id);
}

export function normalizeBindCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ").toLowerCase();
}

export function canRecordBinds(running: boolean, busy: boolean): boolean {
  return !running && !busy;
}

/** Source key name for a `KeyboardEvent.code`, or `Mouse0`–`Mouse4`. */
export function sourceKeyFromCode(code: string): string | null {
  if (CODE_TO_SOURCE[code]) {
    return CODE_TO_SOURCE[code];
  }
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3).toLowerCase();
  }
  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5);
  }
  return null;
}

/** Shown when a pressed key has no TF2 source name; cleared after this long. */
export const UNBINDABLE_KEY_MESSAGE = "That key can't be bound in TF2.";
export const UNBINDABLE_KEY_NOTICE_MS = 2000;

/**
 * What the recorder should do with the key it just resolved.
 *
 * `null` means the key is outside TF2's table (F13+, media keys, the Windows
 * key, a 6th mouse button…). Swallowing it leaves the row stuck on "Waiting for
 * input" with no explanation, so it gets a notice and the recorder keeps
 * listening.
 */
export type RecorderOutcome =
  | { kind: "unbindable"; message: string }
  | { kind: "cancel" }
  | { kind: "bind"; key: string };

export function recorderOutcomeForKey(key: string | null): RecorderOutcome {
  if (key === null) {
    return { kind: "unbindable", message: UNBINDABLE_KEY_MESSAGE };
  }
  if (key === "escape") {
    return { kind: "cancel" };
  }
  return { kind: "bind", key };
}

export function sourceKeyFromMouseButton(button: number): string | null {
  if (button >= 0 && button <= 4) {
    return `mouse${button + 1}`;
  }
  return null;
}

export function sourceKeyFromWheelDelta(deltaY: number): "mwheelup" | "mwheeldown" | null {
  if (deltaY < 0) {
    return "mwheelup";
  }
  if (deltaY > 0) {
    return "mwheeldown";
  }
  return null;
}

export function sourceKeyFromKeyboardEvent(event: {
  code?: string;
  key?: string;
  location?: number;
  repeat?: boolean;
}): string | null {
  if (event.repeat) {
    return null;
  }
  const fromCode = sourceKeyFromCode(event.code ?? "");
  return fromCode ?? sourceKeyFromKey(event.key ?? "", event.location);
}

/** Fallback for WebViews that report an empty or `Unidentified` code. */
export function sourceKeyFromKey(key: string, location = 0): string | null {
  if (location === DOM_KEY_LOCATION_NUMPAD && NUMPAD_KEY_TO_SOURCE[key]) {
    return NUMPAD_KEY_TO_SOURCE[key];
  }
  const named: Record<string, string> = {
    " ": "space",
    Spacebar: "space",
    Shift: "shift",
    Control: "ctrl",
    Alt: "alt",
    Tab: "tab",
    Enter: "enter",
    Escape: "escape",
    Backspace: "backspace",
    CapsLock: "capslock",
    Insert: "ins",
    Delete: "del",
    Home: "home",
    End: "end",
    PageUp: "pgup",
    PageDown: "pgdn",
    ArrowUp: "uparrow",
    ArrowDown: "downarrow",
    ArrowLeft: "leftarrow",
    ArrowRight: "rightarrow",
  };
  if (named[key]) {
    return named[key];
  }
  if (PUNCTUATION_KEY_TO_SOURCE[key]) {
    return PUNCTUATION_KEY_TO_SOURCE[key];
  }
  if (/^[a-z0-9]$/i.test(key)) {
    return key.toLowerCase();
  }
  if (/^F(?:[1-9]|1[0-2])$/i.test(key)) {
    return key.toLowerCase();
  }
  return null;
}

export function ownedCfgPath(layer: BindsLayer, fileName: string): string {
  return layer === "comfig" ? `tf/cfg/overrides/${fileName}` : `tf/cfg/${fileName}`;
}

export function bindsFilePath(layer: BindsLayer): string {
  return ownedCfgPath(layer, `${EXECS_BINDS_STEM}.cfg`);
}

export const MANAGED_EXEC_STEMS: ManagedExecStem[] = [EXECS_BINDS_STEM, EXECS_GAMEPLAY_STEM];

/** Where a managed cfg lives for the layer, by stem. */
export function managedCfgPath(layer: BindsLayer, fileStem: ManagedExecStem): string {
  return ownedCfgPath(layer, `${fileStem}.cfg`);
}

export function autoexecFilePath(layer: BindsLayer): string {
  return ownedCfgPath(layer, "autoexec.cfg");
}

function bindEntries(binds: BindMap): Array<[string, string]> {
  return binds instanceof Map ? [...binds.entries()] : Object.entries(binds);
}

/** Last key bound to `command` (cfglint key → command map). */
export function lastKeyForCommand(binds: BindMap, command: string): string | null {
  const wanted = normalizeBindCommand(command);
  let found: string | null = null;
  for (const [key, value] of bindEntries(binds)) {
    if (normalizeBindCommand(value) === wanted) {
      found = key.toLowerCase();
    }
  }
  return found;
}

export function keyForAction(effectiveBinds: BindMap, actionId: BindActionId): string | null {
  const action = bindActionById(actionId);
  return action ? lastKeyForCommand(effectiveBinds, action.command) : null;
}

/** The managed overlay is what execs will apply, so it wins over stale config.cfg data. */
export function displayedKeyForAction(
  effectiveBinds: BindMap,
  managedBinds: Partial<Record<BindActionId, string>>,
  actionId: BindActionId,
): string | null {
  const managedKey = managedBinds[actionId]?.trim().toLowerCase();
  if (managedKey) {
    return managedKey;
  }

  const action = bindActionById(actionId);
  if (!action) {
    return null;
  }
  const claimedKeys = new Set(
    Object.values(managedBinds)
      .map((key) => key?.trim().toLowerCase())
      .filter((key): key is string => Boolean(key)),
  );
  const wanted = normalizeBindCommand(action.command);
  let found: string | null = null;
  for (const [key, command] of bindEntries(effectiveBinds)) {
    const normalizedKey = key.toLowerCase();
    if (!claimedKeys.has(normalizedKey) && normalizeBindCommand(command) === wanted) {
      found = normalizedKey;
    }
  }
  return found;
}

/** Only a completed absorb that observed config.cfg drift may update managed binds. */
export function shouldSyncTrackedBinds(bindSyncRequest: number | null, running: boolean): boolean {
  return bindSyncRequest !== null && !running;
}

export function parseManagedBinds(text: string): Partial<Record<BindActionId, string>> {
  const assigned: Partial<Record<BindActionId, string>> = {};
  for (const command of parseCommands(text, "execs_binds.cfg")) {
    if (command.name !== "bind" || command.args.length < 2) {
      continue;
    }
    const key = command.args[0].toLowerCase();
    const payload = command.args.slice(1).join(" ");
    const action = COMMAND_TO_ACTION.get(normalizeBindCommand(payload));
    if (action) {
      assigned[action.id] = key;
    }
  }
  return assigned;
}

function quoteCfgToken(value: string): string {
  return /[\s"]/.test(value) ? `"${value}"` : value;
}

export function serializeManagedBinds(actionKeys: Partial<Record<BindActionId, string>>): string {
  const lines = [MANAGED_BINDS_HEADER];
  const usedKeys = new Set<string>();
  for (const action of BIND_ACTIONS) {
    const key = actionKeys[action.id]?.trim().toLowerCase();
    if (!key || usedKeys.has(key)) {
      continue;
    }
    usedKeys.add(key);
    lines.push(`bind ${quoteCfgToken(key)} ${quoteCfgToken(action.command)}`);
  }
  return `${lines.join("\n")}\n`;
}

export function applyRecordedBind(
  currentFile: string,
  actionId: string,
  sourceKey: string,
): string {
  if (!isBindActionId(actionId)) {
    return currentFile;
  }
  const key = sourceKey.trim().toLowerCase();
  if (!key || key === "escape") {
    return currentFile;
  }
  const next = { ...parseManagedBinds(currentFile) };
  for (const id of BIND_ACTIONS.map((action) => action.id)) {
    if (next[id] === key && id !== actionId) {
      delete next[id];
    }
  }
  next[actionId] = key;
  return serializeManagedBinds(next);
}

/**
 * If config.cfg rebound a tracked action onto another key, rewrite that
 * action's bind in the managed file. Never emits `unbindall`.
 */
/** Binds from `tf/cfg/config.cfg` only — not the managed overlay. */
export function configBindsFromFiles(
  files: Array<{ path: string; text: string }>,
): Record<string, string> {
  const config = files.find((file) => {
    const path = file.path.replace(/\\/g, "/").toLowerCase();
    return path === "tf/cfg/config.cfg" || path.endsWith("/config.cfg");
  });
  if (!config) {
    return {};
  }
  const binds: Record<string, string> = {};
  for (const command of parseCommands(config.text, "config.cfg")) {
    if (command.name !== "bind" || command.args.length < 2) {
      continue;
    }
    binds[command.args[0].toLowerCase()] = command.args.slice(1).join(" ");
  }
  return binds;
}

export function syncTrackedBindsFromConfig(currentFile: string, configBinds: BindMap): string {
  const next = { ...parseManagedBinds(currentFile) };
  let changed = false;
  for (const action of BIND_ACTIONS) {
    const configKey = lastKeyForCommand(configBinds, action.command);
    if (!configKey || next[action.id] === configKey) {
      continue;
    }
    for (const id of BIND_ACTIONS.map((item) => item.id)) {
      if (next[id] === configKey && id !== action.id) {
        delete next[id];
      }
    }
    next[action.id] = configKey;
    changed = true;
  }
  return changed || currentFile.trim().length === 0 ? serializeManagedBinds(next) : currentFile;
}

function execStem(target: string): string {
  const base = target.replace(/\\/g, "/").split("/").pop() ?? target;
  return base.replace(/\.cfg$/i, "").toLowerCase();
}

function execTargetOf(raw: string): string {
  return raw
    .replace(/\\/g, "/")
    .replace(/\.cfg$/i, "")
    .toLowerCase();
}

/** The engine resolves `exec` targets relative to tf/cfg no matter which file
 * issues them, so overrides-layer files must be addressed with the
 * `overrides/` prefix — a bare stem silently fails in game. */
export function managedExecTarget(layer: BindsLayer, fileStem: ManagedExecStem): string {
  return layer === "comfig" ? `overrides/${fileStem}` : fileStem;
}

export function autoexecHasExecLine(
  existingAutoexec: string,
  fileStem: ManagedExecStem,
  layer: BindsLayer,
): boolean {
  const target = managedExecTarget(layer, fileStem);
  for (const command of parseCommands(existingAutoexec, "autoexec.cfg")) {
    if (command.name === "exec" && command.args[0] && execTargetOf(command.args[0]) === target) {
      return true;
    }
  }
  return false;
}

export function ensureAutoexecExecLine(
  existingAutoexec: string,
  fileStem: ManagedExecStem,
  layer: BindsLayer,
): string {
  const line = `exec ${managedExecTarget(layer, fileStem)} ${MANAGED_EXEC_COMMENT}`;
  // Migrate managed lines whose target no longer resolves (a bare stem
  // written before the layer prefix fix, or a stale prefix after a layer
  // change) to the correct spelling in place.
  let migrated = false;
  const rewritten = existingAutoexec
    .split("\n")
    .map((raw) => {
      if (!raw.trim().endsWith(MANAGED_EXEC_COMMENT)) {
        return raw;
      }
      const commands = [...parseCommands(raw, "autoexec.cfg")];
      const command = commands[0];
      if (
        commands.length === 1 &&
        command.name === "exec" &&
        command.args[0] &&
        execStem(command.args[0]) === fileStem &&
        raw.trim() !== line
      ) {
        migrated = true;
        return line;
      }
      return raw;
    })
    .join("\n");
  const text = migrated ? rewritten : existingAutoexec;
  if (autoexecHasExecLine(text, fileStem, layer)) {
    return text;
  }
  const trimmed = text.replace(/\s+$/u, "");
  return trimmed.length > 0 ? `${trimmed}\n${line}\n` : `${line}\n`;
}
