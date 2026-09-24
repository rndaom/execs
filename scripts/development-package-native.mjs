import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, posix } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { regularFile, requireContained, sha256 } from "./development-package-guard.mjs";
import {
  ownedNativeProcessExited,
  parseOwnedProcessRows,
  requestOwnedNativeClose,
  selectOwnedMainWindow,
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

function dialogWindows(observation, pid, title) {
  assert.ok(Number.isInteger(pid) && pid > 1);
  assert.ok(["Export profile", "Import profile"].includes(title));
  assert.equal(observation.pid, pid, "Dialog inspection returned a different process");
  assert.ok(Array.isArray(observation.windows) && observation.windows.length <= 128);
  assert.ok(Array.isArray(observation.treeWindowIds) && observation.treeWindowIds.length <= 4096);
  assert.ok(observation.treeWindowIds.every((id) => Number.isSafeInteger(id) && id > 0));
  assert.equal(new Set(observation.treeWindowIds).size, observation.treeWindowIds.length);
  const windows = observation.windows;
  assert.equal(new Set(windows.map(({ id }) => id)).size, windows.length, "Duplicate X11 IDs");
  for (const window of windows) {
    assert.ok(Number.isSafeInteger(window.id) && window.id > 0);
    assert.ok(
      observation.treeWindowIds.includes(window.id),
      "Candidate is outside observed X tree",
    );
    assert.equal(window.pid, pid, "Dialog inspection contains a foreign process");
    assert.equal(window.deleteProtocol, true, "Dialog inspection lost close-protocol identity");
    assert.ok([0, 1, 2].includes(window.mapState), "Unknown X11 map state");
  }
  return { windows, main: selectOwnedMainWindow(observation, { pid }) };
}

function assertDialogShape(window, main) {
  assert.equal(window.windowClass, 1, "GTK dialog must be an InputOutput window");
  assert.equal(window.overrideRedirect, false, "GTK dialog overrides window management");
  assert.equal(window.root, main.root, "GTK dialog is on another root");
  assert.equal(window.parent, window.root, "GTK dialog is not an ordinary root child");
  assert.ok(
    window.transientFor === null || window.transientFor === main.id,
    "GTK dialog has an unknown transient parent",
  );
  assert.ok(
    Number.isSafeInteger(window.geometry?.width) &&
      window.geometry.width > 0 &&
      Number.isSafeInteger(window.geometry?.height) &&
      window.geometry.height > 0,
    "GTK dialog has no positive geometry",
  );
}

export function selectOwnedDialog(observation, pid, title, { allowAbsent = false } = {}) {
  const { windows, main } = dialogWindows(observation, pid, title);
  const matches = windows.filter((window) => window.title === title && window.mapState === 2);
  assert.ok(matches.length <= 1, `Ambiguous owned ${title} GTK dialogs`);
  const dialog = matches[0];
  assert.ok(
    windows.every((window) => window.mapState !== 2 || [main.id, dialog?.id].includes(window.id)),
    "Unexpected visible owned window during GTK dialog selection",
  );
  if (!dialog) {
    assert.ok(allowAbsent, `Expected one viewable owned ${title} GTK dialog`);
    return null;
  }
  assertDialogShape(dialog, main);
  return { ...dialog, mainWindowId: main.id };
}

/** GTK responds by hiding its dialog; a retained XID is not an open dialog. */
export function ownedDialogDismissal(observation, pid, dialog) {
  assert.equal(dialog.pid, pid);
  assert.equal(dialog.mapState, 2, "A dialog must have been observed viewable before input");
  const { windows, main } = dialogWindows(observation, pid, dialog.title);
  assert.equal(main.id, dialog.mainWindowId, "Owned main window changed during GTK interaction");
  assertDialogShape(dialog, main);
  const current = windows.find(({ id }) => id === dialog.id);
  assert.ok(
    windows.every((window) => window.mapState !== 2 || [main.id, dialog.id].includes(window.id)),
    "Another visible owned window prevents proving GTK dialog dismissal",
  );
  if (!current) {
    assert.ok(
      !observation.treeWindowIds.includes(dialog.id),
      "Original GTK XID remains in tree without verified ownership/protocol identity",
    );
    return { state: "absent-from-observed-tree", dialogId: dialog.id, mainWindowId: main.id };
  }
  for (const key of [
    "pid",
    "title",
    "deleteProtocol",
    "windowClass",
    "overrideRedirect",
    "root",
    "parent",
    "transientFor",
  ])
    assert.equal(current[key], dialog[key], `GTK dialog identity changed: ${key}`);
  assertDialogShape(current, main);
  assert.notEqual(current.mapState, 1, "Ancestor-unviewable is not an unmapped GTK dialog");
  return current.mapState === 0
    ? { state: "unmapped", dialogId: dialog.id, mainWindowId: main.id }
    : null;
}

/** Missing/unchanged state can settle; ownership or ambiguity errors are fatal. */
export async function waitForDialogState(
  label,
  inspect,
  decide,
  { timeout = 15_000, now = Date.now, pause = delay, allowTimeout = false } = {},
) {
  const deadline = now() + timeout;
  do {
    const result = decide(inspect());
    if (result) return result;
    await pause(Math.min(150, Math.max(0, deadline - now())));
  } while (now() < deadline);
  if (allowTimeout) return null;
  throw new Error(`Timed out: ${label}`);
}

/** A location-entry Return may leave an import chooser open. Retry only the
 * same verified, still-viewable dialog once; the later archive review still
 * proves which file the native app actually read. */
export async function waitForOwnedDialogDismissal(
  pid,
  dialog,
  inspect,
  retryImportReturn,
  { wait = waitForDialogState } = {},
) {
  const label = "owned GTK dialog becomes unmapped or absent after native input";
  const decide = (observation) => ownedDialogDismissal(observation, pid, dialog);
  if (dialog.title !== "Import profile") {
    return { dismissal: await wait(label, inspect, decide), returnPresses: 1 };
  }
  const first = await wait(label, inspect, decide, { timeout: 5_000, allowTimeout: true });
  if (first) return { dismissal: first, returnPresses: 1 };
  const settled = decide(inspect());
  if (settled) return { dismissal: settled, returnPresses: 1 };
  await retryImportReturn();
  return { dismissal: await wait(label, inspect, decide), returnPresses: 2 };
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
    assert.match(label, /^[a-z0-9-]+$/);
    const receipt = {
      label,
      title,
      requestedPath: path,
      process: this.native,
      status: "observing",
      input: "XTest keys to verified viewable owned GTK window",
      proofRequired: "Exact requested file and independent archive/fixture checks",
      observations: [],
      captures: [],
    };
    this.report.dialogs ??= [];
    this.report.dialogs.push(receipt);
    let lastObservation;
    let phase = "awaiting-dialog";
    const inspect = () => {
      verifyOwnedNativeProcess(this.native, this.native.executable);
      const observation = JSON.parse(
        execFileSync("python3", ["-c", X11_CLOSE_HELPER, String(this.native.pid), "inspect"], {
          env: this.childEnv,
          encoding: "utf8",
          timeout: 5_000,
        }),
      );
      const serialized = JSON.stringify({ phase, observation });
      if (serialized !== lastObservation) {
        assert.ok(receipt.observations.length < 128, "Unbounded GTK dialog state changes");
        receipt.observations.push({ at: new Date().toISOString(), phase, ...observation });
        lastObservation = serialized;
        this.saveReport();
      }
      return observation;
    };
    const xdo = (args) =>
      execFileSync("xdotool", args, { env: this.childEnv, encoding: "utf8", timeout: 5_000 });
    try {
      const dialog = await waitForDialogState(`owned ${title} dialog`, inspect, (observation) =>
        selectOwnedDialog(observation, this.native.pid, title, { allowAbsent: true }),
      );
      receipt.dialog = dialog;
      const verifyFocus = () => {
        const current = selectOwnedDialog(inspect(), this.native.pid, title);
        assert.equal(current.id, dialog.id);
        assert.equal(current.mainWindowId, dialog.mainWindowId);
        assert.equal(
          Number(xdo(["getwindowfocus"]).trim()),
          dialog.id,
          "File dialog lost native keyboard focus",
        );
      };
      const input = (nextPhase, args) => {
        phase = nextPhase;
        verifyFocus();
        xdo(args);
      };
      const capture = (suffix) => {
        verifyFocus();
        const file = `${label}-${suffix}.png`;
        const destination = join(this.evidence, file);
        execFileSync("import", ["-window", String(dialog.id), destination], {
          env: this.childEnv,
          timeout: 5_000,
        });
        receipt.captures.push({ file, sha256: sha256(regularFile(destination, 16 * 1024 * 1024)) });
        this.saveReport();
      };
      phase = "focus-dialog";
      assert.equal(selectOwnedDialog(inspect(), this.native.pid, title).id, dialog.id);
      xdo(["windowfocus", "--sync", String(dialog.id)]);
      capture("dialog");
      input("open-location-entry", ["key", "--clearmodifiers", "ctrl+l"]);
      input("select-location-entry", ["key", "--clearmodifiers", "ctrl+a"]);
      input("type-owned-path", ["type", "--clearmodifiers", "--delay", "1", "--", path]);
      capture("path");
      input("accept-path", ["key", "--clearmodifiers", "Return"]);
      phase = "awaiting-dismissal";
      const response = await waitForOwnedDialogDismissal(this.native.pid, dialog, inspect, () => {
        capture("still-open-after-return");
        input("retry-accept-path", ["key", "--clearmodifiers", "Return"]);
        phase = "awaiting-second-dismissal";
      });
      receipt.dismissal = response.dismissal;
      receipt.returnPresses = response.returnPresses;
      receipt.status = "dismissed-awaiting-file-proof";
      this.saveReport();
    } catch (cause) {
      receipt.status = "failed";
      receipt.error = cause.stack ?? String(cause);
      try {
        this.saveReport();
      } catch (saveError) {
        throw new AggregateError([cause, saveError], "GTK action and evidence write failed", {
          cause,
        });
      }
      throw cause;
    }
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
