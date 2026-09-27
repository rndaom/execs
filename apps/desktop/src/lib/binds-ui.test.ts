import { describe, expect, it } from "vitest";
import {
  actionBindings,
  applyRecordedBind,
  autoexecFilePath,
  autoexecHasExecLine,
  BIND_ACTIONS,
  BIND_GROUPS,
  bindActionForCommand,
  bindKeyLabel,
  bindsFilePath,
  canRecordBinds,
  clearManagedKey,
  configBindsFromFiles,
  ensureAutoexecExecLine,
  MANAGED_BINDS_HEADER,
  normalizeBindCommand,
  ownedManagedBindKeys,
  ownedManagedUnbindKeys,
  recorderOutcomeForKey,
  removeOwnedManagedBind,
  searchBindActions,
  serializeManagedBinds,
  shouldSyncTrackedBinds,
  sourceKeyFromCode,
  sourceKeyFromKey,
  sourceKeyFromKeyboardEvent,
  sourceKeyFromMouseButton,
  syncTrackedBindsFromConfig,
  UNBINDABLE_KEY_MESSAGE,
} from "./binds-ui";

function managedKeysByAction(text: string): Record<string, string[]> {
  const keys: Record<string, string[]> = {};
  for (const { actionId, key } of ownedManagedBindKeys(text)) {
    if (!keys[actionId]) keys[actionId] = [];
    keys[actionId].push(key);
  }
  return keys;
}

describe("source key mapping", () => {
  it("maps Space, KeyW, Mouse0, and ShiftLeft", () => {
    expect(sourceKeyFromCode("Space")).toBe("space");
    expect(sourceKeyFromCode("KeyW")).toBe("w");
    expect(sourceKeyFromCode("Mouse0")).toBe("mouse1");
    expect(sourceKeyFromCode("ShiftLeft")).toBe("shift");
  });

  it("maps keyboard events and DOM mouse buttons the pane will see", () => {
    expect(sourceKeyFromKeyboardEvent({ code: "KeyW" })).toBe("w");
    expect(sourceKeyFromKeyboardEvent({ code: "KeyW", repeat: true })).toBeNull();
    expect(sourceKeyFromMouseButton(0)).toBe("mouse1");
    expect(sourceKeyFromMouseButton(1)).toBe("mouse3");
    expect(sourceKeyFromMouseButton(2)).toBe("mouse2");
    expect(sourceKeyFromMouseButton(3)).toBe("mouse4");
    expect(sourceKeyFromMouseButton(4)).toBe("mouse5");
    expect(sourceKeyFromMouseButton(-1)).toBeNull();
    expect(sourceKeyFromMouseButton(5)).toBeNull();
    expect(sourceKeyFromCode("Semicolon")).toBe("semicolin");
    expect(sourceKeyFromCode("Numpad0")).toBe("kp_ins");
  });

  it("preserves the synthetic Mouse0-Mouse4 code fallback", () => {
    expect(["Mouse0", "Mouse1", "Mouse2", "Mouse3", "Mouse4"].map(sourceKeyFromCode)).toEqual([
      "mouse1",
      "mouse2",
      "mouse3",
      "mouse4",
      "mouse5",
    ]);
  });

  it("falls back to KeyboardEvent.key when a WebView omits code", () => {
    expect(sourceKeyFromKeyboardEvent({ code: "", key: "Shift" })).toBe("shift");
    expect(sourceKeyFromKeyboardEvent({ code: "Unidentified", key: "W" })).toBe("w");
    expect(sourceKeyFromKey("F12")).toBe("f12");
  });

  it("maps punctuation and shifted punctuation when code is unavailable", () => {
    expect(sourceKeyFromKeyboardEvent({ code: "", key: ";" })).toBe("semicolin");
    expect(sourceKeyFromKeyboardEvent({ code: "Unidentified", key: ":" })).toBe("semicolin");
    expect(sourceKeyFromKey("?")).toBe("slash");
    expect(sourceKeyFromKey("+")).toBe("equal");
    expect(sourceKeyFromKey("{")).toBe("[");
  });

  it("uses location to preserve numpad identity without code", () => {
    expect(sourceKeyFromKeyboardEvent({ code: "", key: "1", location: 3 })).toBe("kp_end");
    expect(sourceKeyFromKeyboardEvent({ code: "Unidentified", key: "End", location: 3 })).toBe(
      "kp_end",
    );
    expect(sourceKeyFromKeyboardEvent({ code: "", key: "+", location: 3 })).toBe("kp_plus");
    expect(sourceKeyFromKeyboardEvent({ code: "", key: "Delete", location: 3 })).toBe("kp_del");
  });
});

