import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertLinuxNativeFixture,
  linuxNativeEnvironment,
  regularTreeHashes,
  seedLinuxNativeFixture,
} from "./linux-native-fixture.mjs";
import { assertNativeRuntime } from "./linux-native-smoke.mjs";
import {
  assertMenuGeometry,
  classifyClickTrace,
  ELEMENT_KEY,
  NativeWebDriver,
  waitUntil,
} from "./linux-native-webdriver.mjs";
import { assertNoSteamDirectories, linuxSteamCandidates } from "./package-smoke-fixture.mjs";

function withFixture(callback) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "execs-linux-native-test-")));
  try {
    callback(seedLinuxNativeFixture(parent), parent);
  } finally {
    // Only the fresh, checked direct child belongs to this test on Windows too.
    assert.equal(dirname(parent), realpathSync(tmpdir()));
    assert.ok(basename(parent).startsWith("execs-linux-native-test-"));
    rmSync(parent, { recursive: true, force: true });
  }
}

function editJson(path, change) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  change(value);
  writeFileSync(path, JSON.stringify(value));
}

test("native fixture is a fresh inactive six-profile library with owned payloads and isolated HOME", () => {
  withFixture((fixture, parent) => {
    assert.equal(dirname(fixture.scratch), parent);
    assert.notEqual(seedLinuxNativeFixture(parent).scratch, fixture.scratch);
    assert.equal(fixture.metadata["index.json"].activeProfileId, null);
    assert.equal(new Set(fixture.metadata["index.json"].profiles.map(({ id }) => id)).size, 6);
    assert.equal(fixture.provenance.exporterTag, "v0.1.8");
    assert.match(fixture.provenance.authored, /not an upgrade test/);
    assert.equal(fixture.settings.preferences.checkForUpdatesOnStartup, false);
    for (const path of Object.values(fixture.childEnv))
      assert.equal(dirname(path), fixture.scratch);
    assertNoSteamDirectories(linuxSteamCandidates(fixture.childEnv));
    assert.equal(assertLinuxNativeFixture(fixture, "system", "fresh").profiles, 6);
    assert.throws(() => seedLinuxNativeFixture("relative"), /must be absolute/);
  });
});

test("native fixture permits the expected preference write but refuses any other settings change", () => {
  withFixture((fixture) => {
    editJson(join(fixture.data, "settings.json"), (settings) => {
      settings.preferences.motion = "reduce";
    });
    assertLinuxNativeFixture(fixture, "reduce", "saved-by-ui");
    assert.throws(
      () => assertLinuxNativeFixture(fixture, "system", "unexpected-motion"),
      /persisted user data changed/,
    );
    editJson(join(fixture.data, "settings.json"), (settings) => {
      settings.preferences.checkForUpdatesOnStartup = true;
    });
    assert.throws(
      () => assertLinuxNativeFixture(fixture, "reduce", "unexpected-update-setting"),
      /persisted user data changed/,
    );
  });
});

test("native fixture refuses profile activation, lost library bytes and changed live files", () => {
  for (const mutate of [
    (fixture) =>
      editJson(join(fixture.library, "index.json"), (index) => {
        index.activeProfileId = index.profiles[0].id;
      }),
    (fixture) => {
      const path = Object.keys(fixture.libraryHashes).find(
        (path) => !Object.hasOwn(fixture.metadata, path),
      );
      rmSync(join(fixture.library, path));
    },
    (fixture) => writeFileSync(join(fixture.tf2Root, "tf/cfg/config.cfg"), "unexpected change\n"),
  ]) {
    withFixture((fixture) => {
      mutate(fixture);
      assert.throws(() => assertLinuxNativeFixture(fixture, "system", "preservation"));
    });
  }
});

test("native fixture refuses a linked input parent and linked payload tree", () => {
  withFixture((fixture, parent) => {
    const target = join(fixture.scratch, "link-target");
    mkdirSync(target);
    const link = join(parent, "redirected-parent");
    symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => seedLinuxNativeFixture(link), /must not be a link/);
    symlinkSync(
      target,
      join(fixture.library, "redirected-payload"),
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.throws(() => regularTreeHashes(fixture.library), /contains a link/);
    assert.throws(() => assertLinuxNativeFixture(fixture, "system", "linked"), /contains a link/);
  });
});

