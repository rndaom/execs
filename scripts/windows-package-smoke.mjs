import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
  copyFileSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join, resolve, win32 } from "node:path";
import { finished } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { developmentVersions, regularFile } from "./development-package-guard.mjs";
import { activeCaptureSettled } from "./linux-native-active-runtime.mjs";
import { classifyClickTrace, NativeWebDriver, waitUntil } from "./linux-native-webdriver.mjs";
import {
  assertHostObservation,
  assertNormalExit,
  assertWindowsFixturePreserved,
  assertWindowsHost,
  containedPath,
  inspectWindowsExport,
  seedWindowsFixture,
  selectPreviousNsis,
  sha256,
  verifyPublicPackage,
  windowsAppEnvironment,
} from "./windows-package-contract.mjs";

const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const helperPath = fileURLToPath(new URL("./windows-package-native.ps1", import.meta.url));
const nativeState = `return {
  href: location.href, native: typeof window.__TAURI_INTERNALS__?.invoke === 'function',
  width: innerWidth, height: innerHeight, ready: document.readyState,
  profile: document.querySelector('[data-testid="profile-library"] summary strong')?.textContent,
  profiles: Array.from(document.querySelectorAll('[data-testid="profile-name"]')).map(n => n.textContent),
  menuOpen: document.querySelector('[data-testid="profile-library"]')?.open,
  focused: document.activeElement?.outerHTML.slice(0, 1000),
  body: document.body.innerText.slice(0, 16000)
};`;

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return port;
}

/** Uses Microsoft's documented UseWebView + DebuggerAddress W3C capabilities. */
export async function attachWebView(driver, port) {
  assert.ok(Number.isInteger(port) && port > 1023 && port < 65536);
  const value = await driver.request(
    "POST",
    "/session",
    {
      capabilities: {
        alwaysMatch: {
          browserName: "webview2",
          "ms:edgeOptions": { debuggerAddress: `127.0.0.1:${port}` },
        },
      },
    },
    30000,
  );
  assert.ok(value.sessionId && typeof value.sessionId === "string");
  driver.sessionId = value.sessionId;
  driver.capabilities = value.capabilities;
  await driver.command("POST", "timeouts", { implicit: 0, script: 10000, pageLoad: 30000 });
}

export function assertNativePage(state, expectedName) {
  assert.equal(state.native, true);
  assert.equal(new URL(state.href).origin, "http://tauri.localhost");
  assert.equal(new URL(state.href).search, "");
  assert.equal(state.profile, expectedName);
  assert.equal(state.profiles.length, 2);
  assert.ok(state.width >= 960 && state.height >= 640);
}

export function assertDebugListener(observation, port, userData) {
  const listeners = observation.listeners.filter((row) => row.port === port);
  assert.ok(listeners.length > 0, "Owned debugging listener missing");
  for (const listener of listeners) {
    assert.ok(["127.0.0.1", "::1"].includes(listener.address), "Debugger exposed outside loopback");
    const browser = observation.processes.find((row) => row.pid === listener.pid);
    assert.ok(browser && /[\\/]msedgewebview2\.exe$/i.test(browser.executable));
    const argument = browser.commandLine.match(/(?:^|\s)--user-data-dir=(?:"([^"]+)"|(\S+))/);
    assert.ok(argument, "Browser user-data argument is unavailable");
    const actualData = argument[1] ?? argument[2];
    assert.ok(win32.isAbsolute(actualData));
    const part = win32.relative(userData, actualData);
    assert.ok(
      !win32.isAbsolute(part) && part !== ".." && !part.startsWith("..\\"),
      "Browser user data is not private",
    );
    assert.ok(browser.commandLine.includes(`--remote-debugging-port=${port}`));
  }
  return listeners;
}

export function edgeDriverArguments(port) {
  assert.ok(Number.isInteger(port) && port > 1023 && port < 65536);
  // Chromium EdgeDriver binds localhost by default. An allowed-ips flag enables remote binding.
  return [`--port=${port}`];
}

