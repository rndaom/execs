import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Writable } from "node:stream";
import { finished } from "node:stream/promises";
import test from "node:test";
import { publicProfileFixture } from "./package-smoke-fixture.mjs";
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
  windowsAppEnvironment,
} from "./windows-package-contract.mjs";
import {
  actionBeforeEvidence,
  assertDebugListener,
  assertDriverListener,
  assertNativePage,
  attachWebView,
  edgeDriverArguments,
  finalizeProbe,
  finishWindowsProbe,
  observeCleanupExits,
  readBoundedResponse,
  recordLogErrors,
  windowsNativeShell,
} from "./windows-package-smoke.mjs";

const python =
  process.env.EXECS_TEST_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const retained = resolve(
  "docs/design/2026-09-22-overhaul/implementation/profile-management/compatibility-v018/no-hud/exported-by-v0.1.8.zip",
);

function withFixture(fn) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "execs-windows-package-test-")));
  const scratch = join(parent, "fixture");
  mkdirSync(scratch);
  try {
    return fn(seedWindowsFixture(scratch, "0.1.8"), parent);
  } finally {
    assert.equal(dirname(parent), realpathSync(tmpdir()));
    assert.ok(basename(parent).startsWith("execs-windows-package-test-"));
    assert.equal(realpathSync(parent), parent);
    rmSync(parent, { recursive: true, force: true });
  }
}

const env = {
  CI: "true",
  GITHUB_ACTIONS: "true",
  RUNNER_OS: "Windows",
  RUNNER_ENVIRONMENT: "github-hosted",
  GITHUB_REPOSITORY: "rndaom/execs",
  RUNNER_TEMP: "D:\\a\\_temp",
  GITHUB_REF: "refs/pull/60/merge",
  GITHUB_EVENT_NAME: "pull_request",
};
const event = {
  repository: { full_name: "rndaom/execs" },
  pull_request: { head: { repo: { full_name: "rndaom/execs" } } },
};

test("only native UI actions select the canonical local Windows PowerShell executable", () => {
  const windowsDirectory = "C:\\Windows";
  const desktop = {
    command: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    sta: true,
  };
  for (const action of ["Save", "Close"])
    assert.deepEqual(windowsNativeShell(action, windowsDirectory), desktop);
  for (const action of [
    "Host",
    "PolicyApply",
    "PolicyRestore",
    "Inspect",
    "Cleanup",
    "ExtractDriver",
  ])
    assert.deepEqual(windowsNativeShell(action, windowsDirectory), { command: "pwsh", sta: false });
  for (const path of [
    "C:Windows",
    "\\Windows",
    "\\\\server\\share\\Windows",
    "\\\\?\\C:\\Windows",
    "C:\\Windows\\..\\other",
  ])
    assert.throws(() => windowsNativeShell("Save", path));
});