describe("managed execs_binds.cfg", () => {
  it("tracks common TF2 weapon, communication, and utility actions", () => {
    const actionIds = new Set<string>(BIND_ACTIONS.map((action) => action.id));
    for (const id of [
      "invnext",
      "lastinv",
      "slot1",
      "slot3",
      "showscores",
      "voicemenu1",
      "teamchat",
      "actionslot",
      "taunt",
      "backpack",
    ]) {
      expect(actionIds.has(id)).toBe(true);
    }
    const text = serializeManagedBinds({
      slot1: "1",
      showscores: "tab",
      spray: "t",
      voicemenu1: "z",
    });
    expect(text).toContain("bind 1 slot1");
    expect(text).toContain("bind tab +showscores");
    expect(text).toContain('bind t "impulse 201"');
    expect(managedKeysByAction(text)).toEqual({
      slot1: ["1"],
      showscores: ["tab"],
      spray: ["t"],
      voicemenu1: ["z"],
    });
  });

  it("serializes and parses tracked binds", () => {
    const text = serializeManagedBinds({
      forward: "w",
      back: "s",
      medic: "e",
    });
    expect(text.startsWith(`${MANAGED_BINDS_HEADER}\n`)).toBe(true);
    expect(text).toContain("bind w +forward");
    expect(text).toContain("bind s +back");
    expect(text).toContain('bind e "voicemenu 0 0"');
    expect(managedKeysByAction(text)).toEqual({
      forward: ["w"],
      back: ["s"],
      medic: ["e"],
    });
  });

  it("never generates unbindall and retains a line supplied through Files", () => {
    const written = serializeManagedBinds({
      forward: "w",
      jump: "space",
      medic: "e",
      loadout0: "1",
    });
    const recorded = applyRecordedBind(written, "medic", "h");
    const dirty = `${written}unbindall\nbind mouse1 +attack\n`;
    const synced = syncTrackedBindsFromConfig(dirty, {
      h: "voicemenu 0 0",
      w: "+forward",
    });
    for (const text of [written, recorded]) {
      expect(text.toLowerCase()).not.toContain("unbindall");
    }
    expect(synced).toContain("unbindall\n");
  });
});

describe("ensureAutoexecExecLine", () => {
  it("appends the exec line once with the managed comment", () => {
    const first = ensureAutoexecExecLine("fov_desired 90\n", "execs_binds", "vanilla");
    expect(first).toContain("fov_desired 90");
    expect(first).toContain("exec execs_binds // execs:managed");
    expect(ensureAutoexecExecLine(first, "execs_binds", "vanilla")).toBe(first);
    expect(autoexecHasExecLine(first, "execs_binds", "vanilla")).toBe(true);
    expect(autoexecHasExecLine(first, "execs_gameplay", "vanilla")).toBe(false);

    const withGameplay = ensureAutoexecExecLine(first, "execs_gameplay", "vanilla");
    expect(withGameplay).toContain("exec execs_gameplay // execs:managed");
    expect(ensureAutoexecExecLine(withGameplay, "execs_binds", "vanilla")).toBe(withGameplay);
  });

  it("prefixes overrides on the comfig layer and migrates bare managed lines", () => {
    // The engine resolves exec targets from tf/cfg, so the comfig layer must
    // address overrides/ explicitly.
    const fresh = ensureAutoexecExecLine("", "execs_binds", "comfig");
    expect(fresh).toBe("exec overrides/execs_binds // execs:managed\n");
    expect(autoexecHasExecLine(fresh, "execs_binds", "comfig")).toBe(true);
    // A bare managed line written before the fix silently failed in game;
    // it migrates in place instead of duplicating.
    const legacy =
      "exec execs_binds // execs:managed\nexec execs_gameplay // execs:managed\nhost_writeconfig\n";
    const migrated = ensureAutoexecExecLine(legacy, "execs_binds", "comfig");
    expect(migrated).toContain("exec overrides/execs_binds // execs:managed");
    expect(migrated).not.toContain("exec execs_binds // execs:managed");
    expect(migrated).toContain("exec execs_gameplay // execs:managed");
    expect(migrated.match(/execs_binds/g)?.length).toBe(1);
  });
});