export function assertDriverListener(observation, port) {
  const listeners = observation.listeners.filter((row) => row.port === port);
  assert.ok(listeners.length > 0, "Driver listener missing");
  assert.ok(
    listeners.every(
      (row) => row.pid === observation.process.pid && ["127.0.0.1", "::1"].includes(row.address),
    ),
    "Driver exposed outside loopback",
  );
  return listeners;
}

/** All cleanup attempts run; a successful stage cannot conceal cleanup failure. */
export async function finalizeProbe(primaryError, actions) {
  const errors = primaryError ? [primaryError] : [];
  for (const action of actions) {
    try {
      await action();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1)
    throw new AggregateError(errors, "Probe and/or cleanup failed", {
      cause: primaryError ?? errors[0],
    });
}

/** Evidence failure is itself a failure, but never a reason to skip teardown. */
export async function finishWindowsProbe(primaryError, save, actions) {
  let failure;
  try {
    await finalizeProbe(primaryError, [() => save(), ...actions]);
  } catch (error) {
    failure = error;
  }
  try {
    await save(failure);
  } catch (error) {
    failure = failure
      ? new AggregateError([failure, error], "Final evidence write failed", { cause: failure })
      : error;
  }
  if (failure) throw failure;
}

/** Keep action receipts usable when their evidence destination fails afterward. */
export function actionBeforeEvidence(action, persist) {
  const value = action();
  try {
    persist(value);
    return { value, evidenceError: null };
  } catch (evidenceError) {
    return { value, evidenceError };
  }
}

export function recordLogErrors(stream, errors) {
  stream.on("error", (error) => errors.push(error));
  return stream;
}

export async function observeCleanupExits(children, receipt) {
  const exited = new Set([
    ...receipt.forcedCleanup.map((process) => process.pid),
    ...receipt.alreadyExited,
  ]);
  for (const entry of children)
    if (exited.has(entry.child.pid))
      await waitUntil("owned child exit notification after native cleanup", () => entry.exit, 5000);
}

export async function readBoundedResponse(response, maximum) {
  assert.ok(response.body, "Empty download response");
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      assert.ok(bytes <= maximum, "Download exceeds limit");
      chunks.push(Buffer.from(chunk.value));
    }
  } finally {
    await reader.cancel();
  }
  assert.ok(bytes > 0);
  return Buffer.concat(chunks);
}

