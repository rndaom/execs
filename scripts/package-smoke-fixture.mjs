import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";

export const publicProfileFixture = JSON.parse(
  readFileSync(new URL("./fixtures/package-smoke-v018.json", import.meta.url), "utf8"),
);

const profileIds = ["f20a0001-8d01-4000-8000-000000000001", "f20a0001-8d01-4000-8000-000000000002"];
const timestamp = "2026-09-20T00:00:00Z";
const emptyPreloader = { addons: [], particleMods: [], profileParticleMods: [] };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// No recursive cleanup: each run must own a fresh, direct child of RUNNER_TEMP.
export function createSmokeScratch(runnerTemp) {
  assert.ok(runnerTemp && isAbsolute(runnerTemp), "RUNNER_TEMP must be absolute");
  const parent = realpathSync(runnerTemp);
  const scratch = join(parent, "execs-package-smoke");
  mkdirSync(scratch);
  return scratch;
}

function childPath(root, path) {
  assert.ok(path && !isAbsolute(path) && !path.includes("\\"), `Unsafe fixture path: ${path}`);
  assert.ok(
    path.split("/").every((part) => part && part !== "." && part !== ".." && !part.includes(":")),
    `Unsafe fixture path: ${path}`,
  );
  const result = resolve(root, path);
  assert.ok(relative(root, result) && !relative(root, result).startsWith(`..${sep}`));
  return result;
}

function put(root, path, bytes) {
  const destination = childPath(root, path);
  mkdirSync(dirname(destination), { recursive: true });
  // The containing root is new and every path comes from the pinned fixture.
  writeFileSync(destination, bytes, { flag: "wx" });
}

function putJson(root, path, value) {
  put(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

function regularTree(root) {
  const hashes = {};
  function visit(directory) {
    const stat = lstatSync(directory);
    assert.ok(
      !stat.isSymbolicLink() && stat.isDirectory(),
      `Unsafe fixture directory: ${directory}`,
    );
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry);
      const child = lstatSync(path);
      assert.ok(!child.isSymbolicLink(), `Fixture contains a link: ${path}`);
      if (child.isDirectory()) visit(path);
      else {
        assert.ok(child.isFile(), `Fixture contains a non-regular file: ${path}`);
        hashes[relative(root, path).split(sep).join("/")] = sha256(readFileSync(path));
      }
    }
  }
  visit(root);
  return hashes;
}

// Mirrors finder.rs candidates. APPDATA/XDG isolation alone does not isolate
// Steam discovery or Cloud: a hosted worker must have no discoverable Steam.
export function linuxSteamCandidates(env) {
  return [
    ...(env.XDG_DATA_HOME
      ? [join(env.XDG_DATA_HOME, "Steam"), join(env.XDG_DATA_HOME, "steam")]
      : []),
    ...(env.HOME
      ? [
          ".local/share/Steam",
          ".local/share/steam",
          ".steam/steam",
          ".steam/root",
          ".var/app/com.valvesoftware.Steam/data/Steam",
          "snap/steam/common/.local/share/Steam",
        ].map((path) => join(env.HOME, path))
      : []),
  ];
}

export function assertNoSteamDirectories(candidates) {
  for (const path of candidates) {
    assert.ok(
      isAbsolute(path),
      "Steam discovery returned a relative path; worker isolation unknown",
    );
    assert.ok(
      !existsSync(path),
      `Refusing package smoke with a discoverable Steam directory: ${path}`,
    );
  }
}

export function seedPackageFixture(scratch, windows, previousVersion) {
  assert.equal(
    publicProfileFixture.exporterTag,
    `v${previousVersion}`,
    "Refresh the tagged-export fixture for the immediately previous public release",
  );
  assert.equal(publicProfileFixture.schema, 1);
  assert.equal(publicProfileFixture.sources.length, 2);
  assert.equal(realpathSync(scratch), resolve(scratch), "Fixture scratch must not be a link");
  const childEnv = {
    APPDATA: join(scratch, "roaming"),
    LOCALAPPDATA: join(scratch, "local"),
    XDG_DATA_HOME: join(scratch, "data"),
    XDG_CONFIG_HOME: join(scratch, "config"),
  };
  for (const path of Object.values(childEnv)) mkdirSync(path);
  const data = join(windows ? childEnv.APPDATA : childEnv.XDG_DATA_HOME, "execs");
  const library = join(data, "profiles");
  const tf2Root = join(scratch, "fixture-tf2");
  mkdirSync(library, { recursive: true });
  mkdirSync(tf2Root);
  const metadata = {};
  const settings = { schema: 1, tf2Root };
  putJson(data, "settings.json", settings);
  put(tf2Root, "tf/steam.inf", "ProductName=tf\nappID=440\n");
  put(tf2Root, "tf/cfg/config_default.cfg", "// synthetic package smoke install\nsensitivity 3\n");
  const summaries = [];
  for (const [index, source] of publicProfileFixture.sources.entries()) {
    const id = profileIds[index];
    const name = index === 0 ? "Package smoke - active" : "Package smoke - saved HUD";
    const manifest = { ...structuredClone(source.manifest), id, name, tf2Root };
    metadata[`${id}/manifest.json`] = manifest;
    putJson(library, `${id}/manifest.json`, manifest);
    for (const file of manifest.files) {
      assert.match(file.sha256, /^[0-9a-f]{64}$/);
      assert.ok(["exclusive", "shared"].includes(file.storage));
      const bytes = Buffer.from(publicProfileFixture.payloads[file.sha256], "base64");
      assert.equal(sha256(bytes), file.sha256, `Tagged payload changed: ${file.path}`);
      const path =
        file.storage === "shared"
          ? `blobs/sha256/${file.sha256.slice(0, 2)}/${file.sha256}`
          : `${id}/files/${file.path}`;
      const destination = childPath(library, path);
      if (!existsSync(destination)) put(library, path, bytes);
      else assert.equal(sha256(readFileSync(destination)), file.sha256);
      if (index === 0) put(tf2Root, file.path, bytes);
    }
    summaries.push({ id, name, createdAt: timestamp, updatedAt: timestamp });
  }
  metadata["index.json"] = {
    schema: 1,
    tf2Root,
    activeProfileId: profileIds[0],
    profiles: summaries,
  };
  putJson(library, "index.json", metadata["index.json"]);
  const fixture = {
    childEnv,
    data,
    library,
    tf2Root,
    metadata,
    settings,
    libraryHashes: regularTree(library),
    liveHashes: regularTree(tf2Root),
    provenance: {
      exporterTag: publicProfileFixture.exporterTag,
      exporterRevision: publicProfileFixture.exporterRevision,
      archives: publicProfileFixture.sources.map(({ case: name, archiveSha256 }) => ({
        name,
        archiveSha256,
      })),
      authored:
        "Schema-1 library index, profile IDs/names, settings and disposable TF2 root; source export manifests and payload bytes are unchanged except the named library identity fields.",
    },
  };
  return fixture;
}

