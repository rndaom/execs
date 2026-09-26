import { parseCommands } from "@execs/cfglint";
import { canWrite } from "./write-gate";

export type BindsLayer = "comfig" | "vanilla";

export type ManagedExecStem = "execs_binds" | "execs_gameplay";

export const EXECS_BINDS_STEM = "execs_binds" satisfies ManagedExecStem;
export const EXECS_GAMEPLAY_STEM = "execs_gameplay" satisfies ManagedExecStem;

export const MANAGED_BINDS_HEADER =
  "// execs binds — standalone action binds are managed; other lines are kept";
export const MANAGED_EXEC_COMMENT = "// execs:managed";

export const BIND_ACTIONS = [
  { id: "forward", label: "Forward", command: "+forward" },
  { id: "back", label: "Back", command: "+back" },
  { id: "moveleft", label: "Move left", command: "+moveleft" },
  { id: "moveright", label: "Move right", command: "+moveright" },
  { id: "jump", label: "Jump", command: "+jump" },
  { id: "duck", label: "Duck", command: "+duck" },
  { id: "attack", label: "Primary attack", command: "+attack" },
  { id: "attack2", label: "Secondary attack", command: "+attack2" },
  { id: "attack3", label: "Special attack", command: "+attack3" },
  { id: "reload", label: "Reload", command: "+reload" },
  { id: "inspect", label: "Inspect", command: "+inspect" },
  { id: "taunt", label: "Taunt", command: "+taunt" },
  { id: "invprev", label: "Previous weapon", command: "invprev" },
  { id: "invnext", label: "Next weapon", command: "invnext" },
  { id: "lastinv", label: "Last weapon", command: "lastinv" },
  { id: "slot1", label: "Weapon slot 1", command: "slot1" },
  { id: "slot2", label: "Weapon slot 2", command: "slot2" },
  { id: "slot3", label: "Weapon slot 3", command: "slot3" },
  { id: "slot4", label: "Weapon slot 4", command: "slot4" },
  { id: "slot5", label: "Weapon slot 5", command: "slot5" },
  { id: "slot6", label: "Weapon slot 6 / grappling hook", command: "slot6" },
  { id: "medic", label: "Medic!", command: "voicemenu 0 0" },
  { id: "thanks", label: "Thanks!", command: "voicemenu 0 1" },
  { id: "help", label: "Help!", command: "voicemenu 2 0" },
  { id: "incoming", label: "Incoming", command: "voicemenu 1 0" },
  { id: "spy", label: "Spy!", command: "voicemenu 1 1" },
  { id: "sentryahead", label: "Sentry ahead!", command: "voicemenu 1 2" },
  { id: "activatecharge", label: "Activate charge!", command: "voicemenu 1 6" },
  { id: "battlecry", label: "Battle cry", command: "voicemenu 2 1" },
  { id: "use", label: "Use", command: "+use" },
  { id: "voice", label: "Voice chat", command: "+voicerecord" },
  { id: "chat", label: "Text chat", command: "say" },
  { id: "teamchat", label: "Team chat", command: "say_team" },
  { id: "partychat", label: "Party chat", command: "say_party" },
  { id: "voicemenu1", label: "Voice menu 1", command: "voice_menu_1" },
  { id: "voicemenu2", label: "Voice menu 2", command: "voice_menu_2" },
  { id: "voicemenu3", label: "Voice menu 3", command: "voice_menu_3" },
  { id: "actionslot", label: "Action slot item", command: "+use_action_slot_item" },
  { id: "dropitem", label: "Drop carried item", command: "dropitem" },
  { id: "showscores", label: "Scoreboard", command: "+showscores" },
  { id: "spray", label: "Spray", command: "impulse 201" },
  { id: "ready", label: "Mann vs. Machine ready", command: "player_ready_toggle" },
  { id: "lastdisguise", label: "Last disguise", command: "lastdisguise" },
  { id: "changeclass", label: "Change class", command: "changeclass" },
  { id: "changeteam", label: "Change team", command: "changeteam" },
  { id: "character", label: "Character loadout", command: "open_charinfo_direct" },
  { id: "backpack", label: "Backpack", command: "open_charinfo_backpack" },
  { id: "mapinfo", label: "Map info", command: "showmapinfo" },
  { id: "contracts", label: "Contracts", command: "show_quest_log" },
  { id: "console", label: "Developer console", command: "toggleconsole" },
  { id: "screenshot", label: "Screenshot", command: "screenshot" },
  { id: "loadout0", label: "Loadout A", command: "load_itempreset 0" },
  { id: "loadout1", label: "Loadout B", command: "load_itempreset 1" },
  { id: "loadout2", label: "Loadout C", command: "load_itempreset 2" },
  { id: "loadout3", label: "Loadout D", command: "load_itempreset 3" },
] as const;

