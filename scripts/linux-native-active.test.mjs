import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import {
  parseOwnedProcessRows,
  selectOwnedMainWindow,
  X11_CLOSE_HELPER,
  X11_MAIN_WINDOW_SELECTOR,
} from "./linux-native-active-close.mjs";
import {
  assertEditorRetained,
  copyEditorText,
  copyTextDiagnostic,
  KEYS,
  nativeErrorDiagnostic,
  press,
  tabToEditorWithTrace,
  typeEditorText,
  waitForEditorRetention,
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

test("native fixture typing requires focus and sends the trailing newline as a real Enter key", async () => {
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
      { text: "// owned fixture", value: [..."// owned fixture"] },
    ],
    [
      "POST",
      "actions",
      {
        actions: [
          {
            type: "key",
            id: "native-keyboard",
            actions: [
              { type: "keyDown", value: KEYS.enter },
              { type: "keyUp", value: KEYS.enter },
            ],
          },
        ],
      },
    ],
  ]);
  await assert.rejects(
    typeEditorText({ ...driver, read: async () => false }, "// rejected"),
    /focused/,
  );
  for (const text of ["", "x".repeat(1025), "\uE009", "\0"])
    await assert.rejects(typeEditorText(driver, text));
  assert.equal(calls.length, 2);
});