function compareMetadata(actual, expected, additions, label, observed) {
  assert.ok(
    actual && typeof actual === "object" && !Array.isArray(actual),
    `${label} is not an object`,
  );
  const normalized = structuredClone(actual);
  for (const [key, allowed] of Object.entries(additions)) {
    if (!Object.hasOwn(expected, key) && Object.hasOwn(normalized, key)) {
      assert.ok(
        allowed.some((value) => isDeepStrictEqual(value, normalized[key])),
        `${label}: unexpected ${key} migration`,
      );
      observed.push(`${label}:${key}`);
      delete normalized[key];
    }
  }
  assert.deepEqual(normalized, expected, `${label}: persisted user data changed`);
}

export function assertPackageFixturePreserved(fixture, stage) {
  const observed = [];
  for (const path of [fixture.data, fixture.library, fixture.tf2Root]) {
    assert.equal(realpathSync(path), resolve(path), `${stage}: fixture root was redirected`);
  }
  const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
  const libraryHashes = regularTree(fixture.library);
  assert.deepEqual(
    Object.keys(libraryHashes).sort(),
    Object.keys(fixture.libraryHashes).sort(),
    `${stage}: library files were added or removed`,
  );
  for (const [path, hash] of Object.entries(fixture.libraryHashes)) {
    if (!Object.hasOwn(fixture.metadata, path)) {
      assert.equal(libraryHashes[path], hash, `${stage}: payload changed: ${path}`);
      continue;
    }
    const actual = readJson(childPath(fixture.library, path));
    const expected = fixture.metadata[path];
    if (path === "index.json") {
      assert.equal(actual.profiles?.length, expected.profiles.length, `${stage}: profiles lost`);
      for (const [index, profile] of actual.profiles.entries()) {
        compareMetadata(
          profile,
          expected.profiles[index],
          { unsafeCustomFolders: [[]] },
          `${stage}:${profile.id}`,
          observed,
        );
      }
      compareMetadata(
        { ...actual, profiles: expected.profiles },
        expected,
        { interruptedProfileId: [null], pendingSwitch: [null] },
        `${stage}:index`,
        observed,
      );
    } else {
      compareMetadata(
        actual,
        expected,
        {
          launchSyncPending: [true],
          hud: [null],
          crosshair: [null],
          viewmodel: [null],
          hitsound: [null],
          preloader: [null, emptyPreloader],
          ignoredPacks: [[]],
          cloudSyncPending: [false],
          hudRoots: [null, expected.hud ? [expected.hud.id] : []],
          hudSelectedRoot: [null, ...(expected.hud ? [expected.hud.id] : [])],
          hudReviewPending: [false],
        },
        `${stage}:${path}`,
        observed,
      );
    }
  }
  const settingsPath = join(fixture.data, "settings.json");
  assert.ok(lstatSync(settingsPath).isFile() && !lstatSync(settingsPath).isSymbolicLink());
  compareMetadata(
    readJson(settingsPath),
    fixture.settings,
    { preferences: [{ checkForUpdatesOnStartup: true, motion: "system" }] },
    `${stage}:settings`,
    observed,
  );
  assert.deepEqual(
    regularTree(fixture.tf2Root),
    fixture.liveHashes,
    `${stage}: synthetic live files changed`,
  );
  return {
    stage,
    profiles: fixture.metadata["index.json"].profiles.length,
    manifestPayloadReferences: publicProfileFixture.sources.reduce(
      (sum, source) => sum + source.manifest.files.length,
      0,
    ),
    storedPayloads: Object.keys(libraryHashes).length - Object.keys(fixture.metadata).length,
    libraryPayloadsPreserved: true,
    profileIdentityAndRecordsPreserved: true,
    confirmedRootPreserved: true,
    syntheticLiveFilesPreserved: true,
    allowedAdditiveMetadataObserved: observed,
  };
}