test("native child environment keeps display access and excludes runner secrets and host data", () => {
  withFixture((fixture) => {
    const env = linuxNativeEnvironment(fixture, {
      PATH: "/usr/bin",
      DISPLAY: ":99",
      XAUTHORITY: "/tmp/owned-xauth",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/owned-bus",
      HOME: "/home/runner",
      XDG_DATA_HOME: "/home/runner/shared",
      GH_TOKEN: "sensitive",
      HTTP_PROXY: "http://proxy.invalid",
      WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS: "1",
      TAURI_WEBVIEW_AUTOMATION: "true",
      CI: "true",
    });
    assert.equal(env.DISPLAY, ":99");
    assert.equal(env.PATH, "/usr/bin");
    assert.equal(env.HOME, fixture.childEnv.HOME);
    assert.equal(env.XDG_DATA_HOME, fixture.childEnv.XDG_DATA_HOME);
    assert.equal(env.GDK_BACKEND, "x11");
    for (const key of [
      "GH_TOKEN",
      "HTTP_PROXY",
      "WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS",
      "TAURI_WEBVIEW_AUTOMATION",
      "CI",
    ]) {
      assert.equal(Object.hasOwn(env, key), false, `${key} must not reach the native process`);
    }
  });
});

test("native entry point refuses a non-CI process before creating or launching anything", () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./linux-native-smoke.mjs", import.meta.url))],
    {
      env: { ...process.env, CI: "false", GITHUB_ACTIONS: "false" },
      encoding: "utf8",
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot run on this platform|requires a disposable CI worker/);
});

test("native-origin assertion refuses browser preview even when it imitates the runtime property", () => {
  for (const href of [
    "tauri://localhost",
    "http://tauri.localhost/",
    "https://tauri.localhost/index.html",
  ]) {
    assertNativeRuntime({ native: true, href });
  }
  for (const state of [
    { native: false, href: "tauri://localhost" },
    { native: true, href: "http://localhost:1420" },
    { native: true, href: "tauri://localhost/?preview=ready" },
    { native: true, href: "https://tauri.localhost.attacker.invalid" },
  ])
    assert.throws(() => assertNativeRuntime(state));
});

const visibleMenu = () => ({
  open: true,
  profiles: 6,
  width: 960,
  height: 640,
  panel: { left: 300, top: 112, right: 944, bottom: 624, width: 644, height: 512 },
  focused: { left: 700, top: 550, right: 830, bottom: 582, width: 130, height: 32 },
  focusText: "Change install",
  focusHit: true,
  lastActionHit: true,
});

test("menu evidence checks clipping and hit testing instead of accepting off-screen CSS geometry", () => {
  assertMenuGeometry(visibleMenu());
  assertMenuGeometry(visibleMenu(), true);
  for (const change of [
    (state) => {
      state.panel.bottom = 700;
    },
    (state) => {
      state.panel.right = 1000;
    },
    (state) => {
      state.lastActionHit = false;
    },
    (state) => {
      state.profiles = 2;
    },
  ]) {
    const state = visibleMenu();
    change(state);
    assert.throws(() => assertMenuGeometry(state));
  }
  assert.throws(() => assertMenuGeometry({ ...visibleMenu(), focusHit: false }, true), /obscures/);
  assert.throws(
    () => assertMenuGeometry({ ...visibleMenu(), focusText: "Save" }, true),
    /Change install/,
  );
});

test("zoom input diagnosis distinguishes an off-target driver coordinate from an app hit-test failure", () => {
  const box = { left: 180, top: 80, right: 300, bottom: 120, width: 120, height: 40 };
  const events = [
    { type: "pointerdown", trusted: true, x: 240, y: 100, onTarget: true, box },
    { type: "click", trusted: true, x: 240, y: 100, onTarget: true, box },
  ];
  const trace = {
    expected: { box, width: 480, height: 320, hit: true },
    afterBox: box,
    events,
  };
  assert.equal(classifyClickTrace(trace), "on-target");
  assert.equal(
    classifyClickTrace({ ...trace, afterBox: { ...box, top: 100, bottom: 140 } }),
    "on-target",
  );
  assert.equal(
    classifyClickTrace({
      ...trace,
      events: events.map((event) => ({ ...event, x: 120, y: 50, onTarget: false })),
    }),
    "driver-coordinate-mismatch",
  );
  for (const changed of [
    { ...trace, events: [] },
    { ...trace, events: [events[1]] },
    { ...trace, events: [events[1], events[0]] },
    { ...trace, events: [{ ...events[0], trusted: false }, events[1]] },
    { ...trace, events: [events[0], { ...events[1], trusted: false }] },
    { ...trace, events: [{ ...events[0], onTarget: false }, events[1]] },
    { ...trace, events: [events[0], { ...events[1], onTarget: false }] },
    { ...trace, events: [{ ...events[0], x: 120 }, events[1]] },
    { ...trace, events: [events[0], { ...events[1], x: 120 }] },
    { ...trace, events: [{ ...events[0], box: { ...box, top: 100 } }, events[1]] },
    { ...trace, events: [events[0], { ...events[1], box: { ...box, top: 100 } }] },
    { ...trace, expected: { ...trace.expected, hit: false } },
  ])
    assert.throws(() => classifyClickTrace(changed));
});

