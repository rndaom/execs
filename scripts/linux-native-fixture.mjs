import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { assertPackageFixturePreserved, publicProfileFixture } from "./package-smoke-fixture.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function regularTreeHashes(root) {
  const hashes = {};
  function visit(path) {
    const stat = lstatSync(path);
    assert.ok(!stat.isSymbolicLink(), `Fixture contains a link: ${path}`);
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(join(path, name));
    } else {
      assert.ok(stat.isFile(), `Fixture contains a non-file: ${path}`);
      hashes[relative(root, path).split(sep).join("/")] = sha256(readFileSync(path));
    }
  }
  visit(root);
  return hashes;
}

function put(root, path, bytes) {
  assert.ok(!isAbsolute(path) && !path.includes("\\"));
  assert.ok(
    path.split("/").every((part) => part && ![".", ".."].includes(part) && !part.includes(":")),
  );
  const destination = join(root, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes, { flag: "wx" });
}

const putJson = (root, path, value) => put(root, path, `${JSON.stringify(value, null, 2)}\n`);

/** Author only disposable metadata; reuse the owned fixture's hash-checked payloads. */
export function seedLinuxNativeFixture(parent) {
  assert.ok(parent && isAbsolute(parent), "Native smoke parent must be absolute");
  assert.equal(realpathSync(parent), resolve(parent), "Native smoke parent must not be a link");
  const scratch = mkdtempSync(join(parent, "execs-linux-native-"));
  const childEnv = {
    HOME: join(scratch, "home"),
    XDG_DATA_HOME: join(scratch, "data"),
    XDG_CONFIG_HOME: join(scratch, "config"),
    XDG_CACHE_HOME: join(scratch, "cache"),
    XDG_RUNTIME_DIR: join(scratch, "runtime"),
    TMPDIR: join(scratch, "tmp"),
  };
  for (const path of Object.values(childEnv)) mkdirSync(path, { mode: 0o700 });
  const data = join(childEnv.XDG_DATA_HOME, "execs");
  const library = join(data, "profiles");
  const tf2Root = join(scratch, "fixture-tf2");
  mkdirSync(library, { recursive: true });
  mkdirSync(tf2Root);
  put(tf2Root, "tf/steam.inf", "ProductName=tf\nappID=440\n");
  put(tf2Root, "tf/cfg/config_default.cfg", "// owned native smoke fixture\nsensitivity 3\n");
  const settings = {
    schema: 1,
    tf2Root,
    preferences: { checkForUpdatesOnStartup: false, motion: "system" },
  };
  putJson(data, "settings.json", settings);
  const source = publicProfileFixture.sources.find((entry) => entry.case === "no-hud");
  assert.ok(source, "Owned no-HUD payload fixture is missing");
  const metadata = {};
  const profiles = [];
  const names = ["Main", "Casual", "Competitive", "Practice", "Experiments", "Archived setup"];
  for (const [index, name] of names.entries()) {
    const id = `f2000001-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    const manifest = { ...structuredClone(source.manifest), id, name, tf2Root };
    metadata[`${id}/manifest.json`] = manifest;
    putJson(library, `${id}/manifest.json`, manifest);
    for (const file of manifest.files) {
      assert.match(file.sha256, /^[0-9a-f]{64}$/);
      assert.ok(["exclusive", "shared"].includes(file.storage));
      const bytes = Buffer.from(publicProfileFixture.payloads[file.sha256], "base64");
      assert.equal(sha256(bytes), file.sha256, `Owned payload changed: ${file.path}`);
      const path =
        file.storage === "shared"
          ? `blobs/sha256/${file.sha256.slice(0, 2)}/${file.sha256}`
          : `${id}/files/${file.path}`;
      if (!existsSync(join(library, path))) put(library, path, bytes);
      if (index === 0) put(tf2Root, file.path, bytes);
    }
    profiles.push({
      id,
      name,
      createdAt: "2026-09-20T00:00:00Z",
      updatedAt: "2026-09-20T00:00:00Z",
    });
  }
  metadata["index.json"] = { schema: 1, tf2Root, activeProfileId: null, profiles };
  putJson(library, "index.json", metadata["index.json"]);
  return {
    scratch,
    childEnv,
    data,
    library,
    tf2Root,
    settings,
    metadata,
    libraryHashes: regularTreeHashes(library),
    liveHashes: regularTreeHashes(tf2Root),
    provenance: {
      exporterTag: publicProfileFixture.exporterTag,
      exporterRevision: publicProfileFixture.exporterRevision,
      sourceArchiveSha256: source.archiveSha256,
      authored:
        "Six inactive identities, index/settings and synthetic TF2 root; owned no-HUD payload bytes reused unchanged. This is runtime evidence, not an upgrade test.",
    },
  };
}

export function assertLinuxNativeFixture(fixture, motion, stage) {
  assert.ok(["system", "reduce"].includes(motion));
  const expected = {
    ...fixture,
    settings: { ...fixture.settings, preferences: { checkForUpdatesOnStartup: false, motion } },
  };
  const result = assertPackageFixturePreserved(expected, stage);
  return {
    stage,
    motion,
    profiles: 6,
    activeProfileId: null,
    libraryAndLivePayloadsPreserved: true,
    allowedAdditiveMetadataObserved: result.allowedAdditiveMetadataObserved,
  };
}

/** Do not pass runner credentials, host app settings, proxies or sandbox overrides to the app. */
export function linuxNativeEnvironment(fixture, env) {
  const inherited = {};
  for (const key of ["PATH", "DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "LANG", "TZ"]) {
    if (env[key]) inherited[key] = env[key];
  }
  return { ...inherited, ...fixture.childEnv, GDK_BACKEND: "x11", LIBGL_ALWAYS_SOFTWARE: "1" };
}