test("Desktop PowerShell loads the Framework UI Automation client in STA", {
  skip: process.platform !== "win32",
}, () => {
  const shell = windowsNativeShell("Save", process.env.WINDIR);
  assert.equal(realpathSync.native(shell.command).toLowerCase(), shell.command.toLowerCase());
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$wpf = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\WPF'
Add-Type -LiteralPath (Join-Path $wpf 'UIAutomationTypes.dll')
Add-Type -LiteralPath (Join-Path $wpf 'UIAutomationClient.dll')
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$root = [Windows.Automation.AutomationElement]::RootElement
if (-not $root) { throw 'UI Automation root unavailable.' }
[pscustomobject]@{ edition = $PSVersionTable.PSEdition; apartment = [Threading.Thread]::CurrentThread.GetApartmentState().ToString()
    root = $true; types = [Reflection.AssemblyName]::GetAssemblyName((Join-Path $wpf 'UIAutomationTypes.dll')).FullName } | ConvertTo-Json -Compress
`;
  const result = spawnSync(
    shell.command,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Sta",
      "-ExecutionPolicy",
      "RemoteSigned",
      "-Command",
      script,
    ],
    { encoding: "utf8", timeout: 10_000, windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  const actual = JSON.parse(result.stdout.replace(/^\uFEFF/, "").trim());
  assert.equal(actual.edition, "Desktop");
  assert.equal(actual.apartment, "STA");
  assert.equal(actual.root, true);
  assert.match(actual.types, /^UIAutomationTypes, Version=4\.0\.0\.0,/);
});

test("native Save accepts only the unique foreground dialog in the exact app process", {
  skip: process.platform !== "win32",
}, () => {
  const helper = resolve("scripts/windows-package-identity.ps1").replaceAll("'", "''");
  const script = `
. '${helper}'
$main = [pscustomobject]@{ title = 'execs'; class = 'Tauri Window'; visible = $true; pid = 5668; nativePid = 5668; handle = 131532; owner = 0 }
$dialog = [pscustomobject]@{ title = 'Export profile'; class = '#32770'; visible = $true; pid = 5668; nativePid = 5668; handle = 66172; owner = 0 }
function Check($Candidate, $Windows, [long]$Foreground = 66172) {
    try { return Assert-ExportDialogIdentity $Candidate $Windows 5668 $Foreground }
    catch { return 'refused' }
}
$windowOwned = [pscustomobject]@{ title = 'Export profile'; class = '#32770'; visible = $true; pid = 5668; nativePid = 5668; handle = 66172; owner = 131532 }
$otherDialog = [pscustomobject]@{ title = 'Open'; class = '#32770'; visible = $true; pid = 5668; nativePid = 5668; handle = 66200; owner = 0 }
$foreignProcess = [pscustomobject]@{ title = 'Export profile'; class = '#32770'; visible = $true; pid = 7777; nativePid = 7777; handle = 66172; owner = 0 }
$spoofedHandle = [pscustomobject]@{ title = 'Export profile'; class = '#32770'; visible = $true; pid = 5668; nativePid = 7777; handle = 66172; owner = 0 }
$foreignOwner = [pscustomobject]@{ title = 'Export profile'; class = '#32770'; visible = $true; pid = 5668; nativePid = 5668; handle = 66172; owner = 99999 }
[pscustomobject]@{
    processOwned = Check $dialog @($main, $dialog)
    windowOwned = Check $windowOwned @($main, $windowOwned)
    samePidUnrelatedDialog = Check $otherDialog @($main, $otherDialog)
    competingSamePidDialog = Check $dialog @($main, $dialog, $otherDialog)
    foreignProcess = Check $foreignProcess @($main, $foreignProcess)
    spoofedHandle = Check $spoofedHandle @($main, $spoofedHandle)
    foreignOwner = Check $foreignOwner @($main, $foreignOwner)
    lostForeground = Check $dialog @($main, $dialog) 99999
    missingMain = Check $dialog @($dialog)
    duplicateMain = Check $dialog @($main, $main, $dialog)
} | ConvertTo-Json -Compress
`;
  for (const command of ["pwsh", windowsNativeShell("Save", process.env.WINDIR).command]) {
    const result = spawnSync(
      command,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        ...(command === "pwsh" ? [] : ["-ExecutionPolicy", "RemoteSigned"]),
        "-Command",
        script,
      ],
      { encoding: "utf8", timeout: 10_000, windowsHide: true },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.replace(/^\uFEFF/, "").trim()), {
      processOwned: "process-owned-top-level",
      windowOwned: "main-window-owned",
      samePidUnrelatedDialog: "refused",
      competingSamePidDialog: "refused",
      foreignProcess: "refused",
      spoofedHandle: "refused",
      foreignOwner: "refused",
      lostForeground: "refused",
      missingMain: "refused",
      duplicateMain: "refused",
    });
  }
});

test(
  "both PowerShell editions retain owned-path containment and reject reparse points",
  {
    skip: process.platform !== "win32",
  },
  () =>
    withFixture((fixture, parent) => {
      const link = join(fixture.scratch, "native-redirect");
      symlinkSync(parent, link, "junction");
      const helper = resolve("scripts/windows-package-identity.ps1").replaceAll("'", "''");
      const script = String.raw`
$ErrorActionPreference = 'Stop'
. '${helper}'
function Refused([string]$candidate, [bool]$missingLeaf = $false) {
    try { $null = Assert-Contained $env:EXECS_TEST_ROOT $candidate $missingLeaf; return $false }
    catch { return $true }
}
$valid = Assert-Contained $env:EXECS_TEST_ROOT $env:EXECS_TEST_VALID
$missing = Assert-Contained $env:EXECS_TEST_ROOT $env:EXECS_TEST_MISSING $true
[pscustomobject]@{
    valid = $valid -eq [IO.Path]::GetFullPath($env:EXECS_TEST_VALID)
    missing = $missing -eq [IO.Path]::GetFullPath($env:EXECS_TEST_MISSING)
    relative = Refused 'exports\previous-ui-export.zip'
    driveRelative = Refused ($env:EXECS_TEST_ROOT.Substring(0, 1) + ':exports\previous-ui-export.zip')
    rootRelative = Refused '\exports\previous-ui-export.zip'
    sibling = Refused $env:EXECS_TEST_SIBLING
    missingAncestor = Refused $env:EXECS_TEST_MISSING_ANCESTOR $true
    reparse = Refused $env:EXECS_TEST_LINKED
    root = Refused $env:EXECS_TEST_ROOT
    uncQualified = Test-FullyQualifiedWindowsPath '\\server\share\file'
    deviceRejected = -not (Test-FullyQualifiedWindowsPath '\\?\C:\file')
} | ConvertTo-Json -Compress
`;
      const environment = {
        ...process.env,
        EXECS_TEST_ROOT: fixture.scratch,
        EXECS_TEST_VALID: join(fixture.scratch, "exports"),
        EXECS_TEST_MISSING: fixture.exportPath,
        EXECS_TEST_SIBLING: join(parent, "fixture-sibling", "file"),
        EXECS_TEST_MISSING_ANCESTOR: join(fixture.scratch, "missing", "file"),
        EXECS_TEST_LINKED: join(link, "exports"),
      };
      for (const command of ["pwsh", windowsNativeShell("Save", process.env.WINDIR).command]) {
        const result = spawnSync(
          command,
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            ...(command === "pwsh" ? [] : ["-ExecutionPolicy", "RemoteSigned"]),
            "-Command",
            script,
          ],
          { encoding: "utf8", timeout: 10_000, windowsHide: true, env: environment },
        );
        assert.equal(result.status, 0, result.stderr);
        const actual = JSON.parse(result.stdout.replace(/^\uFEFF/, "").trim());
        for (const [name, value] of Object.entries(actual))
          assert.equal(value, true, `${command}: ${name}`);
      }
    }),
);

test("PowerShell process identity compares exact UTC ticks after JSON date conversion", {
  skip: process.platform !== "win32",
}, () => {
  const helper = resolve("scripts/windows-package-identity.ps1").replaceAll("'", "''");
  const script = `
. '${helper}'
$actual = '2026-09-24T01:15:58.1247050Z'
$json = '{"created":"2026-09-24T01:15:58.1247050Z"}' | ConvertFrom-Json
if ($json.created -isnot [DateTime]) { throw 'The test did not exercise JSON DateTime conversion.' }
$same = Test-ProcessCreatedMatch $actual $json.created
$different = Test-ProcessCreatedMatch $actual '2026-09-24T01:15:58.1247051Z'
$malformedRejected = $false
try { $null = Test-ProcessCreatedMatch $actual 'invalid' } catch { $malformedRejected = $true }
[pscustomobject]@{ same = $same; different = $different; malformedRejected = $malformedRejected } | ConvertTo-Json -Compress
`;
  const result = spawnSync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", timeout: 10_000, windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    same: true,
    different: false,
    malformedRejected: true,
  });
});

test("PowerShell cleanup admits only a direct console host child of the same owned driver process", {
  skip: process.platform !== "win32",
}, () => {
  const helper = resolve("scripts/windows-package-identity.ps1").replaceAll("'", "''");
  const script = `
. '${helper}'
$root = 'D:\\a\\_temp\\execs-windows-package-o5N4XO'
$windowsDirectory = 'C:\\Windows'
$driver = [pscustomobject]@{ pid = 5740; executable = "$root\\downloads\\msedgedriver.exe"; created = '2026-09-24T01:46:25.1929830Z' }
$child = [pscustomobject]@{ pid = 2756; parent = 5740; executable = "$windowsDirectory\\System32\\conhost.exe"; created = '2026-09-24T01:46:25.1985680Z' }
$parent = [pscustomobject]@{ pid = 5740; executable = $driver.executable; created = $driver.created }
$accepted = Test-OwnedConsoleHost $child $child @($driver) $parent $root $windowsDirectory
$reusedPid = Test-OwnedConsoleHost $child $child @($driver) ([pscustomobject]@{ pid = 5740; executable = $driver.executable; created = '2026-09-24T01:46:26.1929830Z' }) $root $windowsDirectory
$otherParent = Test-OwnedConsoleHost $child $child @([pscustomobject]@{ pid = 5740; executable = "$root\\installed\\execs.exe"; created = $driver.created }) $parent $root $windowsDirectory
$otherChild = Test-OwnedConsoleHost ([pscustomobject]@{ pid = 2756; parent = 5740; executable = "$windowsDirectory\\System32\\other.exe"; created = $child.created }) $child @($driver) $parent $root $windowsDirectory
$unrelated = Test-OwnedConsoleHost ([pscustomobject]@{ pid = 2756; parent = 9999; executable = $child.executable; created = $child.created }) $child @($driver) $parent $root $windowsDirectory
[pscustomobject]@{ accepted = $accepted; reusedPid = $reusedPid; otherParent = $otherParent; otherChild = $otherChild; unrelated = $unrelated } | ConvertTo-Json -Compress
`;
  const result = spawnSync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", timeout: 10_000, windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    accepted: true,
    reusedPid: false,
    otherParent: false,
    otherChild: false,
    unrelated: false,
  });
});

test("complete host gate refuses local/self-hosted/tag/fork/SYSTEM and signing contexts", () => {
  assertWindowsHost(env, event, "win32", "x64");
  for (const change of [
    { CI: "false" },
    { GITHUB_ACTIONS: "false" },
    { RUNNER_ENVIRONMENT: "self-hosted" },
    { RUNNER_OS: "Linux" },
    { GITHUB_REF: "refs/tags/v0.1.8" },
    { RUNNER_TEMP: "relative" },
    { GITHUB_REPOSITORY: "someone/execs" },
    { GITHUB_EVENT_NAME: "pull_request_target" },
    { TAURI_SIGNING_PRIVATE_KEY: "fixture-only" },
    { windows_certificate_password: "fixture-only" },
  ])
    assert.throws(() => assertWindowsHost({ ...env, ...change }, event, "win32", "x64"));
  assert.throws(() => assertWindowsHost(env, {}, "win32", "x64"));
  assert.throws(() =>
    assertWindowsHost(
      env,
      { ...event, pull_request: { head: { repo: { full_name: "fork/execs" } } } },
      "win32",
      "x64",
    ),
  );
  assert.throws(() => assertWindowsHost(env, event, "linux", "x64"));
  assert.throws(() => assertWindowsHost(env, event, "win32", "arm64"));
  const receipt = {
    sid: "S-1-5-21-123",
    packageCode: 15700,
    playerProcesses: [],
    steamRegistry: [],
    productLocations: [],
  };
  assertHostObservation(receipt);
  for (const changed of [
    { sid: "S-1-5-18" },
    { packageCode: 122 },
    { playerProcesses: [{ name: "steam", pid: 44 }] },
    { steamRegistry: ["HKCU\\Software\\Valve\\Steam"] },
    { productLocations: ["existing execs"] },
  ])
    assert.throws(() => assertHostObservation({ ...receipt, ...changed }));
});

test("containment rejects prefix siblings, missing ancestors and junction redirection", () =>
  withFixture((fixture, parent) => {
    assert.equal(containedPath(fixture.scratch, fixture.exportPath, true), fixture.exportPath);
    assert.throws(() => containedPath(fixture.scratch, fixture.scratch));
    assert.throws(() =>
      containedPath(fixture.scratch, join(parent, "fixture-sibling", "test"), true),
    );
    assert.throws(() =>
      containedPath(fixture.scratch, join(fixture.scratch, "missing", "test"), true),
    );
    const link = join(fixture.scratch, "redirect");
    symlinkSync(parent, link, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => containedPath(fixture.scratch, join(link, "fixture")), /Linked/);
  }));

test("public NSIS selection binds real asset name, version, origin, signature and public status", () => {
  const name = "execs_0.1.8_x64-setup.exe";
  const release = {
    tagName: "v0.1.8",
    isDraft: false,
    isPrerelease: false,
    publishedAt: "2026-09-21T02:26:18Z",
    assets: [name, `${name}.sig`].map((name) => ({
      name,
      size: 20,
      url: `https://github.com/rndaom/execs/releases/download/v0.1.8/${name}`,
    })),
  };
  assert.equal(selectPreviousNsis(release, "0.1.8").artifact.name, name);
  for (const changed of [
    { tagName: "v0.1.7" },
    { isDraft: true },
    { isPrerelease: true },
    { publishedAt: "" },
    { assets: release.assets.slice(0, 1) },
    { assets: [...release.assets, release.assets[0]] },
    { assets: release.assets.map((asset) => ({ ...asset, size: 0 })) },
    {
      assets: release.assets.map((asset) => ({
        ...asset,
        url: asset.url.replace("github.com", "example.com"),
      })),
    },
    { assets: release.assets.map((asset) => ({ ...asset, url: `${asset.url}?mutable=yes` })) },
  ])
    assert.throws(() => selectPreviousNsis({ ...release, ...changed }, "0.1.8"));
});