test("native multiline input preserves leading and consecutive LF through explicit Enter actions", async () => {
  const calls = [];
  const driver = {
    element: async () => "editor",
    read: async () => true,
    command: async (...args) => calls.push(args),
  };
  await typeEditorText(driver, "\n// next\n\n");
  assert.deepEqual(
    calls.map(([, path]) => path),
    ["actions", "element/editor/value", "actions", "actions"],
  );
  assert.equal(calls[1][2].text, "// next");
  for (const [, path, body] of calls) {
    if (path === "actions")
      assert.deepEqual(body.actions[0].actions, [
        { type: "keyDown", value: KEYS.enter },
        { type: "keyUp", value: KEYS.enter },
      ]);
  }
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

test("native Tab diagnostics retain the focus destination that changes editor scroll", async () => {
  const steps = [
    { ...retained, focused: false, activeElement: { label: "Files" } },
    { ...retained, focused: false, activeElement: { label: "Save" } },
    { ...retained, top: 0, left: 0, activeElement: { label: retained.path } },
  ];
  let reads = 0;
  const commands = [];
  const driver = {
    read: async () => steps[reads++],
    command: async (...args) => commands.push(args),
  };
  const diagnostic = {};
  assert.equal(await tabToEditorWithTrace(driver, diagnostic), 2);
  assert.deepEqual(
    diagnostic.tabTraversal,
    steps.map((state, tabs) => ({ tabs, state })),
  );
  assert.equal(commands.length, 2);
  for (const [method, path, body] of commands) {
    assert.equal(method, "POST");
    assert.equal(path, "actions");
    assert.deepEqual(body.actions[0].actions, [
      { type: "keyDown", value: KEYS.tab },
      { type: "keyUp", value: KEYS.tab },
    ]);
  }
  await assert.rejects(tabToEditorWithTrace(driver, {}, 81));
});

test("a failed retention wait preserves its last geometry and nested assertion without relaxing it", async () => {
  const after = { ...retained, top: 0, left: 0 };
  const diagnostic = {};
  await assert.rejects(
    waitForEditorRetention({ read: async () => after }, retained, diagnostic, 0),
    (error) => {
      assert.match(error.message, /Timed out: draft selection and scroll restored/);
      assert.match(error.cause.message, /Editor top scroll was not retained/);
      return true;
    },
  );
  assert.deepEqual(diagnostic.polls, [after]);
  assert.equal(diagnostic.pollCount, 1);
  assert.match(diagnostic.lastAssertion.message, /Editor top scroll was not retained/);
  assert.equal(diagnostic.error.cause.message, diagnostic.lastAssertion.message);
  assert.deepEqual(
    await waitForEditorRetention({ read: async () => retained }, retained, {}, 0),
    retained,
  );
});

test("native error diagnostics bound an unexpectedly cyclic cause chain", () => {
  const error = new Error("x".repeat(10_000));
  error.cause = error;
  const diagnostic = nativeErrorDiagnostic(error);
  assert.equal(diagnostic.message.length, 2_048);
  assert.equal(diagnostic.stack.length, 8_192);
  assert.equal(diagnostic.cause.cause.cause.causeTruncated, true);
});

test("native copy cannot pass from a stale clipboard without its trusted complete-text copy event", async () => {
  for (const trace of [
    [],
    [{ trusted: false, text: "expected" }],
    [{ trusted: true, text: "other" }],
    [{ trusted: true, text: "expected", truncated: true }],
  ]) {
    let reads = 0;
    const driver = {
      tabTo: async () => 0,
      command: async () => undefined,
      read: async () => {
        reads++;
        return reads === 1 ? undefined : reads === 2 ? trace : { position: "Ln 130, Col 33" };
      },
    };
    await assert.rejects(
      copyEditorText(driver, {}, "expected", { readClipboard: () => "expected" }),
      (error) => {
        assert.match(error.message, /trusted copy event/);
        assert.equal(error.copyDiagnostics.expected.matchesExpected, true);
        assert.equal(error.copyDiagnostics.clipboard.matchesExpected, true);
        assert.equal(error.copyDiagnostics.events.length, trace.length);
        assert.equal(error.copyDiagnostics.editor.position, "Ln 130, Col 33");
        return true;
      },
    );
    assert.equal(reads, 3);
  }
});

test("copy diagnostics retain the exact missing trailing LF and bound recorded text without normalizing", () => {
  const mismatch = copyTextDiagnostic("// accepted", "// accepted\n");
  assert.equal(mismatch.matchesExpected, false);
  assert.equal(mismatch.characters, 11);
  assert.equal(mismatch.bytes, 11);
  assert.deepEqual(mismatch.firstDifference, {
    index: 11,
    actualCodePoint: null,
    expectedCodePoint: 10,
  });
  assert.notEqual(mismatch.sha256, copyTextDiagnostic("// accepted\n", "// accepted\n").sha256);
  assert.equal(mismatch.text, "// accepted");
  const bounded = copyTextDiagnostic("x".repeat(20_000), "expected");
  assert.equal(bounded.characters, 20_000);
  assert.equal(bounded.text.length, 16_384);
  assert.equal(bounded.truncated, true);
  assert.deepEqual(copyTextDiagnostic(null, "expected"), { available: false });
});

test("close ownership selects exactly one native process from the owned driver group", () => {
  const table = " 101 100 tauri-driver\n 102 100 WebKitNetworkPr\n 103 100 execs\n 201 200 execs\n";
  assert.deepEqual(parseOwnedProcessRows(table, 100), { pid: 103, processGroup: 100 });
  assert.throws(() => parseOwnedProcessRows(table, 300), /exactly one/);
  assert.throws(() => parseOwnedProcessRows(`${table} 104 100 execs\n`, 100), /exactly one/);
  assert.throws(() => parseOwnedProcessRows("1 100 execs\n", 100));
  assert.throws(() => parseOwnedProcessRows(table, 1));
});

const ownedMainWindow = {
  id: 400,
  pid: 103,
  title: "execs",
  deleteProtocol: true,
  protocolAtoms: [10, 11],
  mapState: 2,
  windowClass: 1,
  overrideRedirect: false,
  parent: 100,
  root: 100,
  transientFor: null,
  classHint: { name: "execs", class: "execs" },
  geometry: { x: 0, y: 0, width: 1200, height: 800, borderWidth: 0, depth: 24 },
};
const nonMainWindowPatches = [
  { pid: 104 },
  { title: "toolkit helper" },
  { deleteProtocol: false },
  { mapState: 0 },
  { mapState: 1 },
  { windowClass: 2 },
  { overrideRedirect: true },
  { parent: 200 },
  { transientFor: 400 },
  { geometry: { ...ownedMainWindow.geometry, width: 0 } },
  { geometry: { ...ownedMainWindow.geometry, height: 0 } },
];

test("native close selects one viewable main window while retaining unmapped candidate evidence", () => {
  const identity = { pid: 103, processGroup: 100, executable: "/owned/execs", startTime: "42" };
  const windows = [
    { ...ownedMainWindow, id: 401, mapState: 0 },
    ownedMainWindow,
    { ...ownedMainWindow, id: 402, mapState: 1 },
  ];
  const observations = [];
  // A window without the owned PID or close protocol is still present in the tree.
  const treeWindowIds = [100, 400, 401, 402, 900];
  const selected = selectOwnedMainWindow(
    { pid: 103, mode: "inspect", windows, treeWindowIds },
    identity,
    (value) => observations.push(value),
  );
  assert.equal(selected.id, 400);
  assert.deepEqual(selected.rejectionReasons, []);
  assert.deepEqual(observations[0].process, identity);
  assert.equal(observations[0].windows.length, 3);
  assert.deepEqual(observations[0].treeWindowIds, treeWindowIds);
  assert.equal(
    observations[0].windows.some((window) => window.id === 900),
    false,
  );
  assert.match(observations[0].windows[0].rejectionReasons.join(" "), /Not viewable/);
  assert.deepEqual(observations[0].windows[0].geometry, ownedMainWindow.geometry);
});

test("native close refuses ambiguous visible windows and every incomplete main-window proof", () => {
  const identity = { pid: 103 };
  const ambiguous = [ownedMainWindow, { ...ownedMainWindow, id: 401 }];
  let retained;
  assert.throws(
    () =>
      selectOwnedMainWindow({ pid: 103, windows: ambiguous }, identity, (value) => {
        retained = value;
      }),
    /single viewable owned main/,
  );
  assert.equal(retained.windows.length, 2);
  assert.ok(retained.windows.every((window) => window.rejectionReasons.length === 0));
  for (const patch of nonMainWindowPatches) {
    assert.throws(
      () =>
        selectOwnedMainWindow({ pid: 103, windows: [{ ...ownedMainWindow, ...patch }] }, identity),
      /single viewable owned main/,
    );
  }
  assert.throws(
    () => selectOwnedMainWindow({ pid: 104, windows: [ownedMainWindow] }, identity),
    /different process/,
  );
  assert.throws(
    () => selectOwnedMainWindow({ pid: 103, windows: [] }, identity),
    /single viewable owned main/,
  );
});

test("Python's pre-send X11 selector applies the same owned visible-window safety cases", {
  skip: process.platform !== "linux",
}, () => {
  const cases = [
    [ownedMainWindow, { ...ownedMainWindow, id: 401, mapState: 0 }],
    [ownedMainWindow, { ...ownedMainWindow, id: 401 }],
    ...nonMainWindowPatches.map((patch) => [{ ...ownedMainWindow, ...patch }]),
  ];
  const result = spawnSync(
    "python3",
    [
      "-c",
      `${X11_MAIN_WINDOW_SELECTOR}
import json, sys
print(json.dumps([[w['id'] for w in eligible_main_windows(windows, 103)] for windows in json.load(sys.stdin)]))`,
    ],
    {
      input: JSON.stringify(cases),
      encoding: "utf8",
      timeout: 5_000,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    [400],
    [400, 401],
    ...nonMainWindowPatches.map(() => []),
  ]);
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
