import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDevelopmentPackageCheckpoint,
  assertDevelopmentPackageImported,
  assertDevelopmentPackagePreserved,
  assertDevelopmentPackageSwitched,
  developmentPackageEnvironment,
  inspectDevelopmentPackageExport,
  seedDevelopmentPackageFixture,
} from "./development-package-fixture.mjs";
import {
  assertDebianBundledBinary,
  assertDevelopmentHost,
  DEVELOPMENT_CONFIG,
  developmentVersions,
  downloadPublicPackages,
  regularFile,
  requireContained,
  sha256,
  unsignedConfig,
} from "./development-package-guard.mjs";
import { DevelopmentPackageSession } from "./development-package-native.mjs";
import { waitUntil } from "./linux-native-webdriver.mjs";
import { assertNoSteamDirectories, linuxSteamCandidates } from "./package-smoke-fixture.mjs";
import { releaseAssetVersion } from "./release-version.mjs";

export function assertNoPlayerProcesses(output) {
  assert.ok(
    !output
      .split(/\r?\n/)
      .some((name) => /^(execs|steam|tf_linux64|tf_win64\.exe)$/.test(name.trim())),
    "Existing execs, Steam or TF2 process refused",
  );
}

export function candidateName(names, version, kind) {
  assert.ok(["appimage", "deb"].includes(kind));
  const extension = kind === "appimage" ? "AppImage" : "deb";
  const expected = [version, releaseAssetVersion(version)].map(
    (value) => `execs_${value}_amd64.${extension}`,
  );
  const matches = names.filter((name) => expected.includes(name));
  assert.equal(
    matches.length,
    1,
    `Expected exactly one ${kind} candidate with the current revision`,
  );
  return matches[0];
}

/** Always observe the fixture after owned-process cleanup, including on failure. */
export async function finishPackageCase({ primaryError, cleanup, compare, save, row }) {
  const errors = primaryError ? [primaryError] : [];
  row.finalization = [];
  for (const [stage, action] of [
    ["owned-process-cleanup", cleanup],
    ["final-fixture-comparison", compare],
  ]) {
    try {
      await action();
      row.finalization.push({ stage, status: "passed" });
    } catch (error) {
      errors.push(error);
      row.finalization.push({
        stage,
        status: "failed",
        error: error.stack ?? String(error),
        ...(error instanceof AggregateError
          ? { causes: error.errors.map((cause) => cause.stack ?? String(cause)) }
          : {}),
      });
    }
  }
  row.status = errors.length ? "failed" : "passed";
  try {
    await save();
  } catch (error) {
    errors.push(error);
    row.status = "failed";
  }
  if (errors.length > 1)
    return new AggregateError(
      errors,
      "Package case failed; original and finalization errors retained",
      { cause: primaryError ?? errors[0] },
    );
  return errors[0];
}

