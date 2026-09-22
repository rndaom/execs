import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, posix } from "node:path";
import { regularFile, requireContained, sha256 } from "./development-package-guard.mjs";
import {
  ownedNativeProcessExited,
  parseOwnedProcessRows,
  requestOwnedNativeClose,
  verifyOwnedNativeProcess,
  X11_CLOSE_HELPER,
} from "./linux-native-active-close.mjs";
import { copyEditorText } from "./linux-native-active-input.mjs";
import { activeCaptureSettled } from "./linux-native-active-runtime.mjs";
import { assertNativeRuntime } from "./linux-native-smoke.mjs";
import { NativeWebDriver, waitUntil } from "./linux-native-webdriver.mjs";

const nativeState = `return {
  native: typeof window.__TAURI_INTERNALS__?.invoke === 'function', href: location.href,
  width: innerWidth, height: innerHeight,
  heading: Array.from(document.querySelectorAll('h1')).find((node) => node.getClientRects().length)?.textContent,
  profile: document.querySelector('[data-testid="profile-library"] summary strong')?.textContent,
  profiles: Array.from(document.querySelectorAll('[data-testid="profile-name"]')).map((node) => node.textContent),
  importDialog: document.querySelector('[data-testid="profile-import-dialog"]')?.textContent ?? null,
  switchDetail: document.querySelector('[data-testid="switch-progress-current"]')?.textContent ?? null,
  editorPath: document.querySelector('.cm-content')?.getAttribute('aria-label') ?? null
};`;

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

export function selectOwnedDialog(observation, pid, title) {
  assert.ok(Number.isInteger(pid) && pid > 1);
  assert.ok(["Export profile", "Import profile"].includes(title));
  const matches = observation.windows.filter(
    (window) => window.pid === pid && window.title === title && window.deleteProtocol,
  );
  assert.equal(matches.length, 1, `Expected one owned ${title} GTK dialog`);
  const id = matches[0].id;
  assert.ok(Number.isSafeInteger(id) && id > 0);
  return matches[0];
}

export function verifyAppImageMount(executable, temporaryDirectory, mountInfo) {
  const relative = posix.relative(temporaryDirectory, executable);
  assert.match(
    relative,
    /^\.mount_[^/]+\/usr\/bin\/execs$/,
    "AppImage is not running from its private FUSE mount",
  );
  const mountPoint = posix.join(temporaryDirectory, relative.split("/")[0]);
  const decode = (value) =>
    value.replace(/\\(040|011|012|134)/g, (_, octal) =>
      String.fromCharCode(Number.parseInt(octal, 8)),
    );
  const mounts = mountInfo
    .trim()
    .split("\n")
    .map((line) => {
      const [left, right] = line.split(" - ");
      const fields = left.split(" ");
      return {
        mountPoint: decode(fields[4] ?? ""),
        options: fields[5]?.split(",") ?? [],
        filesystem: right?.split(" ")[0],
      };
    })
    .filter((mount) => mount.mountPoint === mountPoint);
  assert.equal(mounts.length, 1, "Expected one exact AppImage mount");
  assert.match(
    mounts[0].filesystem ?? "",
    /^fuse(?:\.|$)/,
    "Extracted application cannot satisfy normal FUSE startup",
  );
  assert.ok(mounts[0].options.includes("ro"), "Expected a read-only AppImage mount");
  return mounts[0];
}

function groupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

/** An external driver opens the actual installed binary or normal FUSE AppImage. */
export class DevelopmentPackageSession {
  constructor({
    application,
    binarySha256,
    kind,
    fixture,
    childEnv,
    evidence,
    report,
    saveReport,
  }) {
    Object.assign(this, {
      application,
      binarySha256,
      kind,
      fixture,
      childEnv,
      evidence,
      report,
      saveReport,
    });
  }

