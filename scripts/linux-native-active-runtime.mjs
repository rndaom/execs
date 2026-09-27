import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { findOwnedNativeProcess } from "./linux-native-active-close.mjs";
import { assertNativeRuntime } from "./linux-native-smoke.mjs";
import { NativeWebDriver, waitUntil } from "./linux-native-webdriver.mjs";
import { assertNoSteamDirectories, linuxSteamCandidates } from "./package-smoke-fixture.mjs";

export const ACTIVE_NATIVE_STATE = `return {
  native: typeof window.__TAURI_INTERNALS__?.invoke === 'function', href: location.href,
  width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
  heading: Array.from(document.querySelectorAll('h1')).find((node) =>
    node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden')?.textContent,
  filesAvailable: Boolean(document.querySelector('[data-testid="settings-tab-files"]')),
  selectedProfile: document.querySelector('[data-testid="profile-library"] summary')?.textContent,
  motion: document.documentElement.dataset.motion ?? 'system',
  focusedTag: document.activeElement?.tagName,
  dialog: document.querySelector('[data-testid="files-exit-guard"]')?.textContent ?? null,
  scrollX, scrollY
};`;

export function activeRuntimePreflight(env = process.env, platform = process.platform) {
  assert.equal(platform, "linux", "Active native smoke requires Linux");
  assert.equal(env.CI, "true", "Active native smoke requires CI");
  assert.equal(env.GITHUB_ACTIONS, "true", "Active native smoke requires GitHub Actions");
  assert.equal(env.RUNNER_ENVIRONMENT, "github-hosted", "Self-hosted workers are refused");
  assert.ok(env.DISPLAY && env.DBUS_SESSION_BUS_ADDRESS, "Use Xvfb and dbus-run-session");
  const processes = execFileSync("ps", ["-A", "-o", "comm="], { encoding: "utf8" });
  assert.ok(
    !processes
      .split(/\r?\n/)
      .some((name) => /^(execs|steam|tf_linux64|tf_win64\.exe)$/.test(name.trim())),
    "Existing execs, Steam or TF2 processes are refused",
  );
  assertNoSteamDirectories(linuxSteamCandidates(env));
  const binary = resolve("apps/desktop/src-tauri/target/release/execs");
  assert.equal(realpathSync(binary), binary, "Native binary must not be redirected");
  const bytes = readFileSync(binary);
  assert.equal(bytes.subarray(0, 4).toString("hex"), "7f454c46", "Expected a Linux ELF binary");
  return {
    binary,
    binarySha256: createHash("sha256").update(bytes).digest("hex"),
    revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  };
}

export function activeCaptureSettled({ fontsReady, animations }) {
  return (
    fontsReady &&
    animations.every(
      (animation) =>
        animation.playState !== "running" || (animation.cursorLayer && animation.infinite),
    )
  );
}

