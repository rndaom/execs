import { describe, expect, it } from "vitest";
import {
  applyRecordedBind,
  autoexecFilePath,
  autoexecHasExecLine,
  bindsFilePath,
  canRecordBinds,
  configBindsFromFiles,
  displayedKeyForAction,
  ensureAutoexecExecLine,
  keyForAction,
  lastKeyForCommand,
  MANAGED_BINDS_HEADER,
  parseManagedBinds,
  serializeManagedBinds,
  shouldSyncTrackedBinds,
  sourceKeyFromCode,
  sourceKeyFromKey,
  sourceKeyFromKeyboardEvent,
  sourceKeyFromMouseButton,
  syncTrackedBindsFromConfig,
} from "./binds-ui";

describe("source key mapping", () => {
  it("maps Space, KeyW, Mouse0, and ShiftLeft", () => {
    expect(sourceKeyFromCode("Space")).toBe("space");
    expect(sourceKeyFromCode("KeyW")).toBe("w");
    expect(sourceKeyFromCode("Mouse0")).toBe("mouse1");
    expect(sourceKeyFromCode("ShiftLeft")).toBe("shift");
  });

  it("maps keyboard events and mouse buttons the pane will see", () => {
    expect(sourceKeyFromKeyboardEvent({ code: "KeyW" })).toBe("w");
    expect(sourceKeyFromKeyboardEvent({ code: "KeyW", repeat: true })).toBeNull();
    expect(sourceKeyFromMouseButton(0)).toBe("mouse1");
    expect(sourceKeyFromCode("Semicolon")).toBe("semicolin");
    expect(sourceKeyFromCode("Numpad0")).toBe("kp_ins");
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
    expect(parseManagedBinds(text)).toEqual({
      forward: "w",
      back: "s",
      medic: "e",
    });
  });

  it("never contains unbindall", () => {
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
    for (const text of [written, recorded, synced]) {
      expect(text.toLowerCase()).not.toContain("unbindall");
    }
  });
});

describe("ensureAutoexecExecLine", () => {
  it("appends the exec line once with the managed comment", () => {
    const first = ensureAutoexecExecLine("fov_desired 90\n", "execs_binds");
    expect(first).toContain("fov_desired 90");
    expect(first).toContain("exec execs_binds // execs:managed");
    expect(ensureAutoexecExecLine(first, "execs_binds")).toBe(first);
    expect(autoexecHasExecLine(first, "execs_binds")).toBe(true);
    expect(autoexecHasExecLine(first, "execs_gameplay")).toBe(false);

    const withGameplay = ensureAutoexecExecLine(first, "execs_gameplay");
    expect(withGameplay).toContain("exec execs_gameplay // execs:managed");
    expect(ensureAutoexecExecLine(withGameplay, "execs_binds")).toBe(withGameplay);
  });
});

describe("syncTrackedBindsFromConfig", () => {
  it("updates the medic key when config.cfg moved it", () => {
    const current = serializeManagedBinds({ medic: "e", forward: "w" });
    const next = syncTrackedBindsFromConfig(current, {
      w: "+forward",
      h: "voicemenu 0 0",
    });
    expect(parseManagedBinds(next)).toEqual({ medic: "h", forward: "w" });

    const fromMap = syncTrackedBindsFromConfig(
      current,
      new Map([
        ["w", "+forward"],
        ["mouse3", "voicemenu 0 0"],
      ]),
    );
    expect(parseManagedBinds(fromMap).medic).toBe("mouse3");
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
  it("maps command to the last matching key", () => {
    const binds = {
      e: "voicemenu 0 0",
      h: "voicemenu 0 0",
      w: "+forward",
    };
    expect(lastKeyForCommand(binds, "voicemenu 0 0")).toBe("h");
    expect(keyForAction(binds, "medic")).toBe("h");
    expect(keyForAction(binds, "forward")).toBe("w");
  });

  it("shows a newly recorded managed bind over stale config.cfg data", () => {
    const effective = { ctrl: "+duck" };
    const managed = parseManagedBinds(applyRecordedBind("", "duck", "shift"));
    expect(displayedKeyForAction(effective, managed, "duck")).toBe("shift");
  });

  it("masks keys claimed by another managed action from stale effective data", () => {
    const effective = { shift: "+duck", ctrl: "+duck" };
    const managed = parseManagedBinds(applyRecordedBind("", "voice", "shift"));
    expect(displayedKeyForAction(effective, managed, "voice")).toBe("shift");
    expect(displayedKeyForAction(effective, managed, "duck")).toBe("ctrl");
    expect(displayedKeyForAction({ shift: "+duck" }, managed, "duck")).toBeNull();
  });

  it("places the owned file on the comfig or vanilla layer", () => {
    expect(bindsFilePath("comfig")).toBe("tf/cfg/overrides/execs_binds.cfg");
    expect(bindsFilePath("vanilla")).toBe("tf/cfg/execs_binds.cfg");
    expect(autoexecFilePath("comfig")).toBe("tf/cfg/overrides/autoexec.cfg");
    expect(autoexecFilePath("vanilla")).toBe("tf/cfg/autoexec.cfg");
  });
});