function installedDeb() {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: These placeholders belong to dpkg-query, not JavaScript.
  const result = spawnSync("dpkg-query", ["-W", "-f=${Status}\n${Version}\n", "execs"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.ifError(result.error);
  if (result.status === 1 && /no packages found/i.test(result.stderr)) return null;
  assert.equal(result.status, 0, result.stderr);
  const [status, version] = result.stdout.trim().split("\n");
  return status === "install ok installed" ? version : null;
}

function packageTree(root) {
  const files = [];
  let count = 0;
  function visit(path) {
    assert.ok(++count < 40_000, "Unbounded extracted package tree");
    const stat = lstatSync(path);
    if (stat.isDirectory() && !stat.isSymbolicLink())
      for (const entry of readdirSync(path)) visit(join(path, entry));
    else files.push(path);
  }
  visit(root);
  return files;
}

function inspectPackage(path, kind, destination, env, version, candidate) {
  mkdirSync(destination);
  const bytes = regularFile(path);
  let tree = destination;
  if (kind === "appimage") {
    chmodSync(path, 0o755);
    execFileSync(path, ["--appimage-extract"], {
      cwd: destination,
      env,
      stdio: "ignore",
      timeout: 90_000,
    });
    tree = join(destination, "squashfs-root");
  } else {
    const field = (name) =>
      execFileSync("dpkg-deb", ["--field", path, name], {
        encoding: "utf8",
        timeout: 10_000,
      }).trim();
    assert.equal(field("Package"), "execs");
    assert.equal(field("Version"), version);
    assert.equal(field("Architecture"), "amd64");
    execFileSync("dpkg-deb", ["--extract", path, destination], { timeout: 90_000 });
  }
  const binary = join(tree, "usr/bin/execs");
  const executable = regularFile(binary);
  assert.equal(executable.subarray(0, 4).toString("hex"), "7f454c46");
  const files = packageTree(tree);
  assert.ok(
    files.some((entry) => entry.endsWith("/DEPENDENCIES.txt")),
    "Packaged notices missing",
  );
  if (kind === "appimage" && candidate)
    assert.ok(
      !files.some((entry) => /\/libwayland-(client|server|cursor|egl)\.so(?:\.\d+)*$/.test(entry)),
      "Candidate AppImage carries conflicting host Wayland libraries",
    );
  return {
    path,
    kind,
    version,
    sha256: sha256(bytes),
    bytes: bytes.length,
    binarySha256: sha256(executable),
    packagedNotices: true,
    ...(kind === "appimage" && candidate ? { bundledWaylandAbsent: true } : {}),
  };
}

export async function main() {
  assertDevelopmentHost();
  assert.equal(process.arch, "x64");
  assert.ok(
    process.env.DISPLAY && process.env.DBUS_SESSION_BUS_ADDRESS,
    "Run in private Xvfb and D-Bus sessions",
  );
  assertNoPlayerProcesses(execFileSync("ps", ["-A", "-o", "comm="], { encoding: "utf8" }));
  assertNoSteamDirectories(linuxSteamCandidates(process.env));
  assert.equal(installedDeb(), null, "Runner already has execs installed");
  assert.ok(!existsSync("/usr/bin/execs"), "Preexisting execs executable refused");
  const parent = realpathSync(process.env.RUNNER_TEMP);
  assert.equal(parent, resolve(process.env.RUNNER_TEMP));
  assert.deepEqual(
    JSON.parse(regularFile(join(parent, DEVELOPMENT_CONFIG), 1024).toString("utf8")),
    unsignedConfig,
  );
  const root = mkdtempSync(join(parent, "execs-development-packages-"));
  const evidence = join(root, "evidence");
  mkdirSync(evidence);
  const versions = developmentVersions(process.cwd(), root);
  const config = JSON.parse(readFileSync("apps/desktop/src-tauri/tauri.conf.json", "utf8"));
  const event = JSON.parse(
    regularFile(process.env.GITHUB_EVENT_PATH, 8 * 1024 * 1024).toString("utf8"),
  );
  const driverPackages = execFileSync("cargo", ["install", "--list"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.match(
    driverPackages,
    /^tauri-driver v2\.0\.6:$/m,
    "Pinned external driver is not installed",
  );
  const driverPath = realpathSync(
    execFileSync("which", ["tauri-driver"], { encoding: "utf8", timeout: 10_000 }).trim(),
  );
  const report = {
    schema: 1,
    status: "running",
    platform: "linux-x86_64",
    ...versions,
    sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    tools: {
      node: process.version,
      tauriCli: JSON.parse(readFileSync("node_modules/@tauri-apps/cli/package.json", "utf8"))
        .version,
      // Pinned tauri-driver has --help but no --version; use Cargo's receipt.
      tauriDriver: { version: "2.0.6", path: driverPath, sha256: sha256(regularFile(driverPath)) },
      packages: execFileSync(
        "dpkg-query",
        ["-W", "libwebkit2gtk-4.1-0", "webkit2gtk-driver", "libfuse2", "fuse3", "xdotool"],
        { encoding: "utf8", timeout: 10_000 },
      ).trim(),
      runnerImage: { os: process.env.ImageOS ?? null, version: process.env.ImageVersion ?? null },
    },
    workflow: {
      runId: process.env.GITHUB_RUN_ID,
      attempt: process.env.GITHUB_RUN_ATTEMPT,
      event: process.env.GITHUB_EVENT_NAME,
      eventSha: process.env.GITHUB_SHA,
      pullRequestHead: event.pull_request?.head?.sha ?? null,
      pullRequestBase: event.pull_request?.base?.sha ?? null,
    },
    scope:
      "Unsigned Linux development packages: authenticated previous public packages, normal FUSE AppImage manual replacement, Debian package-manager upgrade/first install and native profile round trip. No release operations.",
    override: unsignedConfig,
    notQualified: [
      "Windows NSIS (not implemented)",
      "production signed self-update",
      "real updater UI lifecycle",
      "Authenticode",
      "Steam Cloud",
      "retail TF2",
      "media decoding",
      "other Linux distributions/Wayland",
    ],
    plannedCases: ["appimage-upgrade", "deb-upgrade", "deb-first-install"],
    unstartedCases: ["appimage-upgrade", "deb-upgrade", "deb-first-install"],
    cases: [],
  };
  const saveReport = () =>
    writeFileSync(join(evidence, "results.json"), `${JSON.stringify(report, null, 2)}\n`);
  saveReport();
  let error;
  try {
    const downloads = join(root, "public");
    mkdirSync(downloads);
    const previous = downloadPublicPackages(
      downloads,
      versions.previousVersion,
      config.plugins.updater.pubkey,
    );
    report.previousRelease = previous.release;
    report.previousPackages = previous.packages;
    const candidate = {};
    for (const kind of ["appimage", "deb"]) {
      const directory = resolve("apps/desktop/src-tauri/target/release/bundle", kind);
      candidate[kind] = join(
        directory,
        candidateName(readdirSync(directory), versions.version, kind),
      );
      regularFile(candidate[kind]);
    }
    const buildBinary = regularFile(resolve("apps/desktop/src-tauri/target/release/execs"));
    const expectedBinary = sha256(buildBinary);
    report.buildTreeBinarySha256 = expectedBinary;
    for (const [kind, upgrade] of [
      ["appimage", true],
      ["deb", true],
      ["deb", false],
    ]) {
      assertNoPlayerProcesses(execFileSync("ps", ["-A", "-o", "comm="], { encoding: "utf8" }));
      const label = `${kind}-${upgrade ? "upgrade" : "first-install"}`;
      const fixture = seedDevelopmentPackageFixture(root, versions.previousVersion);
      const childEnv = developmentPackageEnvironment(fixture, process.env);
      const caseEvidence = join(evidence, label);
      mkdirSync(caseEvidence);
      const row = {
        label,
        status: "running",
        fixture: fixture.provenance,
        isolation: fixture.childEnv,
        checks: [],
        captures: [],
        preservation: [],
      };
      report.unstartedCases = report.unstartedCases.filter((entry) => entry !== label);
      report.cases.push(row);
      writeFileSync(
        join(caseEvidence, "fixture-baseline.json"),
        `${JSON.stringify(fixture, null, 2)}\n`,
      );
      const saveCase = () => {
        writeFileSync(join(caseEvidence, "results.json"), `${JSON.stringify(row, null, 2)}\n`);
        saveReport();
      };
      saveCase();
      let session;
      let archive;
      let caseError;
      let checkpoint = assertDevelopmentPackagePreserved(fixture, "before-package-installation");
      row.preservation.push(checkpoint);
      const preserve = (stage) => {
        checkpoint = assertDevelopmentPackageCheckpoint(fixture, checkpoint, stage);
        row.preservation.push(checkpoint);
        saveCase();
      };
      const install = (path, expectedVersion) => {
        execFileSync(
          "sudo",
          ["-n", "apt-get", "install", "--yes", "--no-install-recommends", path],
          { stdio: "inherit", timeout: 180_000 },
        );
        assert.equal(installedDeb(), expectedVersion);
        assert.ok(
          execFileSync("dpkg", ["-L", "execs"], { encoding: "utf8" }).includes("DEPENDENCIES.txt"),
        );
      };
      const application =
        kind === "appimage" ? join(fixture.scratch, "installed.AppImage") : "/usr/bin/execs";
      const launch = async (inspection, name) => {
        session = new DevelopmentPackageSession({
          application,
          binarySha256: inspection.binarySha256,
          kind,
          fixture,
          childEnv,
          evidence: caseEvidence,
          report: row,
          saveReport: saveCase,
        });
        await session.launch(name);
      };
      try {
        const inspectedCandidate = inspectPackage(
          candidate[kind],
          kind,
          join(fixture.scratch, "candidate-inspection"),
          childEnv,
          versions.version,
          true,
        );
        // Tauri patches the package kind into a copy for each bundle, then
        // restores the build ELF. Require precisely that Debian marker change.
        if (kind === "deb") {
          const bundledBinary = regularFile(
            join(fixture.scratch, "candidate-inspection", "usr/bin/execs"),
          );
          row.debianBundleIdentity = assertDebianBundledBinary(buildBinary, bundledBinary);
          assert.equal(row.debianBundleIdentity.packagedSha256, inspectedCandidate.binarySha256);
        }
        row.candidate = inspectedCandidate;
        if (upgrade) {
          const old = inspectPackage(
            previous.packages[kind].path,
            kind,
            join(fixture.scratch, "previous-inspection"),
            childEnv,
            versions.previousVersion,
            false,
          );
          row.previous = old;
          if (kind === "appimage") {
            copyFileSync(old.path, application);
            chmodSync(application, 0o755);
          } else install(old.path, versions.previousVersion);
          preserve("after-previous-install");
          await launch(old, "previous-launch");
          await session.readProfile(
            fixture.expectedConfigText,
            fixture.activeProfileName,
            "previous-profile-read",
          );
          preserve("previous-native-read");
          await session.exportPrevious(fixture.exportPath, fixture.activeProfileName);
          archive = inspectDevelopmentPackageExport(fixture);
          row.previousUiExport = archive;
          copyFileSync(fixture.exportPath, join(caseEvidence, "previous-ui-export.zip"));
          checkpoint = assertDevelopmentPackagePreserved(
            fixture,
            "previous-native-export",
            archive,
          );
          row.preservation.push(checkpoint);
          await session.close("previous-close-before-upgrade");
          preserve("previous-closed");
        }
        if (kind === "appimage") {
          assert.equal(sha256(regularFile(application)), row.previous.sha256);
          const staged = requireContained(fixture.scratch, `${application}.candidate`);
          copyFileSync(inspectedCandidate.path, staged);
          chmodSync(staged, 0o755);
          renameSync(staged, application);
          assert.equal(sha256(regularFile(application)), inspectedCandidate.sha256);
          row.transition = "manual complete AppImage replacement; not updater installation";
        } else {
          install(inspectedCandidate.path, versions.version);
          assert.equal(sha256(regularFile(application)), inspectedCandidate.binarySha256);
          row.transition = upgrade
            ? "Debian package-manager upgrade"
            : "Debian fresh package installation";
        }
        preserve("after-candidate-package-install");
        await launch(inspectedCandidate, "candidate-launch");
        await session.readProfile(
          fixture.expectedConfigText,
          fixture.activeProfileName,
          "candidate-preserved-profile-read",
        );
        preserve("candidate-preserved-native-read");
        if (upgrade) {
          await session.importPrevious(fixture.exportPath);
          checkpoint = assertDevelopmentPackageImported(fixture, archive, "candidate-ui-import");
          row.preservation.push(checkpoint);
          await session.switchImported(checkpoint.importedProfileName);
          checkpoint = await waitUntil(
            "candidate switch commits exact projection",
            () => assertDevelopmentPackageSwitched(fixture, checkpoint, "candidate-ui-switch"),
            30_000,
          );
          row.preservation.push(checkpoint);
          await session.readProfile(
            fixture.expectedConfigText,
            checkpoint.importedProfileName,
            "candidate-switched-profile-read",
          );
          preserve("candidate-switched-native-read");
        }
        await session.close("candidate-close-before-reopen");
        preserve("candidate-closed");
        await launch(inspectedCandidate, "candidate-reopen");
        await session.readProfile(
          fixture.expectedConfigText,
          checkpoint.importedProfileName ?? fixture.activeProfileName,
          "candidate-profile-after-reopen",
        );
        preserve("candidate-native-reopen");
        await session.close("candidate-final-close");
        preserve("candidate-final-exit");
        if (kind === "deb") {
          assertNoPlayerProcesses(execFileSync("ps", ["-A", "-o", "comm="], { encoding: "utf8" }));
          assert.equal(
            installedDeb(),
            versions.version,
            "Only this run's installed candidate may be removed",
          );
          execFileSync("sudo", ["-n", "dpkg", "--remove", "execs"], {
            stdio: "inherit",
            timeout: 90_000,
          });
          assert.equal(installedDeb(), null);
          assert.ok(!existsSync("/usr/bin/execs"));
          preserve("after-owned-package-removal");
        }
        row.status = "passed";
      } catch (cause) {
        caseError = cause;
        row.status = "failed";
        row.error = cause.stack ?? String(cause);
        if (cause.copyDiagnostics) row.copyDiagnostics = cause.copyDiagnostics;
        if (session?.driver?.sessionId) {
          try {
            await session.capture("failure");
          } catch (captureError) {
            row.captureError = String(captureError);
          }
        }
      } finally {
        caseError = await finishPackageCase({
          primaryError: caseError,
          cleanup: () => session?.stop(),
          compare: () => preserve("after-final-owned-process-cleanup"),
          save: saveCase,
          row,
        });
      }
      if (caseError) throw caseError;
    }
    report.status = "passed";
  } catch (cause) {
    error = cause;
    report.status = "failed";
    report.error = cause.stack ?? String(cause);
  } finally {
    saveReport();
    console.log(`Development Linux packages ${report.status}; fixture-only evidence: ${evidence}`);
  }
  if (error) throw error;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await main();