export type BindAction = (typeof BIND_ACTIONS)[number];
export type BindActionId = BindAction["id"];

/** Actions grouped by what the player is doing. Every action appears once. */
export const BIND_GROUPS: ReadonlyArray<{ id: string; title: string; ids: BindActionId[] }> = [
  {
    id: "movement",
    title: "Movement",
    ids: ["forward", "back", "moveleft", "moveright", "jump", "duck"],
  },
  {
    id: "combat",
    title: "Combat",
    ids: ["attack", "attack2", "attack3", "reload", "inspect", "taunt"],
  },
  {
    id: "weapons",
    title: "Weapons",
    ids: ["slot1", "slot2", "slot3", "slot4", "slot5", "slot6", "lastinv", "invprev", "invnext"],
  },
  {
    id: "communication",
    title: "Chat",
    ids: ["voice", "chat", "teamchat", "partychat", "voicemenu1", "voicemenu2", "voicemenu3"],
  },
  {
    id: "voice",
    title: "Voice",
    ids: [
      "medic",
      "thanks",
      "help",
      "incoming",
      "spy",
      "sentryahead",
      "activatecharge",
      "battlecry",
    ],
  },
  {
    id: "gameplay",
    title: "Gameplay",
    ids: ["use", "actionslot", "dropitem", "spray", "lastdisguise", "ready"],
  },
  {
    id: "menus",
    title: "Menus",
    ids: [
      "showscores",
      "changeclass",
      "changeteam",
      "character",
      "backpack",
      "mapinfo",
      "contracts",
      "console",
      "screenshot",
    ],
  },
  {
    id: "loadouts",
    title: "Loadouts",
    ids: ["loadout0", "loadout1", "loadout2", "loadout3"],
  },
];

/** Words players search for that an action's name does not contain. */
const SEARCH_HINTS: Partial<Record<BindActionId, string>> = {
  attack: "shoot fire mouse",
  attack2: "alt fire zoom scope airblast",
  attack3: "mvm canteen",
  lastdisguise: "spy",
  activatecharge: "medic uber ubercharge",
  actionslot: "canteen grappling spellbook",
  slot6: "grapple",
  spray: "logo",
  ready: "mvm",
  showscores: "tab score",
  voice: "mic push to talk",
  chat: "say all",
  console: "tilde",
};

const KEY_LABELS: Record<string, string> = {
  space: "Space",
  ctrl: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  tab: "Tab",
  enter: "Enter",
  escape: "Esc",
  backspace: "Backspace",
  capslock: "Caps Lock",
  ins: "Insert",
  del: "Delete",
  home: "Home",
  end: "End",
  pgup: "Page Up",
  pgdn: "Page Down",
  uparrow: "Up",
  downarrow: "Down",
  leftarrow: "Left",
  rightarrow: "Right",
  semicolin: ";",
  apostrophe: "'",
  comma: ",",
  period: ".",
  slash: "/",
  backslash: "\\",
  minus: "-",
  equal: "=",
  mwheelup: "Wheel up",
  mwheeldown: "Wheel down",
  kp_ins: "Num 0",
  kp_end: "Num 1",
  kp_downarrow: "Num 2",
  kp_pgdn: "Num 3",
  kp_leftarrow: "Num 4",
  kp_5: "Num 5",
  kp_rightarrow: "Num 6",
  kp_home: "Num 7",
  kp_uparrow: "Num 8",
  kp_pgup: "Num 9",
  kp_del: "Num .",
  kp_slash: "Num /",
  kp_multiply: "Num *",
  kp_minus: "Num -",
  kp_plus: "Num +",
  kp_enter: "Num Enter",
};

/** A Source key name as players read it on a keyboard: `kp_end` is "Num 1". */
export function bindKeyLabel(key: string): string {
  const lower = key.toLowerCase();
  if (KEY_LABELS[lower]) return KEY_LABELS[lower];
  const mouse = /^mouse([1-5])$/.exec(lower);
  if (mouse) return `Mouse ${mouse[1]}`;
  return lower.length === 1 || /^f\d{1,2}$/.test(lower) ? lower.toUpperCase() : lower;
}