test("Windows fixture isolates child-only paths and keeps all original bytes and inventories exact", () =>
  withFixture((fixture) => {
    const originalAppData = process.env.APPDATA;
    const child = windowsAppEnvironment(fixture, {
      SystemRoot: "C:\\Windows",
      PATH: "private tools",
      APPDATA: "player-data",
      GH_TOKEN: "never-inherit",
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--unowned",
      NODE_OPTIONS: "--unowned",
    });
    assert.equal(child.APPDATA, join(fixture.scratch, "roaming"));
    assert.equal(child.TEMP, join(fixture.scratch, "tmp"));
    assert.equal(child.GH_TOKEN, undefined);
    assert.equal(child.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, undefined);
    assert.equal(child.NODE_OPTIONS, undefined);
    assert.equal(process.env.APPDATA, originalAppData);
    assertWindowsFixturePreserved(fixture);
    const config = join(fixture.tf2Root, "tf", "cfg", "config.cfg");
    const bytes = readFileSync(config);
    writeFileSync(config, "mutated\n");
    assert.throws(() => assertWindowsFixturePreserved(fixture), /live bytes/);
    writeFileSync(config, bytes);
    mkdirSync(join(fixture.library, "unexpected-journal"));
    assert.throws(() => assertWindowsFixturePreserved(fixture), /app-data bytes/);
  }));