describe("syncTrackedBindsFromConfig", () => {
  it("preserves unrelated managed-file lines byte-for-byte across a config drift", () => {
    const current = [
      MANAGED_BINDS_HEADER,
      "bind w +forward",
      "// user note: leave this alone",
      'alias customjump "+jump; +duck"',
      "echo custom startup command",
      'bind q "customjump"',
      "",
    ].join("\n");
    const next = syncTrackedBindsFromConfig(current, {
      w: "+back",
      h: "voicemenu 0 0",
    });
    expect(next).toContain("bind w +back\n");
    expect(next).toContain('bind h "voicemenu 0 0"\n');
    expect(next).not.toContain("bind w +forward\n");
    expect(next).toContain(
      '// user note: leave this alone\nalias customjump "+jump; +duck"\necho custom startup command\nbind q "customjump"\n',
    );
    const recorded = applyRecordedBind(next, "jump", "mouse3");
    expect(recorded).toContain(
      '// user note: leave this alone\nalias customjump "+jump; +duck"\necho custom startup command\nbind q "customjump"\n',
    );
    expect(recorded.endsWith("bind mouse3 +jump\n")).toBe(true);
  });

  it("preserves inline-comment bind lines as user-owned and tracks both config keys", () => {
    const current = `bind w +forward // deliberate note\r\n// separate note\r\n`;
    const next = syncTrackedBindsFromConfig(current, {
      w: "+forward",
      up: "+forward",
    });
    expect(next.startsWith(current)).toBe(true);
    expect(next).toContain("bind up +forward\r\n");
    expect(ownedManagedBindKeys(next)).toEqual([
      { actionId: "forward", key: "w" },
      { actionId: "forward", key: "up" },
    ]);
  });
  it("updates the medic key when config.cfg moved it", () => {
    const current = serializeManagedBinds({ medic: "e", forward: "w" });
    const next = syncTrackedBindsFromConfig(current, {
      w: "+forward",
      h: "voicemenu 0 0",
    });
    expect(managedKeysByAction(next)).toEqual({ medic: ["h"], forward: ["w"] });

    const fromMap = syncTrackedBindsFromConfig(
      current,
      new Map([
        ["w", "+forward"],
        ["mouse3", "voicemenu 0 0"],
      ]),
    );
    expect(managedKeysByAction(fromMap).medic).toEqual(["mouse3"]);
  });

  it("removes managed assignments that are absent from the complete config map", () => {
    const current = serializeManagedBinds({ forward: "w", medic: "e", voice: "v" });
    const next = syncTrackedBindsFromConfig(current, {
      w: "+forward",
      e: "+use",
      mouse1: "+attack",
    });

    expect(managedKeysByAction(next)).toEqual({
      forward: ["w"],
      use: ["e"],
      attack: ["mouse1"],
    });
  });

  it("clears every tracked assignment when the complete config map is empty", () => {
    const current = serializeManagedBinds({ forward: "w", medic: "e" });

    expect(syncTrackedBindsFromConfig(current, {})).toBe(`${MANAGED_BINDS_HEADER}\n`);
  });

  it("handles moves, reassignments, swaps, and multiple keys in one sync", () => {
    const current = serializeManagedBinds({
      forward: "w",
      back: "s",
      duck: "ctrl",
      medic: "e",
    });
    const next = syncTrackedBindsFromConfig(
      current,
      new Map([
        ["w", "+back"],
        ["s", "+forward"],
        ["ctrl", "+duck"],
        ["e", "+use"],
        ["h", "voicemenu 0 0"],
        ["j", "  VOICEMENU   0  0  "],
        ["mouse1", "+attack"],
      ]),
    );

    expect(managedKeysByAction(next)).toEqual({
      forward: ["s"],
      back: ["w"],
      duck: ["ctrl"],
      medic: ["h", "j"],
      use: ["e"],
      attack: ["mouse1"],
    });
  });

  it("leaves an already-synced managed file byte-for-byte unchanged", () => {
    const current = `${serializeManagedBinds({ forward: "w", medic: "e", attack: "mouse1" })}\n`;

    expect(
      syncTrackedBindsFromConfig(current, {
        mouse1: "+attack",
        w: "+forward",
        e: "voicemenu 0 0",
      }),
    ).toBe(current);
  });

  it("reads config.cfg binds and ignores the managed overlay file", () => {
    expect(
      configBindsFromFiles([
        {
          path: "tf/cfg/overrides/execs_binds.cfg",
          text: 'bind e "voicemenu 0 0"\nbind w +forward\n',
        },
        {
          path: "tf/cfg/config.cfg",
          text: 'bind h "voicemenu 0 0"\nbind w +forward\n',
        },
      ]),
    ).toEqual({
      h: "voicemenu 0 0",
      w: "+forward",
    });
  });

  it("is requested only after verified config drift and never while TF2 runs", () => {
    expect(shouldSyncTrackedBinds(null, false)).toBe(false);
    expect(shouldSyncTrackedBinds(1, false)).toBe(true);
    expect(shouldSyncTrackedBinds(1, true)).toBe(false);
  });
});

