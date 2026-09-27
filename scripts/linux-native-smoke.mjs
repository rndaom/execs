import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertLinuxNativeFixture,
  linuxNativeEnvironment,
  seedLinuxNativeFixture,
} from "./linux-native-fixture.mjs";
import {
  assertMenuGeometry,
  classifyClickTrace,
  NativeWebDriver,
  waitUntil,
} from "./linux-native-webdriver.mjs";
import { assertNoSteamDirectories, linuxSteamCandidates } from "./package-smoke-fixture.mjs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const nativeState = `return {
  native: typeof window.__TAURI_INTERNALS__?.invoke === 'function',
  href: location.href, width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
  heading: document.querySelector('h1')?.textContent,
  motion: document.documentElement.dataset.motion ?? 'system',
  focusedTag: document.activeElement?.tagName,
  scrollX, scrollY,
  menuOpen: document.querySelector('[data-testid="profile-library"]')?.open ?? false
};`;
const menuState = `const panel = document.querySelector('.profile-menu-panel');
const last = panel ? Array.from(panel.querySelectorAll('button')).at(-1) : null;
const hit = (element) => {
  if (!element) return false;
  const r = element.getBoundingClientRect();
  return element.contains(document.elementFromPoint((r.left+r.right)/2, (r.top+r.bottom)/2));
};
return {
  width: innerWidth, height: innerHeight,
  open: document.querySelector('[data-testid="profile-library"]')?.open ?? false,
  profiles: document.querySelectorAll('[data-testid="profile-name"]').length,
  panel: panel?.getBoundingClientRect().toJSON(),
  focused: document.activeElement?.getBoundingClientRect().toJSON(),
  focusText: document.activeElement?.textContent.trim(),
  focusHit: hit(document.activeElement), lastActionHit: hit(last)
};`;

async function freePort() {
  const server = createServer();
  await new Promise((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveReady);
  });
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

export function assertNativeRuntime(state) {
  assert.ok(state.native, "The real Tauri IPC runtime is missing");
  const url = new URL(state.href);
  assert.ok(
    (url.protocol === "tauri:" && url.hostname === "localhost") ||
      (["http:", "https:"].includes(url.protocol) && url.hostname === "tauri.localhost"),
    `Expected bundled Tauri content, received ${state.href}`,
  );
  assert.equal(url.search, "", "Preview/query modes are forbidden in native smoke");
}

export async function main() {
  assert.equal(process.platform, "linux", "Native Linux smoke cannot run on this platform");
  assert.equal(process.env.CI, "true", "Native smoke requires a disposable CI worker");
  assert.equal(process.env.GITHUB_ACTIONS, "true", "Native smoke requires GitHub Actions");
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted", "Self-hosted workers are refused");
  assert.ok(
    process.env.DISPLAY && process.env.DBUS_SESSION_BUS_ADDRESS,
    "Use Xvfb and dbus-run-session",
  );
  const processes = execFileSync("ps", ["-A", "-o", "comm="], { encoding: "utf8" });
  assert.ok(
    !processes
      .split(/\r?\n/)
      .some((name) => /^(execs|steam|tf_linux64|tf_win64\.exe)$/.test(name.trim())),
    "Refusing existing execs, Steam or TF2 processes",
  );
  assertNoSteamDirectories(linuxSteamCandidates(process.env));
  const binary = resolve("apps/desktop/src-tauri/target/release/execs");
  assert.equal(realpathSync(binary), binary, "Native binary must not be redirected");
  const binaryBytes = readFileSync(binary);
  assert.equal(
    binaryBytes.subarray(0, 4).toString("hex"),
    "7f454c46",
    "Expected a Linux ELF binary",
  );
  const fixture = seedLinuxNativeFixture(process.env.RUNNER_TEMP);
  const childEnv = linuxNativeEnvironment(fixture, process.env);
  assertNoSteamDirectories(linuxSteamCandidates(childEnv));
  const evidence = join(fixture.scratch, "evidence");
  mkdirSync(evidence);
  const report = {
    schema: 1,
    status: "running",
    scope:
      "Linux X11/WebKitGTK no-bundle release binary; owned inactive library, global preferences and keyboard zoom. Not installer, updater, Steam or game qualification.",
    revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    binarySha256: createHash("sha256").update(binaryBytes).digest("hex"),
    fixture: fixture.provenance,
    isolation: fixture.childEnv,
    checks: [],
    captures: [],
    preservation: [assertLinuxNativeFixture(fixture, "system", "before-launch")],
  };
  writeFileSync(join(evidence, "fixture-baseline.json"), `${JSON.stringify(fixture, null, 2)}\n`);
  const saveReport = () =>
    writeFileSync(join(evidence, "results.json"), `${JSON.stringify(report, null, 2)}\n`);
  saveReport();
  let driverProcess;
  let driver;
  let log;
  let expectedMotion = "system";
  let smokeError;

  async function stopDriver() {
    if (driver) {
      try {
        await driver.close();
      } catch {
        /* Process-group cleanup remains mandatory. */
      }
      driver = null;
    }
    if (driverProcess?.pid) {
      const pid = driverProcess.pid;
      try {
        process.kill(-pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
      await waitUntil(
        "owned driver process group exit",
        () => {
          try {
            process.kill(-pid, 0);
            return false;
          } catch (error) {
            return error.code === "ESRCH";
          }
        },
        2_000,
      ).catch(() => {
        try {
          process.kill(-pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      });
      await waitUntil(
        "owned native processes stopped",
        () => {
          try {
            process.kill(-pid, 0);
            return false;
          } catch (error) {
            return error.code === "ESRCH";
          }
        },
        2_000,
      );
      driverProcess = null;
    }
    log?.end();
    log = null;
  }

  async function launch(label) {
    const port = await freePort();
    let nativePort = await freePort();
    while (nativePort === port) nativePort = await freePort();
    log = createWriteStream(join(evidence, `${label}-driver.log`), { flags: "wx" });
    driverProcess = spawn(
      "tauri-driver",
      ["--port", String(port), "--native-port", String(nativePort), "--native-host", "127.0.0.1"],
      {
        cwd: fixture.scratch,
        env: childEnv,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    driverProcess.stdout.pipe(log, { end: false });
    driverProcess.stderr.pipe(log, { end: false });
    let failure;
    driverProcess.once("error", (error) => {
      failure = error;
    });
    driver = new NativeWebDriver(port);
    await waitUntil("native driver ready", async () => {
      if (failure) throw failure;
      assert.equal(driverProcess.exitCode, null, "tauri-driver exited during startup");
      return (await driver.request("GET", "/status")).ready;
    });
    await driver.start(binary);
    const state = await waitUntil(
      "native inactive library",
      async () => {
        const state = await driver.read(nativeState);
        return state.heading === "Choose a profile" && state.native && state;
      },
      30_000,
    );
    assertNativeRuntime(state);
    report.checks.push({ label, state, capabilities: driver.capabilities });
    if (
      await driver.read('return Boolean(document.querySelector("[data-testid=release-notes]"));')
    ) {
      await driver.key("\uE00C");
    }
  }

  async function contentSize(width, height) {
    let outerWidth = width;
    let outerHeight = height;
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await driver.read(nativeState);
      await driver.command("POST", "window/rect", { width: outerWidth, height: outerHeight });
      const state = await waitUntil("native resize is rendered", async () => {
        const state = await driver.read(nativeState);
        return (
          ((Math.abs(state.width - width) <= 2 && Math.abs(state.height - height) <= 2) ||
            state.width !== before.width ||
            state.height !== before.height) &&
          state
        );
      });
      if (Math.abs(state.width - width) <= 2 && Math.abs(state.height - height) <= 2) return state;
      outerWidth += width - state.width;
      outerHeight += height - state.height;
    }
    throw new Error(`Native content did not reach ${width}×${height}`);
  }

  async function capture(name) {
    await waitUntil("native fonts and motion settled", () =>
      driver.read(`return document.fonts.status === 'loaded' &&
      document.getAnimations().every((animation) => animation.playState !== 'running');`),
    );
    let previous;
    let identical = 0;
    const { state, bytes } = await waitUntil("three stable native screenshot frames", async () => {
      await driver.nextPaint();
      const state = await driver.read(nativeState);
      const bytes = Buffer.from(await driver.command("GET", "screenshot"), "base64");
      assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      const unchanged =
        previous &&
        bytes.equals(previous.bytes) &&
        JSON.stringify(state) === JSON.stringify(previous.state);
      identical = unchanged ? identical + 1 : 1;
      previous = { state, bytes };
      return identical >= 3 && previous;
    });
    writeFileSync(join(evidence, `${name}.png`), bytes);
    report.captures.push({
      file: `${name}.png`,
      state,
      pixels: [bytes.readUInt32BE(16), bytes.readUInt32BE(20)],
      stableFrames: identical,
    });
    saveReport();
  }

  async function openMenu() {
    await driver.click("//button[normalize-space(.)='Choose profile']", "xpath");
    await waitUntil("six native profile rows", async () => {
      const state = await driver.read(menuState);
      return state.open && state.profiles === 6 && state;
    });
  }

  async function escapeMenu() {
    await driver.key("\uE00C");
    await waitUntil("menu Escape restores summary", async () => {
      const state = await driver.read(nativeState);
      return !state.menuOpen && state.focusedTag === "SUMMARY";
    });
  }

  try {
    await launch("first-launch");
    await contentSize(1200, 800);
    await capture("01-native-inactive-1200");
    await contentSize(960, 640);
    await openMenu();
    const minimumMenu = await waitUntil("unclipped native menu", async () => {
      const state = await driver.read(menuState);
      assertMenuGeometry(state);
      return state;
    });
    report.checks.push({ label: "inactive-six-profile-menu", state: minimumMenu });
    await capture("02-native-menu-960");
    await escapeMenu();

    const baseline = await driver.read(nativeState);
    const zoomSteps = [];
    for (let step = 0; step < 5; step++) {
      const before = await driver.read(nativeState);
      await driver.key("=", true);
      zoomSteps.push(
        await waitUntil("keyboard zoom changes native content size", async () => {
          const state = await driver.read(nativeState);
          return state.width < before.width - 5 && state;
        }),
      );
    }
    const zoomed = zoomSteps.at(-1);
    assert.ok(zoomed.width < baseline.width * 0.7 && zoomed.width > baseline.width * 0.3);
    report.checks.push({ label: "real-keyboard-zoom-dimensions", baseline, zoomSteps });
    saveReport();
    // WebKitWebDriver may dispatch an element click in unscaled coordinates
    // after page zoom. Prove the actual event position before attributing it.
    const chooser = "//button[normalize-space(.)='Choose profile']";
    const chooserTabs = await driver.tabTo(chooser, "xpath");
    await driver.nextPaint();
    const zoomClick = await driver.observeClick(
      "//button[normalize-space(.)='Choose profile']",
      "xpath",
    );
    const clickResult = classifyClickTrace(zoomClick);
    report.checks.push({
      label: "zoomed-native-pointer-diagnostic",
      chooserTabs,
      result: clickResult,
      zoomClick,
    });
    saveReport();
    if (clickResult === "on-target") {
      await waitUntil(
        "on-target native click opens menu",
        async () => (await driver.read(menuState)).open,
      );
      await escapeMenu();
    }
    // Always qualify zoomed keyboard access independently of pointer support.
    await driver.tabTo(chooser, "xpath");
    await driver.key("\uE007");
    await waitUntil("keyboard opens six native profile rows", async () => {
      const state = await driver.read(menuState);
      return state.open && state.profiles === 6;
    });
    await driver.tabTo("#profile-name");
    await driver.key("\uE004");
    await driver.key("\uE004");
    const zoomMenu = await waitUntil("zoomed final action remains visible", async () => {
      const state = await driver.read(menuState);
      assertMenuGeometry(state, true);
      return state;
    });
    report.checks.push({ label: "zoomed-native-keyboard-menu", zoomMenu });
    await capture("03-native-keyboard-zoom-menu");
    await escapeMenu();
    await driver.key("0", true);
    await waitUntil("keyboard reset restores content size", async () => {
      const state = await driver.read(nativeState);
      return (
        Math.abs(state.width - baseline.width) <= 2 && Math.abs(state.height - baseline.height) <= 2
      );
    });

    await driver.click("//button[normalize-space(.)='App settings']", "xpath");
    await waitUntil("native app preferences editable", () =>
      driver.read(
        'return document.querySelector("[data-testid=app-motion-reduce]")?.disabled === false;',
      ),
    );
    assert.equal(
      await driver.read(
        'return document.querySelector("[data-testid=app-data-location]")?.textContent;',
      ),
      fixture.data,
    );
    await driver.click('[data-testid="app-motion-reduce"] + label');
    await waitUntil(
      "native preference file persisted",
      () => readJson(join(fixture.data, "settings.json")).preferences.motion === "reduce",
    );
    expectedMotion = "reduce";
    assert.equal((await driver.read(nativeState)).motion, "reduce");
    report.preservation.push(assertLinuxNativeFixture(fixture, expectedMotion, "after-ui-save"));
    await capture("04-native-preferences-saved");
    await stopDriver();

    await launch("restart");
    await waitUntil(
      "preference survives native process restart",
      async () => (await driver.read(nativeState)).motion === "reduce",
    );
    await driver.click("//button[normalize-space(.)='App settings']", "xpath");
    await waitUntil("restarted preference control selected", () =>
      driver.read(
        'return document.querySelector("[data-testid=app-motion-reduce]")?.checked === true;',
      ),
    );
    await capture("05-native-preferences-after-restart");
    report.checks.push({ label: "native-settings-persistence-and-restart", result: "passed" });
    report.status = "passed";
  } catch (error) {
    smokeError = error;
    report.status = "failed";
    report.error = error.stack ?? String(error);
    if (driver?.sessionId) {
      try {
        await capture("failure");
      } catch (captureError) {
        report.captureError = String(captureError);
      }
    }
  } finally {
    try {
      await stopDriver();
      report.preservation.push(
        assertLinuxNativeFixture(fixture, expectedMotion, "after-native-exit"),
      );
      assertNoSteamDirectories(linuxSteamCandidates(childEnv));
    } catch (error) {
      report.status = "failed";
      report.cleanupError = String(error);
      smokeError = smokeError
        ? new AggregateError([smokeError, error], "Native smoke and preservation/cleanup failed")
        : error;
    } finally {
      saveReport();
      console.log(`Linux native smoke ${report.status}; evidence: ${evidence}`);
    }
  }
  if (smokeError) throw smokeError;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