async function freePort() {
  const server = createServer();
  await new Promise((ready, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", ready);
  });
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

function groupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

/** Active-only session lifecycle. Cleanup is separate from the UI close assertions. */
export class LinuxActiveSession {
  constructor({ binary, fixture, childEnv, evidence, report, saveReport }) {
    Object.assign(this, { binary, fixture, childEnv, evidence, report, saveReport });
  }

  async launch(label) {
    assert.ok(!this.process && !this.driver, "Previous native process group must be stopped");
    assertNoSteamDirectories(linuxSteamCandidates(this.childEnv));
    const port = await freePort();
    let nativePort = await freePort();
    while (nativePort === port) nativePort = await freePort();
    this.log = createWriteStream(join(this.evidence, `${label}-driver.log`), { flags: "wx" });
    this.process = spawn(
      "tauri-driver",
      ["--port", String(port), "--native-port", String(nativePort), "--native-host", "127.0.0.1"],
      {
        cwd: this.fixture.scratch,
        env: this.childEnv,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.process.stdout.pipe(this.log, { end: false });
    this.process.stderr.pipe(this.log, { end: false });
    let failure;
    this.process.once("error", (error) => {
      failure = error;
    });
    this.driver = new NativeWebDriver(port);
    await waitUntil("active native driver ready", async () => {
      if (failure) throw failure;
      assert.equal(this.process.exitCode, null, "tauri-driver exited during startup");
      return (await this.driver.request("GET", "/status")).ready;
    });
    await this.driver.start(this.binary);
    const state = await waitUntil(
      "real active profile shell",
      async () => {
        const state = await this.driver.read(ACTIVE_NATIVE_STATE);
        return state.native && state.filesAvailable && state;
      },
      30_000,
    );
    assertNativeRuntime(state);
    this.nativeProcess = findOwnedNativeProcess(this.process.pid, this.binary);
    this.report.checks.push({
      label,
      state,
      capabilities: this.driver.capabilities,
      process: this.nativeProcess,
    });
    if (
      await this.driver.read(
        'return Boolean(document.querySelector("[data-testid=release-notes]"));',
      )
    ) {
      await this.driver.key("\uE00C");
    }
    await this.contentSize(1200, 800);
    this.saveReport();
  }

  async contentSize(width, height) {
    let outerWidth = width;
    let outerHeight = height;
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await this.driver.read(ACTIVE_NATIVE_STATE);
      await this.driver.command("POST", "window/rect", { width: outerWidth, height: outerHeight });
      const state = await waitUntil("active native resize rendered", async () => {
        const next = await this.driver.read(ACTIVE_NATIVE_STATE);
        return (
          ((Math.abs(next.width - width) <= 2 && Math.abs(next.height - height) <= 2) ||
            next.width !== before.width ||
            next.height !== before.height) &&
          next
        );
      });
      if (Math.abs(state.width - width) <= 2 && Math.abs(state.height - height) <= 2) return state;
      outerWidth += width - state.width;
      outerHeight += height - state.height;
    }
    throw new Error(`Native content did not reach ${width}×${height}`);
  }

  async capture(name) {
    assert.match(name, /^[a-z0-9-]+$/);
    await waitUntil("active native fonts and finite motion settled", async () =>
      activeCaptureSettled(
        await this.driver.read(`return {
        fontsReady: document.fonts.status === 'loaded',
        animations: document.getAnimations().map((animation) => ({
          playState: animation.playState,
          cursorLayer: animation.effect?.target?.classList?.contains('cm-cursorLayer') === true,
          infinite: animation.effect?.getTiming().iterations === Infinity
        }))
      };`),
      ),
    );
    let previous;
    let identical = 0;
    const { state, bytes } = await waitUntil(
      "three stable active native screenshot frames",
      async () => {
        await this.driver.nextPaint();
        const state = await this.driver.read(ACTIVE_NATIVE_STATE);
        const bytes = Buffer.from(await this.driver.command("GET", "screenshot"), "base64");
        assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
        identical =
          previous &&
          bytes.equals(previous.bytes) &&
          JSON.stringify(state) === JSON.stringify(previous.state)
            ? identical + 1
            : 1;
        previous = { state, bytes };
        return identical >= 3 && previous;
      },
    );
    writeFileSync(join(this.evidence, `${name}.png`), bytes);
    this.report.captures.push({
      file: `${name}.png`,
      state,
      pixels: [bytes.readUInt32BE(16), bytes.readUInt32BE(20)],
      stableFrames: identical,
    });
    this.saveReport();
  }

  async stop() {
    if (this.driver) {
      try {
        await this.driver.close();
      } catch {
        /* The UI may already have closed its session. */
      }
      this.driver = null;
    }
    if (this.process?.pid) {
      const pid = this.process.pid;
      for (const signal of ["SIGTERM", "SIGKILL"]) {
        if (!groupExists(pid)) break;
        try {
          process.kill(-pid, signal);
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
        try {
          await waitUntil("owned active native process group exit", () => !groupExists(pid), 2_000);
        } catch {
          /* Escalate only this owned group. */
        }
      }
      assert.ok(!groupExists(pid), "Owned native processes did not stop");
    }
    this.process = null;
    this.nativeProcess = null;
    this.log?.end();
    this.log = null;
    assertNoSteamDirectories(linuxSteamCandidates(this.childEnv));
  }
}