describe("canRecordBinds", () => {
  it("is false when TF2 is running", () => {
    expect(canRecordBinds(true, false)).toBe(false);
    expect(canRecordBinds(false, false)).toBe(true);
    expect(canRecordBinds(false, true)).toBe(false);
  });
});

describe("display and paths", () => {
  it("keeps both keys on add and removes only a selected execs-owned key", () => {
    const original = `${MANAGED_BINDS_HEADER}\nbind space +jump\n// retain this\n`;
    const withSecond = applyRecordedBind(original, "jump", "mouse3");
    expect(ownedManagedBindKeys(withSecond)).toEqual([
      { actionId: "jump", key: "space" },
      { actionId: "jump", key: "mouse3" },
    ]);
    expect(
      actionBindings(
        { space: "+jump", mouse3: "+jump", w: "+forward" },
        {
          space: { file: "tf/cfg/config.cfg", line: 5 },
          mouse3: { file: "tf/cfg/execs_binds.cfg", line: 4 },
        },
        withSecond,
        "tf/cfg/execs_binds.cfg",
        "jump",
      ),
    ).toEqual([
      { key: "space", source: { file: "tf/cfg/config.cfg", line: 5 }, owned: false },
      { key: "mouse3", source: { file: "tf/cfg/execs_binds.cfg", line: 4 }, owned: true },
    ]);
    expect(removeOwnedManagedBind(withSecond, "jump", "mouse3")).toBe(original);
  });

  it("records combat actions while retaining other managed bindings", () => {
    let text = serializeManagedBinds({ forward: "w", medic: "e", loadout2: "f3" });
    text = applyRecordedBind(text, "attack", "mouse1");
    text = applyRecordedBind(text, "attack2", "mouse2");
    text = applyRecordedBind(text, "reload", "r");
    expect(managedKeysByAction(text)).toEqual({
      forward: ["w"],
      medic: ["e"],
      loadout2: ["f3"],
      attack: ["mouse1"],
      attack2: ["mouse2"],
      reload: ["r"],
    });
    expect(text).not.toContain("unbind");
    expect(
      actionBindings(
        { mouse1: "+attack; say_team pushing" },
        {},
        "",
        "tf/cfg/execs_binds.cfg",
        "attack",
      ),
    ).toEqual([]);
  });

  it("places the owned file on the comfig or vanilla layer", () => {
    expect(bindsFilePath("comfig")).toBe("tf/cfg/overrides/execs_binds.cfg");
    expect(bindsFilePath("vanilla")).toBe("tf/cfg/execs_binds.cfg");
    expect(autoexecFilePath("comfig")).toBe("tf/cfg/overrides/autoexec.cfg");
    expect(autoexecFilePath("vanilla")).toBe("tf/cfg/autoexec.cfg");
  });
});

describe("recorderOutcomeForKey", () => {
  it("explains keys TF2 has no name for instead of going silent", () => {
    expect(recorderOutcomeForKey(sourceKeyFromKey("MediaPlayPause"))).toEqual({
      kind: "unbindable",
      message: UNBINDABLE_KEY_MESSAGE,
    });
    expect(recorderOutcomeForKey(sourceKeyFromMouseButton(6))).toEqual({
      kind: "unbindable",
      message: UNBINDABLE_KEY_MESSAGE,
    });
  });

  it("cancels on escape", () => {
    expect(recorderOutcomeForKey("escape")).toEqual({ kind: "cancel" });
  });

  it("binds any other resolved key", () => {
    expect(recorderOutcomeForKey("mouse5")).toEqual({ kind: "bind", key: "mouse5" });
  });
});

