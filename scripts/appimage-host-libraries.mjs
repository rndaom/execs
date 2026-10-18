import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), "..");
// The AppImage output plugin built into linuxdeploy. Upstream's standalone
// plugin is only published as `continuous` and rebuilt every month, so use the
// fixed linuxdeploy copy Tauri pins: the x86_64 artifact of linuxdeploy run
// 30674699502 (commit 07333c6), uploaded to tauri-apps/binary-releases.
const linuxdeployUrl =
  "https://github.com/tauri-apps/binary-releases/releases/download/linuxdeploy-07333c6/linuxdeploy-x86_64.AppImage";
const linuxdeploySha256 = "36a2d7e274d12e1050d0e9ecfe11d339ed54720b2bec464c286d53f8b07f5c62";
// The plugin finds appimagetool next to its own executable, so run it in place.
const bundledPlugin = "plugins/linuxdeploy-plugin-appimage/usr/bin/linuxdeploy-plugin-appimage";

// These belong with the host EGL drivers. The older bundled Wayland lacks
// wl_fixes_interface / wl_display_create_queue_with_name used by newer drivers.
const hostLibrary = /^libwayland-(client|server|cursor|egl)\.so(?:\.\d+)*$/;

export function removeBundledWayland(appDir) {
  assert(existsSync(join(appDir, "AppRun")), "Expected an AppDir with AppRun");
  assert(existsSync(join(appDir, "usr/bin/execs")), "Expected the execs AppDir");
  assert(!lstatSync(join(appDir, "usr")).isSymbolicLink(), "usr must be a directory");
  const removed = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (hostLibrary.test(entry.name)) {
        // Unlink library symlinks without following them into the host.
        unlinkSync(path);
        removed.push(path);
      }
    }
  }
  for (const name of ["lib", "lib64"]) {
    const directory = join(appDir, "usr", name);
    if (existsSync(directory) && !lstatSync(directory).isSymbolicLink()) visit(directory);
  }
  return removed;
}

async function prepare() {
  if (process.platform !== "linux") return;
  assert.equal(process.arch, "x64", "The release output plugin is pinned for Linux x64");
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      [
        "metadata",
        "--no-deps",
        "--format-version=1",
        "--manifest-path",
        join(root, "apps/desktop/src-tauri/Cargo.toml"),
      ],
      { encoding: "utf8" },
    ),
  );
  // bundle.useLocalToolsDir makes Tauri use this project-scoped tool directory.
  const tools = join(metadata.target_directory, ".tauri");
  mkdirSync(tools, { recursive: true });
  const image = join(tools, "execs-linuxdeploy.AppImage");
  let bytes;
  if (existsSync(image)) bytes = readFileSync(image);
  else {
    const response = await fetch(linuxdeployUrl, { signal: AbortSignal.timeout(120000) });
    assert(response.ok, `linuxdeploy download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    linuxdeploySha256,
    "linuxdeploy checksum mismatch",
  );
  writeFileSync(`${image}.part`, bytes, { mode: 0o755 });
  renameSync(`${image}.part`, image);
  chmodSync(image, 0o755);
  // Unpack beside the image; a marker names the verified hash it came from.
  const extracted = join(tools, "execs-linuxdeploy");
  const marker = join(extracted, ".execs-sha256");
  if (!existsSync(marker) || readFileSync(marker, "utf8") !== linuxdeploySha256) {
    const staging = join(tools, "execs-linuxdeploy.part");
    rmSync(staging, { recursive: true, force: true });
    rmSync(extracted, { recursive: true, force: true });
    mkdirSync(staging);
    execFileSync(image, ["--appimage-extract"], { cwd: staging, stdio: "ignore" });
    renameSync(join(staging, "squashfs-root"), extracted);
    rmSync(staging, { recursive: true });
    writeFileSync(marker, linuxdeploySha256);
  }
  const upstream = join(extracted, bundledPlugin);
  assert(existsSync(upstream), "linuxdeploy has no built-in AppImage output plugin");
  // Run after GTK/GStreamer deployment, before SquashFS creation and Tauri signing.
  const wrapper = join(tools, "linuxdeploy-plugin-appimage.AppImage");
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  writeFileSync(
    wrapper,
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} --output ${quote(upstream)} "$@"\n`,
    { mode: 0o755 },
  );
  chmodSync(wrapper, 0o755);
}

async function main(args) {
  if (args[0] === "--prepare") return prepare();
  assert.equal(args[0], "--output", "Expected --prepare or --output");
  const [, upstream, ...pluginArgs] = args;
  if (!pluginArgs.includes("--plugin-type") && !pluginArgs.includes("--plugin-api-version")) {
    const index = pluginArgs.indexOf("--appdir");
    const appDir =
      index >= 0
        ? pluginArgs[index + 1]
        : pluginArgs.find((arg) => arg.startsWith("--appdir="))?.slice(9);
    assert(appDir, "Missing --appdir");
    for (const path of removeBundledWayland(resolve(appDir)))
      console.log(`Use host Wayland: ${path}`);
  }
  const result = spawnSync(upstream, pluginArgs, {
    stdio: "inherit",
    env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: "1" },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === script) await main(process.argv.slice(2));