export async function main() {
  // No process, registry, install or fixture mutation before the complete host/event gate.
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  assertWindowsHost(process.env, event);
  const parent = realpathSync(process.env.RUNNER_TEMP);
  assert.equal(parent.toLowerCase(), resolve(process.env.RUNNER_TEMP).toLowerCase());
  const root = mkdtempSync(join(parent, "execs-windows-package-"));
  const evidence = join(root, "evidence");
  const requests = join(root, "requests");
  const downloads = join(root, "downloads");
  for (const path of [evidence, requests, downloads]) mkdirSync(path);
  const report = {
    schema: 1,
    status: "running",
    scope: "Previous-public NSIS capability proof only; no candidate build or qualification.",
    sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    workflow: {
      runId: process.env.GITHUB_RUN_ID,
      attempt: process.env.GITHUB_RUN_ATTEMPT,
      event: process.env.GITHUB_EVENT_NAME,
      eventSha: process.env.GITHUB_SHA,
      pullRequestHead: event.pull_request?.head?.sha ?? null,
    },
    runner: {
      os: process.env.ImageOS ?? null,
      version: process.env.ImageVersion ?? null,
      node: process.version,
    },
    notQualified: [
      "candidate NSIS/upgrade/import/reopen",
      "production signed updater",
      "real updater UI",
      "interactive installer pages",
      "standard-user Windows",
      "screen-reader speech",
      "Steam/TF2/Cloud",
    ],
    checks: [],
    captures: [],
    cleanup: [],
  };
  const save = () => writeJson(join(evidence, "result.json"), report);
  save();
  let sequence = 0;
  let policyApplyRequest;
  const evidenceErrors = [];
  function native(action, body = {}, timeout = 25000) {
    const label = `${String(++sequence).padStart(2, "0")}-${action.toLowerCase()}`;
    let request;
    const stdin = ["Inspect", "Cleanup"].includes(action);
    const actionFirst = stdin || action === "PolicyRestore";
    if (stdin) request = "-";
    else if (action === "PolicyRestore") {
      // The original apply request already names the snapshot. Do not require any
      // new request/evidence write before restoring a possibly applied policy.
      assert.ok(policyApplyRequest, "Missing original policy request");
      request = containedPath(root, policyApplyRequest);
    } else {
      request = join(requests, `${label}.json`);
      writeJson(request, { root, ...body });
      if (action === "PolicyApply") policyApplyRequest = request;
      copyFileSync(request, join(evidence, `${label}-request.json`));
    }
    const execute = () => {
      const output = execFileSync(
        "pwsh",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-File",
          helperPath,
          "-Action",
          action,
          "-Request",
          request,
        ],
        {
          encoding: "utf8",
          timeout,
          maxBuffer: 2 * 1024 * 1024,
          windowsHide: true,
          ...(stdin ? { input: JSON.stringify({ root, ...body }) } : {}),
        },
      );
      return JSON.parse(output.replace(/^\uFEFF/, ""));
    };
    const persist = (value) => {
      if (stdin) writeJson(join(evidence, `${label}-request.json`), { root, ...body });
      writeJson(join(evidence, `${label}-receipt.json`), value);
    };
    try {
      if (actionFirst) {
        const result = actionBeforeEvidence(execute, persist);
        if (result.evidenceError) evidenceErrors.push(result.evidenceError);
        return result.value;
      }
      const value = execute();
      persist(value);
      return value;
    } catch (error) {
      try {
        writeFileSync(
          join(evidence, `${label}-error.txt`),
          `${error.message}\n${error.stdout ?? ""}\n${error.stderr ?? ""}`.replace(/\r\n/g, "\n"),
        );
      } catch (receiptError) {
        throw new AggregateError([error, receiptError], `${action} and its evidence failed`, {
          cause: error,
        });
      }
      throw error;
    }
  }
  const children = [];
  const known = new Map();
  let fixture;
  let driver;
  let app;
  let appIdentity;
  let proof;
  const policySnapshot = join(evidence, "policy-before.json");
  function track(file, args, label, env, extra = {}) {
    containedPath(root, file);
    const log = recordLogErrors(
      createWriteStream(join(evidence, `${label}.log`), { flags: "wx" }),
      evidenceErrors,
    );
    const child = spawn(file, args, {
      env,
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      ...extra,
    });
    const entry = { child, file, log, label, exit: null, error: null };
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.once("error", (error) => {
      entry.error = error;
    });
    child.once("exit", (code, signal) => {
      entry.exit = { code, signal, exitedAt: new Date().toISOString() };
    });
    children.push(entry);
    return entry;
  }
  function inspect(entry) {
    assert.ifError(entry.error);
    assert.equal(entry.exit, null, `${entry.label} exited unexpectedly`);
    const value = native("Inspect", {
      process: {
        pid: entry.child.pid,
        executable: entry.file,
        ...(entry.identity ? { created: entry.identity.created } : {}),
      },
    });
    entry.identity = value.process;
    for (const process of value.processes) known.set(process.pid, process);
    return value;
  }
  async function capture(label) {
    await waitUntil("fonts and native motion settle", async () =>
      activeCaptureSettled(
        await driver.read(
          "return {fontsReady: document.fonts.status === 'loaded', animations: document.getAnimations().map(a => ({playState: a.playState, cursorLayer: a.effect?.target?.classList?.contains('cm-cursorLayer') === true, infinite: a.effect?.getTiming().iterations === Infinity}))};",
        ),
      ),
    );
    let previous;
    let identical = 0;
    const snapshot = await waitUntil("three stable native frames", async () => {
      await driver.nextPaint();
      const state = await driver.read(nativeState);
      const bytes = Buffer.from(await driver.command("GET", "screenshot"), "base64");
      assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      identical =
        previous &&
        bytes.equals(previous.bytes) &&
        JSON.stringify(state) === JSON.stringify(previous.state)
          ? identical + 1
          : 1;
      previous = { state, bytes };
      return identical >= 3 && previous;
    });
    writeFileSync(join(evidence, `${label}.png`), snapshot.bytes);
    report.captures.push({
      file: `${label}.png`,
      sha256: sha256(snapshot.bytes),
      state: snapshot.state,
      stableFrames: identical,
    });
    save();
  }
  let failure;
  try {
    report.host = assertHostObservation(native("Host"));
    report.versions = developmentVersions(process.cwd(), root);
    const previous = report.versions.previousVersion;
    const viewRelease = (tag) =>
      JSON.parse(
        execFileSync(
          "gh",
          [
            "release",
            "view",
            ...tag,
            "--repo",
            "rndaom/execs",
            "--json",
            "tagName,isDraft,isPrerelease,publishedAt,assets",
          ],
          { encoding: "utf8", timeout: 60000 },
        ),
      );
    assert.equal(
      viewRelease([]).tagName,
      `v${previous}`,
      "Public latest advanced; refresh fixtures before running",
    );
    const release = viewRelease([`v${previous}`]);
    const selected = selectPreviousNsis(release, previous);
    execFileSync(
      "gh",
      [
        "release",
        "download",
        `v${previous}`,
        "--repo",
        "rndaom/execs",
        "--dir",
        downloads,
        "--pattern",
        selected.artifact.name,
        "--pattern",
        selected.signature.name,
      ],
      { timeout: 180000, stdio: "inherit" },
    );
    const config = JSON.parse(readFileSync("apps/desktop/src-tauri/tauri.conf.json", "utf8"));
    report.publicPackage = {
      ...verifyPublicPackage(downloads, selected, config.plugins.updater.pubkey),
      release,
    };
    mkdirSync(join(root, "fixture"));
    fixture = seedWindowsFixture(join(root, "fixture"), previous);
    report.fixture = {
      provenance: fixture.provenance,
      childEnv: fixture.childEnv,
      activeProfileId: fixture.activeProfileId,
      activeProfileName: fixture.activeProfileName,
    };
    cpSync(fixture.data, join(evidence, "original-appdata"), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    cpSync(fixture.tf2Root, join(evidence, "original-tf2"), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    report.checks.push({ phase: "before-install", ...assertWindowsFixturePreserved(fixture) });
    const env = windowsAppEnvironment(fixture, process.env);
    const install = join(root, "installed");
    containedPath(root, install, true);
    assert.ok(!existsSync(install));
    // NSIS /D must be last and unquoted, including when its absolute path has spaces.
    const installer = track(
      report.publicPackage.path,
      ["/S", `/D=${install}`],
      "previous-installer",
      env,
      { windowsVerbatimArguments: true },
    );
    await waitUntil(
      "previous NSIS completes",
      () => {
        assert.ifError(installer.error);
        return installer.exit;
      },
      180000,
    );
    assert.equal(installer.exit.code, 0);
    assert.equal(installer.exit.signal, null);
    report.installer = { ...installer.exit, destination: install };
    const application = containedPath(root, join(install, "execs.exe"));
    const binaryHash = sha256(regularFile(application));
    const notice = containedPath(root, join(install, "notices", "DEPENDENCIES.txt"));
    report.installed = {
      path: application,
      sha256: binaryHash,
      noticeSha256: sha256(regularFile(notice)),
    };
    const afterInstall = native("Host");
    assert.deepEqual(afterInstall.playerProcesses, [], "Installer unexpectedly launched a process");
    assert.deepEqual(afterInstall.steamRegistry, []);
    report.checks.push({
      phase: "after-install",
      ...assertWindowsFixturePreserved(fixture),
      host: afterInstall,
    });
    const debugPort = await freePort();
    report.policy = native("PolicyApply", {
      snapshot: policySnapshot,
      userData: fixture.webview,
      port: debugPort,
    });
    app = track(application, [], "previous-app", env);
    const observed = await waitUntil(
      "installed WebView2 starts",
      () => {
        const value = inspect(app);
        return (
          value.processes.some((row) => /[\\/]msedgewebview2\.exe$/i.test(row.executable)) && value
        );
      },
      30000,
    );
    appIdentity = observed.process;
    assert.match(observed.version, new RegExp(`^${previous.replaceAll(".", "\\.")}(?:\\.0)?$`));
    const debugging = await waitUntil("owned private loopback debug listener", () => {
      const value = inspect(app);
      return value.listeners.some((row) => row.port === debugPort) && value;
    });
    assertDebugListener(debugging, debugPort, fixture.webview);
    const version = await (
      await fetch(`http://127.0.0.1:${debugPort}/json/version`, {
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      })
    ).json();
    assert.match(version.Browser, /^(?:Edg|Microsoft Edge)\/\d+\.\d+\.\d+\.\d+$/);
    const runtime = version.Browser.split("/")[1];
    const driverUrl = `https://msedgedriver.microsoft.com/${runtime}/edgedriver_win64.zip`;
    const response = await fetch(driverUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(60000),
    });
    assert.equal(response.status, 200, "Matching official Edge driver unavailable");
    const driverZip = await readBoundedResponse(response, 32 * 1024 * 1024);
    const archive = join(downloads, "edgedriver.zip");
    writeFileSync(archive, driverZip, { flag: "wx" });
    const driverBinary = join(downloads, "msedgedriver.exe");
    const driverReceipt = native("ExtractDriver", { archive, destination: driverBinary });
    assert.equal(driverReceipt.version, runtime);
    report.webview = {
      version: runtime,
      versionEndpoint: version,
      observation: debugging,
      driver: { ...driverReceipt, url: driverUrl, archiveSha256: sha256(driverZip) },
    };
    const driverPort = await freePort();
    assert.notEqual(driverPort, debugPort);
    const driverProcess = track(driverBinary, edgeDriverArguments(driverPort), "edge-driver", env);
    driver = new NativeWebDriver(driverPort);
    await waitUntil("external Edge driver ready", async () => {
      assert.ifError(driverProcess.error);
      assert.equal(driverProcess.exit, null);
      return (await driver.request("GET", "/status")).ready;
    });
    const driverObservation = inspect(driverProcess);
    assertDriverListener(driverObservation, driverPort);
    await attachWebView(driver, debugPort);
    report.capabilities = driver.capabilities;
    const page = await waitUntil(
      "actual installed production UI",
      async () => {
        const value = await driver.read(nativeState);
        return value.profile && value.profiles.length === 2 && value;
      },
      30000,
    );
    assertNativePage(page, fixture.activeProfileName);
    if (await driver.read("return Boolean(document.querySelector('[data-testid=release-notes]'));"))
      await driver.key("\uE00C");
    await capture("01-installed-old-app");
    const summary = '[data-testid="profile-library"] summary';
    const click = await driver.observeClick(summary);
    const webviewInput = { phase: "genuine-webview-input", click };
    report.checks.push(webviewInput);
    save();
    assert.equal(classifyClickTrace(click), "on-target");
    assert.equal((await driver.read(nativeState)).menuOpen, true);
    await driver.key("\uE004");
    const focus = await driver.read(
      "return {inside: document.querySelector('[data-testid=profile-library]').contains(document.activeElement), summary: document.activeElement?.tagName === 'SUMMARY', tag: document.activeElement?.tagName, text: document.activeElement?.textContent};",
    );
    webviewInput.keyboard = { key: "Tab", focus };
    save();
    assert.equal(focus.inside, true);
    assert.equal(focus.summary, false);
    await capture("02-old-profile-menu");
    const exportClick = await driver.observeClick(
      `[data-testid="profile-export"][aria-label="Export ${fixture.activeProfileName}"]`,
    );
    report.checks.push({ phase: "export-click", trace: exportClick });
    save();
    assert.equal(classifyClickTrace(exportClick), "on-target");
    report.nativeSave = native("Save", {
      process: appIdentity,
      destination: fixture.exportPath,
      capture: join(evidence, "03-native-export-save.png"),
      observation: join(evidence, "native-save-observations.json"),
    });
    await waitUntil("native export written to exact requested path", () =>
      existsSync(fixture.exportPath),
    );
    proof = inspectWindowsExport(fixture);
    copyFileSync(fixture.exportPath, join(evidence, "previous-ui-export.zip"));
    report.archive = proof;
    await driver.key("\uE00C");
    await capture("04-export-complete");
    inspect(app);
    report.closeRequest = native("Close", { process: appIdentity });
    await waitUntil("normal native close before any driver/process cleanup", () => app.exit);
    report.normalClose = assertNormalExit({
      ...app.exit,
      request: report.closeRequest.request,
      observedBeforeCleanup: true,
      forced: false,
    });
    report.checks.push({
      phase: "after-normal-close",
      ...assertWindowsFixturePreserved(fixture, proof),
    });
    assert.equal(sha256(regularFile(application)), binaryHash);
    report.status = "passed";
  } catch (error) {
    failure = error;
    report.status = "failed";
    report.error = { message: error.message, stack: error.stack };
    if (driver?.sessionId) {
      try {
        await capture("failure-last-webview");
      } catch (captureError) {
        report.captureError = captureError.message;
      }
    }
  } finally {
    try {
      await finishWindowsProbe(
        failure,
        (error) => {
          if (error) {
            report.status = "failed";
            report.finalErrors = (error instanceof AggregateError ? error.errors : [error]).map(
              (value) => value.message,
            );
          }
          save();
        },
        [
          async () => {
            if (app && !app.exit) {
              try {
                inspect(app);
              } catch (error) {
                report.cleanup.push({ phase: "inspect-before-cleanup", error: error.message });
              }
            }
            if (driver?.sessionId) {
              try {
                await driver.close();
              } catch (error) {
                if (!app?.exit) throw error;
                report.cleanup.push({ phase: "driver-detach-after-exit", message: error.message });
              }
            }
          },
          async () => {
            const errors = [];
            if (known.size) {
              try {
                const receipt = native("Cleanup", {
                  processes: [...known.values()],
                  userData: fixture.webview,
                });
                report.cleanup.push(receipt);
                await observeCleanupExits(children, receipt);
              } catch (error) {
                errors.push(error);
              }
            }
            for (const entry of children) {
              try {
                if (!entry.exit && entry.child.pid) {
                  // Reconfirm the owned child identity before cleanup; never kill by executable name.
                  const value = inspect(entry);
                  const receipt = native("Cleanup", {
                    processes: value.processes,
                    userData: fixture.webview,
                  });
                  report.cleanup.push(receipt);
                  await observeCleanupExits([entry], receipt);
                }
              } catch (error) {
                errors.push(error);
              } finally {
                entry.child.stdout.unpipe(entry.log);
                entry.child.stderr.unpipe(entry.log);
                entry.log.end();
                try {
                  await finished(entry.log);
                } catch (error) {
                  errors.push(error);
                }
              }
            }
            if (errors.length) throw new AggregateError(errors, "Owned process cleanup failed");
          },
          async () => {
            if (existsSync(policySnapshot))
              report.cleanup.push(native("PolicyRestore", { snapshot: policySnapshot }));
          },
          async () => {
            if (fixture) report.finalPreservation = assertWindowsFixturePreserved(fixture, proof);
          },
          async () => {
            if (evidenceErrors.length)
              throw new AggregateError(
                evidenceErrors,
                "Native evidence writes failed after actions",
              );
          },
        ],
      );
    } catch (error) {
      failure = error;
    }
  }
  if (failure) throw failure;
  console.log(`Previous-public NSIS capability proof passed. Evidence: ${evidence}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
