import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, join, resolve } from "node:path";
import {
  assertNoSteamDirectories,
  assertPackageFixturePreserved,
  createSmokeScratch,
  linuxSteamCandidates,
  seedPackageFixture,
} from "./package-smoke-fixture.mjs";
import {
  previousReleaseVersion,
  releaseInstallerName,
  releaseVersion,
} from "./release-version.mjs";

assert.equal(process.env.CI, "true", "Installer smoke runs only on disposable CI workers");
assert.equal(
  process.env.GITHUB_ACTIONS,
  "true",
  "Installer smoke requires the disposable GitHub runner",
);
const windows = process.platform === "win32";
assert.ok(windows || process.platform === "linux", "Unsupported package smoke platform");
const version = releaseVersion(process.cwd());
const oldVersion = previousReleaseVersion(process.cwd(), version);
const scratch = createSmokeScratch(process.env.RUNNER_TEMP);
const fixture = seedPackageFixture(scratch, windows, oldVersion);
const childEnv = { ...process.env, ...fixture.childEnv };
// The app's Steam/Cloud discovery also uses the registry or HOME. Changing
// APPDATA/XDG alone is not a sandbox for a worker with a real Steam account.
const steamCandidates = windows
  ? JSON.parse(
      execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `
    $ErrorActionPreference = 'Stop'
    $candidates = @()
    $currentUserSteam = 'HKCU:\\Software\\Valve\\Steam'
    if (Test-Path -LiteralPath $currentUserSteam) {
      $properties = Get-ItemProperty -LiteralPath $currentUserSteam
      foreach ($name in @('SteamPath', 'InstallPath')) {
        if ($properties.$name) { $candidates += [string]$properties.$name }
      }
    }
    $machineSteam = 'HKLM:\\SOFTWARE\\WOW6432Node\\Valve\\Steam'
    if (Test-Path -LiteralPath $machineSteam) {
      $properties = Get-ItemProperty -LiteralPath $machineSteam
      if ($properties.InstallPath) { $candidates += [string]$properties.InstallPath }
    }
    ConvertTo-Json -InputObject @($candidates)
  `,
        ],
        { encoding: "utf8" },
      ),
    )
  : linuxSteamCandidates(childEnv);
assertNoSteamDirectories(steamCandidates);
const priorProcesses = windows
  ? execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Get-Process -ErrorAction Stop | Where-Object { $_.ProcessName -in @('execs', 'steam', 'tf_win64') } | Select-Object -ExpandProperty ProcessName",
      ],
      { encoding: "utf8" },
    )
  : execFileSync("ps", ["-A", "-o", "comm="], { encoding: "utf8" })
      .split(/\r?\n/)
      .filter((name) => /^(execs|steam|tf_linux64|tf_win64\.exe)$/.test(name.trim()))
      .join("\n");
assert.equal(priorProcesses.trim(), "", "Package smoke requires no running execs, Steam or TF2");
const preservationChecks = [assertPackageFixturePreserved(fixture, "before-install")];
writeFileSync(
  join(scratch, "fixture-baseline.json"),
  `${JSON.stringify(
    {
      provenance: fixture.provenance,
      metadata: fixture.metadata,
      settings: fixture.settings,
      libraryHashes: fixture.libraryHashes,
      liveHashes: fixture.liveHashes,
    },
    null,
    2,
  )}\n`,
);
function verifyPreservation(stage) {
  preservationChecks.push(assertPackageFixturePreserved(fixture, stage));
  writeFileSync(
    join(scratch, "fixture-preservation.json"),
    `${JSON.stringify(preservationChecks, null, 2)}\n`,
  );
}
const bundle = resolve(
  "apps/desktop/src-tauri/target/release/bundle",
  windows ? "nsis" : "appimage",
);
const candidates = readdirSync(bundle).filter(
  (name) => name.includes(`_${version}_`) && name.endsWith(windows ? ".exe" : ".AppImage"),
);
assert.equal(candidates.length, 1, "Exactly one installer for the candidate revision is required");
const asset = candidates[0];
const bytes = readFileSync(join(bundle, asset));
const signature = readFileSync(join(bundle, `${asset}.sig`), "utf8").trim();
const marker = join(scratch, "updater-verified.txt");
const previousRelease = JSON.parse(
  execFileSync(
    "gh",
    [
      "release",
      "view",
      `v${oldVersion}`,
      "--repo",
      "rndaom/execs",
      "--json",
      "tagName,isDraft,assets",
    ],
    { encoding: "utf8" },
  ),
);
const oldName = releaseInstallerName(previousRelease, oldVersion, windows);
execFileSync(
  "gh",
  [
    "release",
    "download",
    `v${oldVersion}`,
    "--repo",
    "rndaom/execs",
    "--pattern",
    oldName,
    "--dir",
    scratch,
    "--clobber",
  ],
  { stdio: "inherit" },
);
// AppImage update replaces this file, so retain the public artifact identity now.
const previousArtifactSha256 = createHash("sha256")
  .update(readFileSync(join(scratch, oldName)))
  .digest("hex");