  async launch(label) {
    assert.match(label, /^[a-z0-9-]+$/);
    assert.ok(!this.process && !this.driver);
    const port = await freePort();
    let nativePort = await freePort();
    while (port === nativePort) nativePort = await freePort();
    this.log = createWriteStream(join(this.evidence, `${label}-driver.log`), { flags: "wx" });
    this.process = spawn(
      "tauri-driver",
      ["--port", String(port), "--native-port", String(nativePort), "--native-host", "127.0.0.1"],
      {
        env: this.childEnv,
        cwd: this.fixture.scratch,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.process.stdout.pipe(this.log, { end: false });
    this.process.stderr.pipe(this.log, { end: false });
    let spawnError;
    this.process.once("error", (error) => {
      spawnError = error;
    });
    this.driver = new NativeWebDriver(port);
    await waitUntil("packaged native driver ready", async () => {
      assert.ifError(spawnError);
      assert.equal(this.process.exitCode, null);
      return (await this.driver.request("GET", "/status")).ready;
    });
    await this.driver.start(this.application);
    const state = await waitUntil(
      "installed package renders real profile library",
      async () => {
        const value = await this.driver.read(nativeState);
        return value.profile && value.profiles.length >= 2 && value;
      },
      30_000,
    );
    assertNativeRuntime(state);
    const identity = parseOwnedProcessRows(
      execFileSync("ps", ["-eo", "pid=,pgid=,comm="], { encoding: "utf8" }),
      this.process.pid,
    );
    const binary = realpathSync(`/proc/${identity.pid}/exe`);
    let mount;
    if (this.kind === "appimage")
      mount = verifyAppImageMount(
        binary,
        this.childEnv.TMPDIR,
        readFileSync(`/proc/${identity.pid}/mountinfo`, "utf8"),
      );
    else assert.equal(binary, realpathSync("/usr/bin/execs"));
    assert.equal(
      sha256(readFileSync(binary)),
      this.binarySha256,
      "Running native binary differs from the inspected package",
    );
    this.native = verifyOwnedNativeProcess(identity, binary);
    this.report.checks.push({
      label,
      application: this.application,
      kind: this.kind,
      process: this.native,
      state,
      capabilities: this.driver.capabilities,
      binarySha256: this.binarySha256,
      ...(mount ? { mount } : {}),
    });
    if (
      await this.driver.read(
        'return Boolean(document.querySelector("[data-testid=release-notes]"));',
      )
    )
      await this.driver.key("\uE00C");
    this.saveReport();
  }

  async capture(label) {
    assert.match(label, /^[a-z0-9-]+$/);
    await waitUntil("package fonts and finite motion settled", async () =>
      activeCaptureSettled(
        await this.driver.read(
          `return {fontsReady: document.fonts.status === 'loaded', animations: document.getAnimations().map((animation) => ({playState: animation.playState, cursorLayer: animation.effect?.target?.classList?.contains('cm-cursorLayer') === true, infinite: animation.effect?.getTiming().iterations === Infinity}))};`,
        ),
      ),
    );
    let previous;
    let identical = 0;
    const snapshot = await waitUntil("three stable installed native frames", async () => {
      await this.driver.nextPaint();
      const state = await this.driver.read(nativeState);
      const bytes = Buffer.from(await this.driver.command("GET", "screenshot"), "base64");
      assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      identical =
        previous &&
        bytes.equals(previous.bytes) &&
        JSON.stringify(state) === JSON.stringify(previous.state)
          ? identical + 1
          : 1;
      previous = { bytes, state };
      return identical >= 3 && previous;
    });
    writeFileSync(join(this.evidence, `${label}.png`), snapshot.bytes);
    this.report.captures.push({
      file: `${label}.png`,
      state: snapshot.state,
      sha256: sha256(snapshot.bytes),
      stableFrames: identical,
    });
    this.saveReport();
  }

  async readProfile(expectedText, expectedName, label) {
    await waitUntil(
      "expected active profile name",
      async () => (await this.driver.read(nativeState)).profile === expectedName,
    );
    await this.driver.click('[data-testid="settings-tab-files"]');
    await waitUntil("installed Files list", () =>
      this.driver.read(
        'return Array.from(document.querySelectorAll("[data-testid=files-item]")).some((node) => node.getAttribute("aria-label")?.endsWith(". tf/cfg/config.cfg"));',
      ),
    );
    await this.driver.click(
      "//button[@data-testid='files-item' and contains(@aria-label, '. tf/cfg/config.cfg')]",
      "xpath",
    );
    await waitUntil("installed config editor", () =>
      this.driver.read(
        'return document.querySelector(".cm-content")?.getAttribute("aria-label") === "Contents of tf/cfg/config.cfg";',
      ),
    );
    const text = await copyEditorText(this.driver, this.childEnv, expectedText);
    this.report.checks.push({
      label,
      configClipboardSha256: sha256(text),
      bytes: Buffer.byteLength(text),
      expectedProfile: expectedName,
      nativeCopyVerified: true,
    });
    await this.capture(label);
  }

  async openMenu() {
    if (
      !(await this.driver.read(
        'return document.querySelector("[data-testid=profile-library]").open;',
      ))
    )
      await this.driver.click('[data-testid="profile-library"] summary');
    await waitUntil("profile menu open", () =>
      this.driver.read('return document.querySelector("[data-testid=profile-library]").open;'),
    );
  }

  /** XTest keyboard input goes only to a verified PID-owned GTK dialog. */
  async chooseFile(title, path, label) {
    requireContained(this.fixture.scratch, path);
    assert.match(path, /^[\x20-\x7E]+$/u);
    const inspect = () => {
      verifyOwnedNativeProcess(this.native, this.native.executable);
      return JSON.parse(
        execFileSync("python3", ["-c", X11_CLOSE_HELPER, String(this.native.pid), "inspect"], {
          env: this.childEnv,
          encoding: "utf8",
          timeout: 5_000,
        }),
      );
    };
    const dialog = await waitUntil(`owned ${title} dialog`, () =>
      selectOwnedDialog(inspect(), this.native.pid, title),
    );
    const xdo = (args) =>
      execFileSync("xdotool", args, { env: this.childEnv, encoding: "utf8", timeout: 5_000 });
    const verifyFocus = () => {
      assert.equal(selectOwnedDialog(inspect(), this.native.pid, title).id, dialog.id);
      assert.equal(
        Number(xdo(["getwindowfocus"]).trim()),
        dialog.id,
        "File dialog lost native keyboard focus",
      );
    };
    xdo(["windowfocus", "--sync", String(dialog.id)]);
    verifyFocus();
    execFileSync(
      "import",
      ["-window", String(dialog.id), join(this.evidence, `${label}-dialog.png`)],
      { env: this.childEnv, timeout: 5_000 },
    );
    xdo(["key", "--clearmodifiers", "ctrl+l"]);
    verifyFocus();
    xdo(["key", "--clearmodifiers", "ctrl+a"]);
    xdo(["type", "--clearmodifiers", "--delay", "1", "--", path]);
    verifyFocus();
    xdo(["key", "--clearmodifiers", "Return"]);
    await waitUntil(
      "file dialog accepts the exact owned path",
      () => !inspect().windows.some((window) => window.id === dialog.id),
    );
    this.report.checks.push({
      label,
      dialog,
      requestedPath: path,
      input: "XTest keys to verified owned GTK window",
      actualFileVerifiedSeparately: true,
    });
    this.saveReport();
  }

  async exportPrevious(path, profileName) {
    await this.openMenu();
    await this.driver.click(`[data-testid="profile-export"][aria-label="Export ${profileName}"]`);
    await this.chooseFile("Export profile", path, "previous-export");
    await waitUntil("previous installed app writes the requested export", () =>
      regularFile(path, 4 * 1024 * 1024),
    );
    await this.driver.key("\uE00C");
    await this.capture("previous-export-complete");
  }

  async importPrevious(path) {
    regularFile(path, 4 * 1024 * 1024);
    await this.openMenu();
    await this.driver.click('[data-testid="profile-import"]');
    await this.chooseFile("Import profile", path, "candidate-import");
    await waitUntil("candidate review reflects native archive read", () =>
      this.driver.read(
        'return document.querySelector("[data-testid=profile-import-dialog]")?.textContent.includes("Review profile import");',
      ),
    );
    await this.capture("candidate-import-review");
    await this.driver.click(
      "//*[@data-testid='profile-import-dialog']//button[normalize-space(.)='Import profile']",
      "xpath",
    );
    await waitUntil(
      "candidate native import commits",
      () =>
        this.driver.read(
          'return document.querySelector("[data-testid=profile-import-dialog]")?.textContent.includes("Profile imported");',
        ),
      30_000,
    );
    await this.capture("candidate-import-complete");
  }

  async switchImported(expectedName) {
    await this.driver.click(
      "//*[@data-testid='profile-import-dialog']//button[normalize-space(.)='Switch to profile']",
      "xpath",
    );
    const state = await waitUntil(
      "candidate switch reports its absent-account outcome",
      async () => {
        const value = await this.driver.read(nativeState);
        return (
          value.profile === expectedName &&
          value.switchDetail?.includes("No Steam account config was found") &&
          value
        );
      },
      30_000,
    );
    this.report.checks.push({
      label: "candidate-switch-outcome",
      expectedProfile: expectedName,
      nativeCompletionDetail: state.switchDetail,
      launchSyncPendingExpected: true,
    });
    await this.capture("candidate-switch-complete");
  }

  async close(label) {
    const request = requestOwnedNativeClose(this.native, this.native.executable, this.childEnv);
    await waitUntil("installed app closes before driver cleanup", () =>
      ownedNativeProcessExited(this.native),
    );
    this.report.checks.push({
      label,
      request,
      processExitedBeforeCleanup: true,
      nativeExitCode: null,
      nativeExitStatus: "not observed; external driver owns child",
    });
    this.saveReport();
    await this.stop();
  }

  async stop() {
    const failures = [];
    if (this.driver) {
      try {
        await this.driver.close();
      } catch (error) {
        let alreadyExited = false;
        try {
          alreadyExited = Boolean(this.native && ownedNativeProcessExited(this.native));
        } catch (identityError) {
          failures.push(identityError);
        }
        this.report.checks.push({
          label: "driver-session-cleanup",
          nativeAlreadyExited: alreadyExited,
          error: String(error),
        });
        // WM_DELETE_WINDOW can end the session before the driver's DELETE call.
        // An unexplained failure must survive subsequent forced cleanup.
        if (!alreadyExited) failures.push(error);
      }
      this.driver = null;
    }
    try {
      if (this.process?.pid) {
        const pid = this.process.pid;
        for (const signal of ["SIGTERM", "SIGKILL"]) {
          if (!groupAlive(pid)) break;
          try {
            process.kill(-pid, signal);
          } catch (error) {
            if (error.code !== "ESRCH") throw error;
          }
          try {
            await waitUntil("owned package driver group stops", () => !groupAlive(pid), 2_000);
          } catch {
            /* Bounded escalation of this group only. */
          }
        }
        assert.ok(!groupAlive(pid));
      }
      this.process = null;
      this.native = null;
    } catch (error) {
      failures.push(error);
    }
    try {
      if (this.log) await new Promise((done) => this.log.end(done));
      this.log = null;
    } catch (error) {
      failures.push(error);
    }
    if (failures.length) {
      throw new AggregateError(failures, "Owned package driver cleanup failed", {
        cause: failures[0],
      });
    }
  }
}
