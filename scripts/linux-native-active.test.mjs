import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { parseOwnedProcessRows, X11_CLOSE_HELPER } from "./linux-native-active-close.mjs";
import {
  assertEditorRetained,
  copyEditorText,
  KEYS,
  press,
  typeEditorText,
} from "./linux-native-active-input.mjs";
import { activeCaptureSettled, activeRuntimePreflight } from "./linux-native-active-runtime.mjs";

test("native key chords release modifiers after bounded repeated selection input", async () => {
  const calls = [];
  const driver = { command: async (...args) => calls.push(args) };
  await press(driver, KEYS.left, { control: true, shift: true, repeat: 2 });
  assert.deepEqual(calls, [
    [
      "POST",
      "actions",
      {
        actions: [
          {
            type: "key",
            id: "native-keyboard",
            actions: [
              { type: "keyDown", value: "\uE009" },
              { type: "keyDown", value: "\uE008" },
              { type: "keyDown", value: KEYS.left },
              { type: "keyUp", value: KEYS.left },
              { type: "keyDown", value: KEYS.left },
              { type: "keyUp", value: KEYS.left },
              { type: "keyUp", value: "\uE008" },
              { type: "keyUp", value: "\uE009" },
            ],
          },
        ],
      },
    ],
  ]);
  for (const repeat of [0, -1, 201, 1.5])
    await assert.rejects(press(driver, KEYS.down, { repeat }));
  await assert.rejects(press(driver, "two"));
  assert.equal(calls.length, 1);
});

test("native fixture typing requires focus and uses the W3C element input command", async () => {
  const calls = [];
  const driver = {
    element: async () => "editor/id",
    read: async () => true,
    command: async (...args) => calls.push(args),
  };
  await typeEditorText(driver, "// owned fixture\n");
  assert.deepEqual(calls, [
    [
      "POST",
      "element/editor%2Fid/value",
      { text: "// owned fixture\n", value: [..."// owned fixture\n"] },
    ],
  ]);
  await assert.rejects(
    typeEditorText({ ...driver, read: async () => false }, "// rejected"),
    /focused/,
  );
  for (const text of ["", "x".repeat(1025), "\uE009", "\0"])
    await assert.rejects(typeEditorText(driver, text));
  assert.equal(calls.length, 1);
});

const retained = {
  path: "Contents of tf/cfg/native-fixture.cfg",
  selectedFile: "native-fixture.cfg, unsaved. tf/cfg/native-fixture.cfg",
  focused: true,
  editable: true,
  position: "Ln 80, Col 355",
  selection: "SELECTION-A",
  top: 1600,
  left: 250,
};

test("retention requires actual selection and both nonzero editor scroll axes", () => {
  assertEditorRetained(retained, { ...retained, top: 1601, left: 249 });
  for (const patch of [
    { path: "Contents of wrong.cfg" },
    { selectedFile: "different profile" },
    { position: "Ln 1, Col 1" },
    { selection: "" },
    { top: 0 },
    { left: 0 },
    { focused: false },
    { editable: false },
  ])
    assert.throws(() => assertEditorRetained(retained, { ...retained, ...patch }));
  assert.throws(() => assertEditorRetained({ ...retained, top: 0 }, retained));
  assert.throws(() => assertEditorRetained({ ...retained, selection: "" }, retained));
});

test("native copy cannot pass from a stale clipboard without its trusted complete-text copy event", async () => {
  for (const trace of [
    [],
    [{ trusted: false, text: "expected" }],
    [{ trusted: true, text: "other" }],
  ]) {
    let reads = 0;
    const driver = {
      tabTo: async () => 0,
      command: async () => undefined,
      read: async () => (++reads === 1 ? undefined : trace),
    };
    await assert.rejects(copyEditorText(driver, {}, "expected"), /trusted copy event/);
    assert.equal(reads, 2);
  }
});

test("close ownership selects exactly one native process from the owned driver group", () => {
  const table = " 101 100 tauri-driver\n 102 100 WebKitNetworkPr\n 103 100 execs\n 201 200 execs\n";
  assert.deepEqual(parseOwnedProcessRows(table, 100), { pid: 103, processGroup: 100 });
  assert.throws(() => parseOwnedProcessRows(table, 300), /exactly one/);
  assert.throws(() => parseOwnedProcessRows(`${table} 104 100 execs\n`, 100), /exactly one/);
  assert.throws(() => parseOwnedProcessRows("1 100 execs\n", 100));
  assert.throws(() => parseOwnedProcessRows(table, 1));
});

test("active runner refuses non-Linux, non-CI and self-hosted environments before process access", () => {
  assert.throws(() => activeRuntimePreflight({}, "win32"), /requires Linux/);
  assert.throws(() => activeRuntimePreflight({}, "linux"), /requires CI/);
  assert.throws(() => activeRuntimePreflight({ CI: "true" }, "linux"), /GitHub Actions/);
  assert.throws(
    () =>
      activeRuntimePreflight(
        { CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "self-hosted" },
        "linux",
      ),
    /Self-hosted/,
  );
  assert.throws(
    () =>
      activeRuntimePreflight(
        { CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted" },
        "linux",
      ),
    /Xvfb/,
  );
});

test("capture ignores only infinite CodeMirror caret motion and waits for fonts and finite transitions", () => {
  const caret = { playState: "running", cursorLayer: true, infinite: true };
  const transition = { playState: "running", cursorLayer: false, infinite: false };
  assert.equal(activeCaptureSettled({ fontsReady: true, animations: [caret] }), true);
  assert.equal(activeCaptureSettled({ fontsReady: false, animations: [caret] }), false);
  assert.equal(activeCaptureSettled({ fontsReady: true, animations: [caret, transition] }), false);
  assert.equal(
    activeCaptureSettled({
      fontsReady: true,
      animations: [caret, { ...transition, playState: "finished" }],
    }),
    true,
  );
  assert.equal(
    activeCaptureSettled({ fontsReady: true, animations: [{ ...caret, cursorLayer: false }] }),
    false,
  );
  assert.equal(
    activeCaptureSettled({ fontsReady: true, animations: [{ ...caret, infinite: false }] }),
    false,
  );
});

test("new runner's direct entry point refuses this local host before seeding or launching", {
  skip: process.platform === "linux" && process.env.GITHUB_ACTIONS === "true",
}, () => {
  const result = spawnSync(process.execPath, [resolve("scripts/linux-native-active.mjs")], {
    encoding: "utf8",
    env: { ...process.env, CI: "false" },
    timeout: 5_000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Active native smoke requires (Linux|CI)/);
});

test("the active X11 request helper compiles with the Linux runner's Python", {
  skip: process.platform !== "linux",
}, () => {
  const result = spawnSync(
    "python3",
    ["-c", "import sys; compile(sys.stdin.read(), '<active-close-helper>', 'exec')"],
    { input: X11_CLOSE_HELPER, encoding: "utf8", timeout: 5_000 },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});
