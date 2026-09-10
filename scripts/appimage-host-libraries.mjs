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
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), "..");
// Same output plugin as Tauri, pinned so a moved continuous asset fails closed.
const pluginUrl =
  "https://github.com/linuxdeploy/linuxdeploy-plugin-appimage/releases/download/continuous/linuxdeploy-plugin-appimage-x86_64.AppImage";
const pluginSha256 = "0441769ab38009504d2678c38cd7e526955388dd30a215b4a20afaa5471652f2";

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
  const upstream = join(tools, "execs-appimage-output.AppImage");
  let bytes;
  if (existsSync(upstream)) bytes = readFileSync(upstream);
  else {
    const response = await fetch(pluginUrl, { signal: AbortSignal.timeout(120000) });
    assert(response.ok, `AppImage output plugin download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    pluginSha256,
    "AppImage output plugin checksum mismatch",
  );
  writeFileSync(`${upstream}.part`, bytes, { mode: 0o755 });
  renameSync(`${upstream}.part`, upstream);
  chmodSync(upstream, 0o755);
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