/**
 * Actions matching every word of a search, by name, group, command or a key
 * already bound to it, so "mouse4" finds whatever that button does.
 */
export function searchBindActions(
  query: string,
  keysFor: (id: BindActionId) => readonly string[],
): Set<BindActionId> {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = new Set<BindActionId>();
  for (const group of BIND_GROUPS) {
    for (const id of group.ids) {
      const action = bindActionById(id);
      if (!action) continue;
      const keys = keysFor(id);
      const haystack = [
        action.label,
        group.title,
        action.command,
        SEARCH_HINTS[id] ?? "",
        ...keys,
        ...keys.map(bindKeyLabel),
      ]
        .join(" ")
        .toLowerCase();
      if (words.every((word) => haystack.includes(word))) matches.add(id);
    }
  }
  return matches;
}

export type BindMap = Map<string, string> | Record<string, string>;
export type BindSourceMap = Record<string, { file: string; line: number }>;

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
// DOM orders the middle and right buttons as 1 and 2, while Source names
// right-click mouse2 and middle-click mouse3.
const DOM_MOUSE_BUTTON_TO_SOURCE = ["mouse1", "mouse3", "mouse2", "mouse4", "mouse5"] as const;

for (let index = 1; index <= 12; index += 1) {
  CODE_TO_SOURCE[`F${index}`] = `f${index}`;
}

export function isBindActionId(value: string): value is BindActionId {
  return ACTION_IDS.has(value);
}

export function bindActionById(id: string): BindAction | undefined {
  return BIND_ACTIONS.find((action) => action.id === id);
}

/** The pane action a bind command runs, when it is one of ours. */
export function bindActionForCommand(command: string): BindAction | undefined {
  return COMMAND_TO_ACTION.get(normalizeBindCommand(command));
}

export function normalizeBindCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ").toLowerCase();
}

export function canRecordBinds(running: boolean, busy: boolean): boolean {
  return canWrite(running, busy);
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
  return DOM_MOUSE_BUTTON_TO_SOURCE[button] ?? null;
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

export function actionBindings(
  binds: BindMap,
  sources: BindSourceMap,
  managedText: string,
  managedPath: string,
  actionId: BindActionId,
): Array<{ key: string; source: { file: string; line: number } | null; owned: boolean }> {
  const action = bindActionById(actionId);
  if (!action) return [];
  const wanted = normalizeBindCommand(action.command);
  const ownedKeys = new Set(
    ownedManagedBindKeys(managedText)
      .filter((bind) => bind.actionId === actionId)
      .map((bind) => bind.key),
  );
  return bindEntries(binds).flatMap(([key, command]) => {
    if (normalizeBindCommand(command) !== wanted) return [];
    const normalizedKey = key.toLowerCase();
    const source = sources[normalizedKey] ?? null;
    const owned =
      ownedKeys.has(normalizedKey) &&
      (source === null || source.file.toLowerCase() === managedPath.toLowerCase());
    return [{ key: normalizedKey, source, owned }];
  });
}

/** Only a completed absorb that observed config.cfg drift may update managed binds. */
export function shouldSyncTrackedBinds(bindSyncRequest: number | null, running: boolean): boolean {
  return bindSyncRequest !== null && !running;
}

/** Only a standalone, uncommented known-action bind belongs to the Binds pane. */
function ownedBindLine(raw: string): { actionId: BindActionId; key: string } | null {
  const commands = parseCommands(raw, "execs_binds.cfg");
  if (commands.length !== 1) return null;
  const command = commands[0];
  if (
    command.name !== "bind" ||
    command.args.length < 2 ||
    command.tokens.some((token) => !token.closed) ||
    raw.slice(command.to).trim() !== ""
  ) {
    return null;
  }
  const action = COMMAND_TO_ACTION.get(normalizeBindCommand(command.args.slice(1).join(" ")));
  return action ? { actionId: action.id, key: command.args[0].toLowerCase() } : null;
}

/** A standalone `unbind <key>` line clears one key for the Binds pane. */
function ownedUnbindLine(raw: string): string | null {
  const commands = parseCommands(raw, "execs_binds.cfg");
  if (commands.length !== 1) return null;
  const command = commands[0];
  if (
    command.name !== "unbind" ||
    command.args.length !== 1 ||
    command.tokens.some((token) => !token.closed) ||
    raw.slice(command.to).trim() !== ""
  ) {
    return null;
  }
  return command.args[0].toLowerCase();
}

/** Keys the pane cleared with its own standalone `unbind` lines. */
export function ownedManagedUnbindKeys(text: string): string[] {
  return fileLines(text).flatMap((line) => {
    const key = ownedUnbindLine(line);
    return key ? [key] : [];
  });
}

function fileLines(text: string): string[] {
  return text.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) ?? [];
}