test("actual retained v0.1.8 ZIP passes unchanged and all four payloads match independent hashes", () =>
  withFixture((fixture) => {
    const source = publicProfileFixture.sources.find((value) => value.case === "no-hud");
    const before = sha256(readFileSync(retained));
    assert.equal(before, "3299cf62cb18da34785c309803ed2d8abad427eab9b95918ea72b1bf9259ac38");
    assert.equal(before, source.archiveSha256);
    // Adapt only expected identity; never rewrite the authentic archive under test.
    fixture.portableManifest.name = source.manifest.name;
    copyFileSync(retained, fixture.exportPath);
    const proof = inspectWindowsExport(fixture, python);
    assert.equal(proof.sha256, before);
    assert.equal(proof.members.length, 5);
    assert.equal(proof.manifest.files.length, 4);
    assertWindowsFixturePreserved(fixture, proof);
    assert.equal(sha256(readFileSync(retained)), before);
    writeFileSync(
      fixture.exportPath,
      Buffer.concat([readFileSync(fixture.exportPath), Buffer.from("changed")]),
    );
    assert.throws(() => assertWindowsFixturePreserved(fixture, proof), /export bytes/);
  }));

function alteredArchive(fixture, change) {
  fixture.portableManifest.name = publicProfileFixture.sources.find(
    (value) => value.case === "no-hud",
  ).manifest.name;
  const result = spawnSync(
    python,
    [
      "-I",
      "-c",
      `
import json, stat, sys, zipfile
change = sys.argv[3]
with zipfile.ZipFile(sys.argv[1]) as original, zipfile.ZipFile(sys.argv[2], 'w') as output:
    for item in original.infolist():
        data = original.read(item)
        if change == 'payload' and item.filename.startswith('files/'):
            data += b'changed'
        if change == 'metadata' and item.filename == 'execs-profile.json':
            manifest = json.loads(data)
            manifest['name'] = 'Unexpected identity'
            data = json.dumps(manifest).encode()
        output.writestr(item, data)
    if change in ('traversal', 'unknown', 'duplicate', 'symlink', 'limit'):
        name = {'traversal': '../escape.cfg', 'unknown': 'unexpected.cfg', 'duplicate': 'execs-profile.json', 'symlink': 'linked.cfg', 'limit': 'huge.cfg'}[change]
        info = zipfile.ZipInfo(name)
        if change == 'symlink':
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
        output.writestr(info, b'x' * (1024 * 1024 + 1) if change == 'limit' else b'x')
`,
      retained,
      fixture.exportPath,
      change,
    ],
    { encoding: "utf8", timeout: 10000, windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
}

for (const change of [
  "payload",
  "metadata",
  "traversal",
  "unknown",
  "duplicate",
  "symlink",
  "limit",
])
  test(`independent archive inspection refuses ${change}`, () =>
    withFixture((fixture) => {
      alteredArchive(fixture, change);
      assert.throws(() => inspectWindowsExport(fixture, python));
    }));

test("native page/listener checks reject preview and unowned or exposed debugging endpoints", () => {
  const state = {
    native: true,
    href: "http://tauri.localhost/",
    profile: "Saved",
    profiles: ["Saved", "Second"],
    width: 1200,
    height: 800,
  };
  assertNativePage(state, "Saved");
  for (const changed of [
    { native: false },
    { href: "http://localhost:1420/" },
    { href: "http://tauri.localhost/?preview=ready" },
    { profile: "Wrong" },
    { profiles: [] },
  ])
    assert.throws(() => assertNativePage({ ...state, ...changed }, "Saved"));
  const observation = {
    processes: [
      {
        pid: 22,
        executable: "C:\\runtime\\msedgewebview2.exe",
        commandLine:
          '--user-data-dir="D:\\fixture\\webview\\EBWebView" --remote-debugging-port=9999',
      },
    ],
    listeners: [{ address: "127.0.0.1", port: 9999, pid: 22 }],
  };
  assertDebugListener(observation, 9999, "D:\\fixture\\webview");
  assert.throws(() =>
    assertDebugListener(
      { ...observation, listeners: [{ address: "0.0.0.0", port: 9999, pid: 22 }] },
      9999,
      "D:\\fixture\\webview",
    ),
  );
  assert.throws(() => assertDebugListener(observation, 9999, "D:\\different\\webview"));
  assert.throws(() => assertDebugListener(observation, 9999, "D:\\fixture\\web"));
  assert.throws(() =>
    assertDebugListener(
      {
        ...observation,
        processes: [
          {
            ...observation.processes[0],
            commandLine:
              '--user-data-dir="D:\\fixture\\webview-elsewhere" --remote-debugging-port=9999',
          },
        ],
      },
      9999,
      "D:\\fixture\\webview",
    ),
  );
  assert.throws(() =>
    assertDebugListener({ ...observation, processes: [] }, 9999, "D:\\fixture\\webview"),
  );
});

test("EdgeDriver uses its local-only default and rejects wildcard or unowned listeners", () => {
  assert.deepEqual(edgeDriverArguments(60189), ["--port=60189"]);
  assert.throws(() => edgeDriverArguments(0));
  const observation = {
    process: { pid: 5740 },
    listeners: [{ port: 60189, address: "127.0.0.1", pid: 5740 }],
  };
  assert.equal(assertDriverListener(observation, 60189).length, 1);
  assert.equal(
    assertDriverListener(
      { ...observation, listeners: [{ port: 60189, address: "::1", pid: 5740 }] },
      60189,
    ).length,
    1,
  );
  for (const listeners of [
    [],
    [{ port: 60189, address: "::", pid: 5740 }],
    [{ port: 60189, address: "0.0.0.0", pid: 5740 }],
    [{ port: 60189, address: "127.0.0.1", pid: 9999 }],
  ])
    assert.throws(() => assertDriverListener({ ...observation, listeners }, 60189));
});

test("WebView2 attachment uses an owned loopback endpoint without launching or navigating an app", async () => {
  const calls = [];
  const driver = {
    request: async (...args) => {
      calls.push(args);
      return { sessionId: "native-session", capabilities: { browserName: "webview2" } };
    },
    command: async (...args) => calls.push(args),
  };
  await attachWebView(driver, 9999);
  assert.equal(driver.sessionId, "native-session");
  assert.deepEqual(calls[0][2].capabilities.alwaysMatch, {
    browserName: "webview2",
    "ms:edgeOptions": { debuggerAddress: "127.0.0.1:9999" },
  });
  assert.deepEqual(
    calls.map((value) => value[1]),
    ["/session", "timeouts"],
  );
  await assert.rejects(() => attachWebView(driver, 0));
});

test("normal close requires observed zero exit before cleanup and cannot be inferred from force-kill", () => {
  const receipt = {
    request: "owned-native-window-close",
    code: 0,
    signal: null,
    observedBeforeCleanup: true,
    forced: false,
    exitedAt: new Date().toISOString(),
  };
  assertNormalExit(receipt);
  for (const changed of [
    { code: null },
    { code: 1 },
    { signal: "SIGTERM" },
    { observedBeforeCleanup: false },
    { forced: true },
    { request: "driver-session-delete" },
  ])
    assert.throws(() => assertNormalExit({ ...receipt, ...changed }));
});

test("all cleanup stages run and preserve primary plus restoration failures", async () => {
  const stages = [];
  const original = new Error("Save unavailable");
  const restoration = new Error("Policy restore failed");
  await assert.rejects(
    () =>
      finalizeProbe(original, [
        async () => {
          stages.push("processes");
          throw new Error("process cleanup failed");
        },
        async () => {
          stages.push("policy");
          throw restoration;
        },
        async () => {
          stages.push("preservation");
        },
      ]),
    (error) =>
      error instanceof AggregateError &&
      error.cause === original &&
      error.errors.includes(restoration),
  );
  assert.deepEqual(stages, ["processes", "policy", "preservation"]);
  await assert.rejects(
    () =>
      finalizeProbe(null, [
        async () => {
          throw restoration;
        },
      ]),
    (error) => error === restoration,
  );
});

test("failed initial and final evidence writes cannot skip process cleanup or policy restoration", async () => {
  const calls = [];
  let writes = 0;
  const original = new Error("Native Save control unavailable");
  const firstWrite = new Error("Evidence disk full");
  const lastWrite = new Error("Final evidence still unavailable");
  await assert.rejects(
    () =>
      finishWindowsProbe(original, async () => {
        calls.push(`write-${++writes}`);
        throw writes === 1 ? firstWrite : lastWrite;
      }, [
        async () => {
          calls.push("stop-owned-processes");
        },
        async () => {
          calls.push("restore-policy");
        },
      ]),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors[1], lastWrite);
      assert.equal(error.cause.cause, original);
      assert.ok(error.cause.errors.includes(firstWrite));
      return true;
    },
  );
  assert.deepEqual(calls, ["write-1", "stop-owned-processes", "restore-policy", "write-2"]);
});