// This is protocol contract testing only. It is not native runtime evidence.
async function withDriverServer(callback, handler) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const item = {
      method: request.method,
      path: request.url,
      body: raw ? JSON.parse(raw) : undefined,
    };
    requests.push(item);
    const result = handler?.(item) ?? { value: null };
    response.writeHead(result.status ?? 200, { "content-type": "application/json" });
    response.end(JSON.stringify({ value: result.value }));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  try {
    await callback(new NativeWebDriver(server.address().port), requests);
  } finally {
    await new Promise((done) => server.close(done));
  }
}

test("external WebDriver uses a real binary capability and standard native click/key commands", async () => {
  await withDriverServer(
    async (driver, requests) => {
      await driver.start("/owned/target/release/execs");
      await driver.click("#profile-name");
      await driver.key("=", true);
      await driver.read("return innerWidth;");
      await driver.close();
      assert.deepEqual(requests[0], {
        method: "POST",
        path: "/session",
        body: {
          capabilities: {
            alwaysMatch: {
              "tauri:options": { application: "/owned/target/release/execs", args: [] },
            },
          },
        },
      });
      assert.equal(requests[1].path, "/session/owned%2Fsession/timeouts");
      assert.deepEqual(requests[1].body, { implicit: 0, script: 10_000, pageLoad: 30_000 });
      assert.equal(requests[3].path, "/session/owned%2Fsession/element/name%2Finput/click");
      assert.deepEqual(requests[4].body.actions[0].actions, [
        { type: "keyDown", value: "\uE009" },
        { type: "keyDown", value: "=" },
        { type: "keyUp", value: "=" },
        { type: "keyUp", value: "\uE009" },
      ]);
      assert.deepEqual(requests[5].body, { script: "return innerWidth;", args: [] });
      assert.deepEqual(requests[6], {
        method: "DELETE",
        path: "/session/owned%2Fsession",
        body: undefined,
      });
      assert.equal(driver.sessionId, null);
    },
    ({ path }) => {
      if (path === "/session")
        return {
          value: { sessionId: "owned/session", capabilities: { browserName: "MiniBrowser" } },
        };
      if (path.endsWith("/element")) return { value: { [ELEMENT_KEY]: "name/input" } };
      return { value: null };
    },
  );
});

test("WebDriver errors remain failures and requests cannot select an arbitrary remote host", async () => {
  for (const port of [0, 65_536, "4444"]) assert.throws(() => new NativeWebDriver(port));
  await withDriverServer(
    async (driver) => {
      await assert.rejects(driver.request("GET", "https://example.invalid/session"));
      await assert.rejects(driver.request("GET", "/status"), /unsupported operation: unavailable/);
      assert.throws(() => driver.command("POST", "actions", {}), /has not started/);
    },
    () => ({ status: 500, value: { error: "unsupported operation", message: "unavailable" } }),
  );
});

test("native keyboard navigation uses bounded Tab input to reach the exact observed element", async () => {
  let reads = 0;
  await withDriverServer(
    async (driver, requests) => {
      driver.sessionId = "keyboard";
      assert.equal(await driver.tabTo("#profile-name"), 2);
      const keys = requests.filter(({ path }) => path.endsWith("/actions"));
      assert.equal(keys.length, 2);
      assert.deepEqual(keys[0].body.actions[0].actions, [
        { type: "keyDown", value: "\uE004" },
        { type: "keyUp", value: "\uE004" },
      ]);
    },
    ({ path }) => {
      if (path.endsWith("/element")) return { value: { [ELEMENT_KEY]: "profile-input" } };
      if (path.endsWith("/execute/sync")) return { value: ++reads === 3 };
      return { value: null };
    },
  );
  await withDriverServer(
    async (driver, requests) => {
      driver.sessionId = "keyboard";
      await assert.rejects(driver.tabTo("#missing-focus", "css selector", 2), /in 2 tabs/);
      assert.equal(requests.filter(({ path }) => path.endsWith("/actions")).length, 2);
    },
    ({ path }) =>
      path.endsWith("/element") ? { value: { [ELEMENT_KEY]: "hidden-input" } } : { value: false },
  );
});

test("bounded polling keeps the last failure and never turns timeout into a passing check", async () => {
  const failure = new Error("native geometry is clipped");
  await assert.rejects(
    waitUntil(
      "menu",
      () => {
        throw failure;
      },
      1,
    ),
    (error) => {
      assert.match(error.message, /Timed out: menu/);
      assert.equal(error.cause, failure);
      return true;
    },
  );
  assert.equal(await waitUntil("already ready", () => "ready", 1), "ready");
});