function fileNewline(text: string): string {
  return text.includes("\r\n") ? "\r\n" : text.includes("\r") ? "\r" : "\n";
}

export function ownedManagedBindKeys(text: string): Array<{ actionId: BindActionId; key: string }> {
  return fileLines(text).flatMap((line) => {
    const owned = ownedBindLine(line);
    return owned ? [owned] : [];
  });
}

function appendManagedLines(text: string, lines: string[]): string {
  if (lines.length === 0) return text;
  const newline = fileNewline(text);
  const prefix = text || `${MANAGED_BINDS_HEADER}${newline}`;
  const separator = /[\r\n]$/.test(prefix) ? "" : newline;
  return `${prefix}${separator}${lines.join(newline)}${newline}`;
}

/** Rewrites pane-owned standalone lines while retaining every other line's bytes. */
function replaceOwnedLines(text: string, lines: string[]): string {
  const preserved = fileLines(text)
    .filter((line) => ownedBindLine(line) === null)
    .join("");
  // The pane's assignments run last so a retained custom command cannot
  // silently undo a choice made in Binds.
  return appendManagedLines(preserved, lines);
}

/** Remove one key owned by this pane, leaving custom lines untouched. */
export function removeOwnedManagedBind(text: string, actionId: BindActionId, key: string): string {
  return fileLines(text)
    .filter((line) => {
      const owned = ownedBindLine(line);
      return owned?.actionId !== actionId || owned.key !== key.toLowerCase();
    })
    .join("");
}

/**
 * Clear one key: drop the pane's own lines for it and add one standalone
 * `unbind`. The managed file runs after config.cfg, so this also silences an
 * inherited binding instead of letting it return. Never `unbindall`.
 */
export function clearManagedKey(text: string, key: string): string {
  const wanted = key.trim().toLowerCase();
  if (!wanted) return text;
  const kept = fileLines(text)
    .filter((line) => ownedBindLine(line)?.key !== wanted && ownedUnbindLine(line) !== wanted)
    .join("");
  return appendManagedLines(kept, [`unbind ${quoteCfgToken(wanted)}`]);
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
  const owned = ownedManagedBindKeys(currentFile);
  if (owned.some((bind) => bind.actionId === actionId && bind.key === key)) return currentFile;
  // A key has one final payload. Reusing a pane-owned key moves that key to
  // the new action, but does not remove the action's other keys.
  // A pane-owned unbind for this key is replaced by the new assignment.
  const withoutClaim = fileLines(currentFile)
    .filter((line) => ownedBindLine(line)?.key !== key && ownedUnbindLine(line) !== key)
    .join("");
  const action = bindActionById(actionId);
  return action
    ? appendManagedLines(withoutClaim, [
        `bind ${quoteCfgToken(key)} ${quoteCfgToken(action.command)}`,
      ])
    : currentFile;
}

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
  const next = bindEntries(configBinds).flatMap(([key, command]) => {
    const action = COMMAND_TO_ACTION.get(normalizeBindCommand(command));
    return action ? [{ actionId: action.id, key: key.toLowerCase() }] : [];
  });
  // A key bound again in TF2 after the pane cleared it keeps its new binding.
  const configKeys = new Set(bindEntries(configBinds).map(([key]) => key.toLowerCase()));
  const staleUnbind = (line: string) => {
    const key = ownedUnbindLine(line);
    return key !== null && configKeys.has(key);
  };
  const withoutStale = fileLines(currentFile)
    .filter((line) => !staleUnbind(line))
    .join("");
  const current = ownedManagedBindKeys(withoutStale);
  const identity = (bindings: typeof next) =>
    bindings
      .map(({ actionId, key }) => `${actionId}:${key}`)
      .sort()
      .join("\n");
  if (currentFile.trim().length > 0 && identity(current) === identity(next)) return withoutStale;
  const ordered = BIND_ACTIONS.flatMap((action) =>
    next
      .filter((bind) => bind.actionId === action.id)
      .map((bind) => `bind ${quoteCfgToken(bind.key)} ${quoteCfgToken(action.command)}`),
  );
  return replaceOwnedLines(withoutStale, ordered);
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
