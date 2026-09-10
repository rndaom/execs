import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { removeBundledWayland } from "./appimage-host-libraries.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "execs-appimage-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const appDir = join(root, "execs.AppDir");
  const put = (name, content = "fixture") => {
    const path = join(appDir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    return path;
  };
  put("AppRun");
  put("usr/bin/execs");
  return { root, appDir, put };
}

test("removes only Wayland libraries, including versioned copies in multiarch directories", (t) => {
  const { appDir, put } = fixture(t);
  const removed = [
    put("usr/lib/libwayland-client.so.0"),
    put("usr/lib/libwayland-client.so.0.20.0"),
    put("usr/lib/x86_64-linux-gnu/libwayland-server.so.0"),
    put("usr/lib64/libwayland-cursor.so.0"),
    put("usr/lib/libwayland-egl.so.1"),
  ];
  const kept = [
    put("usr/lib/libwebkit2gtk-4.1.so.0"),
    put("usr/lib/gstreamer-1.0/libgstwaylandsink.so"),
    put("usr/lib/libwayland-client.so.0.txt"),
  ];
  assert.deepEqual(removeBundledWayland(appDir).sort(), removed.sort());
  for (const path of removed) assert(!existsSync(path));
  for (const path of kept) assert(existsSync(path));
  assert.deepEqual(removeBundledWayland(appDir), []);
});

test("rejects unrelated directories before removing anything", (t) => {
  const { root } = fixture(t);
  assert.throws(() => removeBundledWayland(root), /Expected an AppDir/);
});

test("does not follow symlinks outside the bundle", { skip: process.platform === "win32" }, (t) => {
  const { root, appDir, put } = fixture(t);
  const host = join(root, "host");
  mkdirSync(host);
  const library = join(host, "libwayland-client.so.0");
  writeFileSync(library, "host library");
  put("usr/lib/keep.txt");
  symlinkSync(host, join(appDir, "usr/lib/host"));
  symlinkSync(library, join(appDir, "usr/lib/libwayland-client.so.0"));
  assert.equal(removeBundledWayland(appDir).length, 1);
  assert.equal(readFileSync(library, "utf8"), "host library");
});

test("output plugin prunes before packing, forwards arguments and propagates failure", {
  skip: process.platform === "win32",
}, (t) => {
  const { root, appDir, put } = fixture(t);
  const library = put("usr/lib/libwayland-client.so.0");
  const plugin = join(root, "output");
  writeFileSync(
    plugin,
    '#!/bin/sh\n[ "$APPIMAGE_EXTRACT_AND_RUN" = 1 ] || exit 9\n[ "$1" = --appdir ] || exit 10\n[ ! -e "$2/usr/lib/libwayland-client.so.0" ] || exit 11\nexit 7\n',
    { mode: 0o755 },
  );
  const script = fileURLToPath(new URL("./appimage-host-libraries.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script, "--output", plugin, "--appdir", appDir]);
  assert.equal(result.status, 7, result.stderr.toString());
  assert(!existsSync(library));
});

test("output plugin discovery does not require or mutate an AppDir", {
  skip: process.platform === "win32",
}, (t) => {
  const { root } = fixture(t);
  const plugin = join(root, "output");
  writeFileSync(plugin, '#!/bin/sh\nprintf "%s\\n" "$1"\n', { mode: 0o755 });
  const script = fileURLToPath(new URL("./appimage-host-libraries.mjs", import.meta.url));
  for (const flag of ["--plugin-type", "--plugin-api-version"]) {
    const result = spawnSync(process.execPath, [script, "--output", plugin, flag]);
    assert.equal(result.status, 0, result.stderr.toString());
    assert.equal(result.stdout.toString().trim(), flag);
  }
});