function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env: childEnv,
      stdio: "inherit",
      windowsHide: true,
      ...options,
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out: ${command}`));
    }, 180000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? resolvePromise() : reject(new Error(`${command} exited ${code}`));
    });
  });
}
const install = join(scratch, "installed");
let executable;
if (windows) {
  await run(join(scratch, oldName), ["/S", `/D=${install}`]);
  executable = join(install, "execs.exe");
  assert.ok(existsSync(executable), "Public installer did not install execs.exe");
} else {
  executable = join(scratch, oldName);
  chmodSync(executable, 0o755);
}
verifyPreservation("after-previous-package-prepared");
const server = createServer((request, response) => {
  if (request.url === "/latest.json") {
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        version,
        notes: "CI updater probe",
        pub_date: "2026-09-05T00:00:00Z",
        platforms: {
          [windows ? "windows-x86_64" : "linux-x86_64"]: {
            url: `http://127.0.0.1:${server.address().port}/artifact`,
            signature,
          },
        },
      }),
    );
  } else if (request.url === "/artifact") {
    response.setHeader("Content-Length", bytes.length);
    response.end(bytes);
  } else {
    response.writeHead(404).end();
  }
});
await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
try {
  const probe = resolve(
    "apps/desktop/src-tauri/target/debug/examples",
    windows ? "updater_probe.exe" : "updater_probe",
  );
  await run(probe, [
    `http://127.0.0.1:${server.address().port}/latest.json`,
    executable,
    marker,
    version,
    oldVersion,
  ]);
  assert.match(readFileSync(marker, "utf8"), /signature-verified/);
  let installedVersion = version;
  if (windows) {
    // NSIS is asynchronous when invoked by the updater, which exits for replacement.
    installedVersion = "";
    for (let attempt = 0; attempt < 90; attempt++) {
      installedVersion = execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "(Get-Item -LiteralPath $env:EXECS_SMOKE_EXE).VersionInfo.ProductVersion",
        ],
        { env: { ...childEnv, EXECS_SMOKE_EXE: executable }, encoding: "utf8" },
      ).trim();
      if (installedVersion === version) break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
    }
    assert.equal(installedVersion, version, "Updater did not replace the installed Windows app");
    assert.ok(existsSync(join(install, "notices", "DEPENDENCIES.txt")), "Packaged notices missing");
  } else {
    assert.equal(
      createHash("sha256").update(readFileSync(executable)).digest("hex"),
      createHash("sha256").update(bytes).digest("hex"),
      "AppImage updater did not replace the old image",
    );
    await run(executable, ["--appimage-extract"], { cwd: scratch });
    const tree = join(scratch, "squashfs-root");
    assert.equal(
      execFileSync("find", [join(tree, "usr"), "-name", "libwayland-*.so*"], {
        encoding: "utf8",
      }).trim(),
      "",
      "AppImage bundles Wayland libraries that can conflict with host EGL drivers",
    );
    assert.ok(
      execFileSync("find", [tree, "-name", "DEPENDENCIES.txt"], { encoding: "utf8" }).trim(),
      "AppImage notices missing",
    );
    const debDir = resolve("apps/desktop/src-tauri/target/release/bundle/deb");
    const deb = readdirSync(debDir).find((name) => name.endsWith(".deb"));
    await run("sudo", ["dpkg", "-i", join(debDir, deb)]);
    assert.equal(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: dpkg-query expands this placeholder.
      execFileSync("dpkg-query", ["-W", "-f=${Version}", "execs"], { encoding: "utf8" }).trim(),
      version,
    );
    assert.ok(
      execFileSync("dpkg", ["-L", "execs"], { encoding: "utf8" }).includes("DEPENDENCIES.txt"),
    );
    executable = join(tree, "AppRun");
  }
  // Use the installed PE revision on Windows; Linux already matched the entire
  // replacement image against the candidate. The signed feed must not loop.
  await run(
    resolve(
      "apps/desktop/src-tauri/target/debug/examples",
      windows ? "updater_check_probe.exe" : "updater_check_probe",
    ),
    [`http://127.0.0.1:${server.address().port}/latest.json`, installedVersion, "none"],
  );
  if (windows) {
    // NSIS /R restarts the upgraded app. Stop only this worker's installed copy
    // so the next launch exercises startup instead of the single-instance handoff.
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10000));
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Get-Process execs -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $env:EXECS_SMOKE_EXE } | Stop-Process -Force",
      ],
      { env: { ...childEnv, EXECS_SMOKE_EXE: executable } },
    );
  }
  verifyPreservation("after-signed-upgrade-and-installer-restart");
  const processObservations = [];
  for (const command of windows ? [executable] : [executable, "/usr/bin/execs"]) {
    const application = spawn(command, [], { env: childEnv, stdio: "inherit", windowsHide: true });
    let launchError;
    let exited = false;
    application.once("exit", () => {
      exited = true;
    });
    application.on("error", (error) => {
      launchError = error;
    });
    try {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10000));
      assert.ifError(launchError);
      assert.equal(exited, false, `Packaged app exited during startup: ${command}`);
      const observation = { command, processSurvivedForMs: 10000, nativeWindowObserved: false };
      if (!windows) {
        assert.ok(
          execFileSync("xdotool", ["search", "--name", "^execs$"], { encoding: "utf8" }).trim(),
          "Packaged app did not create a window",
        );
        observation.nativeWindowObserved = true;
      }
      processObservations.push(observation);
    } finally {
      application.kill();
      for (let attempt = 0; !exited && !launchError && attempt < 50; attempt++) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
      }
      assert.ok(exited || launchError, `Package smoke child did not stop: ${command}`);
    }
    verifyPreservation(`after-packaged-process:${command}`);
  }
  writeFileSync(
    join(scratch, "result.json"),
    `${JSON.stringify(
      {
        version,
        platform: process.platform,
        oldVersion,
        artifact: basename(asset),
        artifactSha256: createHash("sha256").update(bytes).digest("hex"),
        previousArtifact: oldName,
        previousArtifactSha256,
        sourceRevision: process.env.GITHUB_SHA,
        workflowRunId: process.env.GITHUB_RUN_ID,
        signatureVerified: true,
        updateInstalled: true,
        noRepeatOffer: true,
        packagedNotices: true,
        fixtureProvenance: fixture.provenance,
        fixturePreservation: preservationChecks,
        isolation: {
          disposableRunner: true,
          discoverableSteamDirectories: 0,
          preexistingPlayerProcesses: 0,
        },
        processObservations,
        renderedWebviewUsable: "not-verified",
        previousVersionUiReadAndExport: "not-verified",
        candidateUiImportAndSwitch: "not-verified",
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    "PASS: signed updater, installer upgrade, process survival, notices and seeded library preservation; rendered webview and UI round trip remain unverified",
  );
} finally {
  server.close();
}
