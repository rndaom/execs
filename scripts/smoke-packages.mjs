import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { basename, join, resolve } from "node:path";

assert.equal(process.env.CI, "true", "Installer smoke runs only on disposable CI workers");
const windows = process.platform === "win32";
const version = JSON.parse(readFileSync("apps/desktop/package.json", "utf8")).version;
const scratch = join(process.env.RUNNER_TEMP, "execs-package-smoke");
mkdirSync(scratch, { recursive: true });
const bundle = resolve(
  "apps/desktop/src-tauri/target/release/bundle",
  windows ? "nsis" : "appimage",
);
const asset = readdirSync(bundle).find((name) => name.endsWith(windows ? ".exe" : ".AppImage"));
assert.ok(asset, "Candidate installer missing");
const bytes = readFileSync(join(bundle, asset));
const signature = readFileSync(join(bundle, `${asset}.sig`), "utf8").trim();
const marker = join(scratch, "updater-verified.txt");
const oldName = windows ? "execs_0.1.1_x64-setup.exe" : "execs_0.1.1_amd64.AppImage";
execFileSync(
  "gh",
  [
    "release",
    "download",
    "v0.1.1",
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
const childEnv = {
  ...process.env,
  APPDATA: join(scratch, "roaming"),
  LOCALAPPDATA: join(scratch, "local"),
  XDG_DATA_HOME: join(scratch, "data"),
  XDG_CONFIG_HOME: join(scratch, "config"),
};
for (const path of [
  childEnv.APPDATA,
  childEnv.LOCALAPPDATA,
  childEnv.XDG_DATA_HOME,
  childEnv.XDG_CONFIG_HOME,
])
  mkdirSync(path, { recursive: true });
const data = windows ? join(childEnv.APPDATA, "execs") : join(childEnv.XDG_DATA_HOME, "execs");
mkdirSync(data, { recursive: true });
const sentinel = join(data, "release-smoke-sentinel.txt");
writeFileSync(sentinel, "user data must survive updates\n");
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
    child.on("error", reject);
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
  ]);
  assert.match(readFileSync(marker, "utf8"), /signature-verified/);
  if (windows) {
    // NSIS is asynchronous when invoked by the updater, which exits for replacement.
    let installedVersion = "";
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
  assert.equal(readFileSync(sentinel, "utf8"), "user data must survive updates\n");
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
  for (const command of windows ? [executable] : [executable, "/usr/bin/execs"]) {
    const application = spawn(command, [], { env: childEnv, stdio: "inherit", windowsHide: true });
    let launchError;
    application.on("error", (error) => {
      launchError = error;
    });
    try {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10000));
      assert.ifError(launchError);
      assert.equal(application.exitCode, null, `Packaged app exited during startup: ${command}`);
      if (!windows) {
        assert.ok(
          execFileSync("xdotool", ["search", "--name", "^execs$"], { encoding: "utf8" }).trim(),
          "Packaged app did not create a window",
        );
      }
    } finally {
      application.kill();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
    }
  }
  writeFileSync(
    join(scratch, "result.json"),
    `${JSON.stringify({ version, platform: process.platform, oldVersion: "0.1.1", artifact: basename(asset), signatureVerified: true, updateInstalled: true, userDataPreserved: true, packagedNotices: true, packagedStartup: true }, null, 2)}\n`,
  );
  console.log(
    "PASS: signed updater, installer upgrade, packaged startup, notices and data preservation",
  );
} finally {
  server.close();
}