test("native cleanup dispatch acts and retains stopped identities when receipt persistence fails", () => {
  const calls = [];
  const diskError = new Error("Evidence disk full");
  const receipt = { forcedCleanup: [{ pid: 42 }], alreadyExited: [43] };
  const result = actionBeforeEvidence(
    () => {
      calls.push("native-cleanup");
      return receipt;
    },
    () => {
      calls.push("receipt-write");
      throw diskError;
    },
  );
  assert.deepEqual(calls, ["native-cleanup", "receipt-write"]);
  assert.equal(result.value, receipt);
  assert.equal(result.evidenceError, diskError);
});

test("cleanup awaits delayed tracked child exit notifications before any reinspection", async () => {
  const entries = [42, 43].map((pid) => ({ child: { pid }, exit: null }));
  let observed = false;
  const waiting = observeCleanupExits(entries, {
    forcedCleanup: [{ pid: 42 }],
    alreadyExited: [43],
  }).then(() => {
    observed = true;
  });
  assert.equal(observed, false);
  await new Promise((done) => setImmediate(done));
  entries[0].exit = { code: 1, signal: null };
  assert.equal(observed, false);
  entries[1].exit = { code: 0, signal: null };
  await waiting;
  assert.equal(observed, true);
  // This cleanup observation intentionally does not create a normalClose receipt.
  assert.throws(() => assertNormalExit(entries[1].exit));
});

test("asynchronous log failures are handled and still fail finalization after restoring policy", async () => {
  const errors = [];
  const diskError = new Error("Async log write failed");
  const stream = recordLogErrors(
    new Writable({
      write(_chunk, _encoding, done) {
        queueMicrotask(() => done(diskError));
      },
    }),
    errors,
  );
  stream.end("driver output");
  await assert.rejects(
    () => finished(stream),
    (error) => error === diskError,
  );
  assert.deepEqual(errors, [diskError]);
  let restored = false;
  await assert.rejects(() =>
    finishWindowsProbe(null, () => {}, [
      () => {
        restored = true;
      },
      () => {
        if (errors.length) throw new AggregateError(errors, "Native logs failed");
      },
    ]),
  );
  assert.equal(restored, true);
});

test("driver downloads stop at a size cap rather than accumulating unlimited bytes", async () => {
  assert.equal((await readBoundedResponse(new Response("driver"), 6)).toString(), "driver");
  await assert.rejects(() => readBoundedResponse(new Response("oversized"), 3), /limit/);
  await assert.rejects(() => readBoundedResponse(new Response(""), 3));
});