describe("bind action catalog", () => {
  it("places every action in exactly one group", () => {
    const grouped = BIND_GROUPS.flatMap((group) => group.ids);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(BIND_ACTIONS.map((action) => action.id).sort());
  });

  it("gives every action a distinct command so saved lines map back to one action", () => {
    const commands = BIND_ACTIONS.map((action) => normalizeBindCommand(action.command));
    expect(new Set(commands).size).toBe(commands.length);
    expect(bindActionForCommand("VoiceMenu 1  1")?.id).toBe("spy");
    expect(bindActionForCommand("+showscores")?.label).toBe("Scoreboard");
    expect(bindActionForCommand("echo hi")).toBeUndefined();
  });

  it("records the new voice commands and screenshot as standalone managed lines", () => {
    let text = applyRecordedBind("", "thanks", "kp_end");
    text = applyRecordedBind(text, "screenshot", "f5");
    expect(text).toContain('bind kp_end "voicemenu 0 1"');
    expect(text).toContain("bind f5 screenshot");
    expect(ownedManagedBindKeys(text)).toEqual([
      { actionId: "thanks", key: "kp_end" },
      { actionId: "screenshot", key: "f5" },
    ]);
  });
});

describe("bind key labels", () => {
  it("names keys the way they read on a keyboard and mouse", () => {
    expect(bindKeyLabel("space")).toBe("Space");
    expect(bindKeyLabel("w")).toBe("W");
    expect(bindKeyLabel("f12")).toBe("F12");
    expect(bindKeyLabel("mouse4")).toBe("Mouse 4");
    expect(bindKeyLabel("MWHEELDOWN")).toBe("Wheel down");
    expect(bindKeyLabel("kp_end")).toBe("Num 1");
    expect(bindKeyLabel("kp_enter")).toBe("Num Enter");
    expect(bindKeyLabel("semicolin")).toBe(";");
    expect(bindKeyLabel("backslash")).toBe("\\");
    // Unknown engine names stay readable rather than disappearing.
    expect(bindKeyLabel("joy1")).toBe("joy1");
  });
});

describe("bind search", () => {
  const none = () => [] as string[];

  it("matches names, groups, commands and player words", () => {
    expect([...searchBindActions("scoreboard", none)]).toEqual(["showscores"]);
    expect([...searchBindActions("uber", none)]).toEqual(["activatecharge"]);
    expect(searchBindActions("voice", none).has("battlecry")).toBe(true);
    expect([...searchBindActions("load_itempreset 2", none)]).toEqual(["loadout2"]);
  });

  it("finds an action by the key bound to it, by engine name or label", () => {
    const keys = (id: string) => (id === "reload" ? ["kp_end"] : []);
    expect([...searchBindActions("kp_end", keys)]).toEqual(["reload"]);
    expect([...searchBindActions("num 1", keys)]).toEqual(["reload"]);
  });

  it("requires every word and matches nothing for an unrelated search", () => {
    expect([...searchBindActions("weapon slot 3", none)]).toEqual(["slot3"]);
    expect(searchBindActions("zzz", none).size).toBe(0);
  });
});

describe("clearing one key", () => {
  const managed = `${MANAGED_BINDS_HEADER}\r\n// mine\r\nbind shift +jump\r\nbind f "say gg; +attack"\r\n`;

  it("replaces the pane's lines for that key with one unbind and keeps everything else", () => {
    expect(clearManagedKey(managed, "SHIFT")).toBe(
      `${MANAGED_BINDS_HEADER}\r\n// mine\r\nbind f "say gg; +attack"\r\nunbind shift\r\n`,
    );
    expect(clearManagedKey("", "space")).toBe(`${MANAGED_BINDS_HEADER}\nunbind space\n`);
    // Clearing twice leaves one unbind, and never an unbindall.
    const twice = clearManagedKey(clearManagedKey(managed, "shift"), "shift");
    expect(ownedManagedUnbindKeys(twice)).toEqual(["shift"]);
    expect(twice).not.toContain("unbindall");
  });

  it("treats only standalone unbind lines as the pane's own", () => {
    const text = "unbind q // keep\nunbind e; bind e +use\nunbind r\n";
    expect(ownedManagedUnbindKeys(text)).toEqual(["r"]);
  });

  it("drops the pane's unbind when the key is recorded again", () => {
    expect(applyRecordedBind(`${MANAGED_BINDS_HEADER}\nunbind space\n`, "jump", "space")).toBe(
      `${MANAGED_BINDS_HEADER}\nbind space +jump\n`,
    );
  });

  it("keeps a cleared key after a game session unless TF2 bound it again", () => {
    const text = `${MANAGED_BINDS_HEADER}\nunbind space\nbind w +forward\n`;
    expect(syncTrackedBindsFromConfig(text, { w: "+forward" })).toBe(text);
    expect(syncTrackedBindsFromConfig(text, { w: "+forward", space: "+jump" })).toBe(
      `${MANAGED_BINDS_HEADER}\nbind w +forward\nbind space +jump\n`,
    );
  });
});
