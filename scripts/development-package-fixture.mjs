import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  linuxSteamCandidates,
  publicProfileFixture,
  seedPackageFixture,
} from "./package-smoke-fixture.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const emptyPreloader = { addons: [], particleMods: [], profileParticleMods: [] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const maximumArchiveBytes = 2 * 1024 * 1024;

function contained(root, path) {
  const part = relative(root, path);
  assert.ok(
    part && !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`),
    `Outside fixture: ${path}`,
  );
}

function ordinaryDirectory(path) {
  const stat = lstatSync(path);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), `Invalid fixture directory: ${path}`);
  assert.equal(realpathSync(path), resolve(path), `Redirected fixture directory: ${path}`);
}

function tree(root) {
  const files = {};
  const directories = [];
  function visit(path) {
    const stat = lstatSync(path);
    assert.ok(!stat.isSymbolicLink(), `Linked fixture path: ${path}`);
    const key = relative(root, path).split(sep).join("/");
    if (stat.isDirectory()) {
      if (key) directories.push(key);
      for (const name of readdirSync(path).sort()) visit(join(path, name));
    } else {
      assert.ok(stat.isFile(), `Non-regular fixture path: ${path}`);
      assert.ok(stat.size <= maximumArchiveBytes, `Oversized fixture file: ${path}`);
      files[key] = digest(readFileSync(path));
    }
  }
  visit(root);
  return { files, directories: directories.sort() };
}

function directoriesForFiles(files) {
  const directories = new Set();
  for (const path of Object.keys(files)) {
    const parts = path.split("/");
    for (let count = 1; count < parts.length; count += 1)
      directories.add(parts.slice(0, count).join("/"));
  }
  return [...directories].sort();
}

function assertNoSteam(fixture) {
  for (const candidate of linuxSteamCandidates(fixture.childEnv)) {
    const base = candidate.startsWith(`${fixture.childEnv.HOME}${sep}`)
      ? fixture.childEnv.HOME
      : fixture.childEnv.XDG_DATA_HOME;
    contained(base, candidate);
    let current = base;
    for (const part of relative(base, candidate).split(sep)) {
      current = join(current, part);
      let stat;
      try {
        stat = lstatSync(current);
      } catch (error) {
        if (error.code === "ENOENT") break;
        throw error;
      }
      assert.ok(
        !stat.isSymbolicLink() && stat.isDirectory(),
        `Invalid Steam discovery ancestor: ${current}`,
      );
      assert.notEqual(current, candidate, `Discoverable Steam directory: ${candidate}`);
    }
  }
}

function snapshot(fixture, stage) {
  ordinaryDirectory(fixture.parent);
  assert.equal(dirname(fixture.scratch), fixture.parent, `${stage}: case parent changed`);
  for (const path of [
    fixture.scratch,
    ...Object.values(fixture.childEnv),
    fixture.data,
    fixture.library,
    fixture.tf2Root,
    fixture.exports,
  ]) {
    ordinaryDirectory(path);
    if (path !== fixture.scratch) contained(fixture.scratch, path);
  }
  assert.equal(fixture.data, join(fixture.childEnv.XDG_DATA_HOME, "execs"));
  assert.equal(fixture.library, join(fixture.data, "profiles"));
  assert.equal(fixture.tf2Root, join(fixture.scratch, "fixture-tf2"));
  assert.equal(fixture.exports, join(fixture.scratch, "exports"));
  assert.equal(fixture.exportPath, join(fixture.exports, "previous-ui-export.zip"));
  assertNoSteam(fixture);
  return { data: tree(fixture.data), live: tree(fixture.tf2Root), exports: tree(fixture.exports) };
}

/** Fresh Linux case; the shared tagged payload fixture remains unchanged. */
export function seedDevelopmentPackageFixture(parent, previousVersion) {
  assert.ok(parent && isAbsolute(parent), "Package fixture parent must be absolute");
  ordinaryDirectory(parent);
  const canonicalParent = realpathSync(parent);
  const scratch = mkdtempSync(join(canonicalParent, "execs-development-package-"));
  const base = seedPackageFixture(scratch, false, previousVersion);
  const childEnv = {
    ...base.childEnv,
    HOME: join(scratch, "home"),
    XDG_CACHE_HOME: join(scratch, "cache"),
    XDG_RUNTIME_DIR: join(scratch, "runtime"),
    TMPDIR: join(scratch, "tmp"),
  };
  for (const key of ["HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR", "TMPDIR"])
    mkdirSync(childEnv[key], { mode: 0o700 });
  const settings = {
    ...base.settings,
    preferences: { checkForUpdatesOnStartup: false, motion: "system" },
  };
  writeFileSync(join(base.data, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
  const exports = join(scratch, "exports");
  mkdirSync(exports);
  const source = publicProfileFixture.sources.find((entry) => entry.case === "no-hud");
  assert.ok(source);
  const activeProfileId = base.metadata["index.json"].activeProfileId;
  const activeProfileName = base.metadata[`${activeProfileId}/manifest.json`].name;
  const portableManifest = { ...structuredClone(source.manifest), name: activeProfileName };
  const config = source.manifest.files.find((file) => file.path === "tf/cfg/config.cfg");
  const fixture = {
    ...base,
    root: scratch,
    scratch,
    parent: canonicalParent,
    childEnv,
    settings,
    exports,
    exportPath: join(exports, "previous-ui-export.zip"),
    activeProfileId,
    activeProfileName,
    expectedConfigText: Buffer.from(
      publicProfileFixture.payloads[config.sha256],
      "base64",
    ).toString("utf8"),
    portableManifest,
    seededAt: new Date().toISOString(),
    baseline: { data: tree(base.data), live: tree(base.tf2Root) },
    provenance: {
      ...base.provenance,
      authored: `${base.provenance.authored} This Linux case additionally authors isolated HOME/XDG/TMPDIR and disables candidate startup update checking before recording its baseline. Actual installed-old UI export provenance must be recorded by the runner; fixture metadata alone does not prove it.`,
    },
  };
  assertDevelopmentPackagePreserved(fixture, "seeded");
  return fixture;
}

export function developmentPackageEnvironment(fixture, env) {
  const inherited = {};
  for (const key of ["PATH", "DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "LANG", "TZ"])
    if (env[key]) inherited[key] = env[key];
  return { ...inherited, ...fixture.childEnv, GDK_BACKEND: "x11", LIBGL_ALWAYS_SOFTWARE: "1" };
}

function assertArchiveProof(fixture, proof, observed) {
  if (!proof) {
    assert.deepEqual(
      observed,
      { files: {}, directories: [] },
      "Unexpected export before native Save",
    );
    return;
  }
  assert.equal(proof.schema, 1);
  assert.equal(proof.path, fixture.exportPath, "Export proof belongs to another case");
  assert.deepEqual(proof.manifest, fixture.portableManifest, "Export proof metadata changed");
  assert.deepEqual(
    observed,
    { files: { "previous-ui-export.zip": proof.sha256 }, directories: [] },
    "Export bytes/path changed",
  );
}

function checkpoint(fixture, phase, stage, observed, proof, details = {}) {
  return {
    schema: 1,
    phase,
    stage,
    scratch: fixture.scratch,
    recordedAt: new Date().toISOString(),
    dataHashes: observed.data.files,
    liveHashes: observed.live.files,
    exportHashes: observed.exports.files,
    archiveProof: proof,
    originalProfilesPreserved: true,
    originalPayloadsPreserved: true,
    steamDirectoriesAbsent: true,
    ...details,
  };
}

export function assertDevelopmentPackagePreserved(fixture, stage, archiveProof = null) {
  const observed = snapshot(fixture, stage);
  assert.deepEqual(
    observed.data,
    fixture.baseline.data,
    `${stage}: original product bytes or directories changed`,
  );
  assert.deepEqual(
    observed.live,
    fixture.baseline.live,
    `${stage}: original live bytes or directories changed`,
  );
  assertArchiveProof(fixture, archiveProof, observed.exports);
  return checkpoint(fixture, "preserved", stage, observed, archiveProof, {
    activeProfileId: fixture.activeProfileId,
    profiles: 2,
  });
}

// Read-only, bounded inspection. No extraction, imports, product calls or network.
const inspectZip = String.raw`
import hashlib, io, json, os, stat, sys, zipfile
path = sys.argv[1]
assert stat.S_ISREG(os.lstat(path).st_mode)
with open(path, "rb") as stream:
    raw = stream.read(2 * 1024 * 1024 + 1)
assert len(raw) <= 2 * 1024 * 1024, "archive too large"
def unique(pairs):
    result = {}
    for key, value in pairs:
        assert key not in result, "duplicate JSON key"
        result[key] = value
    return result
members, seen, total, manifest = [], set(), 0, None
with zipfile.ZipFile(io.BytesIO(raw)) as archive:
    assert 0 < len(archive.infolist()) <= 16, "entry count"
    for entry in archive.infolist():
        name = entry.filename
        assert 0 < len(name) <= 1024 and "\\" not in name and ":" not in name and "\x00" not in name, "unsafe member"
        parts = name.split("/")
        assert len(parts) <= 32 and all(part not in ("", ".", "..") for part in parts), "unsafe member"
        assert name.casefold() not in seen, "duplicate member"
        seen.add(name.casefold())
        assert not entry.is_dir() and not entry.flag_bits & 1, "directory or encrypted member"
        assert stat.S_IFMT(entry.external_attr >> 16) in (0, stat.S_IFREG), "special member"
        assert entry.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED), "unsupported compression"
        assert entry.file_size <= 1024 * 1024, "member too large"
        with archive.open(entry) as stream:
            data = stream.read(1024 * 1024 + 1)
        assert len(data) == entry.file_size and len(data) <= 1024 * 1024, "member length"
        total += len(data)
        assert total <= 2 * 1024 * 1024, "expanded archive too large"
        members.append({"name": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        if name == "execs-profile.json":
            manifest = json.loads(data.decode("utf-8"), object_pairs_hook=unique)
assert manifest is not None, "missing manifest"
print(json.dumps({"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw), "members": members, "manifest": manifest}))
`;

/** The caller records which actual native binary/UI created this inspected ZIP. */
export function inspectDevelopmentPackageExport(fixture, { python = "python3" } = {}) {
  const observed = snapshot(fixture, "inspect-old-export");
  assert.deepEqual(observed.data, fixture.baseline.data, "Product changed while exporting");
  assert.deepEqual(observed.live, fixture.baseline.live, "Live files changed while exporting");
  assert.deepEqual(
    Object.keys(observed.exports.files),
    ["previous-ui-export.zip"],
    "Native export missing or unexpected destination",
  );
  assert.deepEqual(observed.exports.directories, []);
  const pythonEnv = {
    ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  };
  const result = spawnSync(python, ["-I", "-c", inspectZip, fixture.exportPath], {
    encoding: "utf8",
    env: pythonEnv,
    timeout: 10_000,
    maxBuffer: 128 * 1024,
    windowsHide: true,
  });
  assert.equal(result.error, undefined, `ZIP inspector could not run: ${result.error?.message}`);
  assert.equal(result.status, 0, `ZIP inspection failed: ${result.stderr}`);
  const inspected = JSON.parse(result.stdout);
  assert.equal(
    inspected.sha256,
    observed.exports.files["previous-ui-export.zip"],
    "Archive changed during inspection",
  );
  assert.equal(
    digest(readFileSync(fixture.exportPath)),
    inspected.sha256,
    "Archive changed after inspection",
  );
  assert.deepEqual(
    inspected.manifest,
    fixture.portableManifest,
    "Old portable export metadata differs",
  );
  const expectedMembers = new Map([["execs-profile.json", null]]);
  for (const file of fixture.portableManifest.files) {
    const name = file.storage === "shared" ? `blobs/${file.sha256}` : `files/${file.path}`;
    expectedMembers.set(name, {
      sha256: file.sha256,
      bytes: Buffer.from(publicProfileFixture.payloads[file.sha256], "base64").length,
    });
  }
  assert.deepEqual(
    inspected.members.map(({ name }) => name).sort(),
    [...expectedMembers.keys()].sort(),
    "Unexpected archive members",
  );
  for (const member of inspected.members) {
    const expected = expectedMembers.get(member.name);
    if (expected)
      assert.deepEqual(
        { sha256: member.sha256, bytes: member.bytes },
        expected,
        `Export payload changed: ${member.name}`,
      );
  }
  const proof = {
    schema: 1,
    path: fixture.exportPath,
    sha256: inspected.sha256,
    bytes: inspected.bytes,
    manifest: inspected.manifest,
    members: inspected.members,
    payloadsVerified: fixture.portableManifest.files.length,
    provenance:
      "Read-only bounded ZIP inspection; native exporter binary and UI provenance are recorded separately by the runner.",
  };
  const after = snapshot(fixture, "export-inspected");
  assert.deepEqual(after.data, fixture.baseline.data, "Product changed during ZIP inspection");
  assert.deepEqual(after.live, fixture.baseline.live, "Live files changed during ZIP inspection");
  assertArchiveProof(fixture, proof, after.exports);
  return proof;
}

function currentTimestamp(value, fixture) {
  assert.match(
    value ?? "",
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    "Invalid native profile timestamp",
  );
  assert.ok(
    Date.parse(value) >= Math.floor(Date.parse(fixture.seededAt) / 1000) * 1000 &&
      Date.parse(value) <= Date.now(),
    "Profile timestamp outside this case",
  );
}

function candidateState(fixture, archiveProof, switched, stage) {
  assert.ok(archiveProof, "An inspected old export is required");
  const observed = snapshot(fixture, stage);
  assertArchiveProof(fixture, archiveProof, observed.exports);
  const index = readJson(join(fixture.library, "index.json"));
  const originalIndex = fixture.metadata["index.json"];
  assert.equal(index.profiles?.length, 3, `${stage}: import must add exactly one profile`);
  assert.deepEqual(
    index.profiles.slice(0, 2),
    originalIndex.profiles,
    `${stage}: original profile summaries changed`,
  );
  const summary = index.profiles[2];
  assert.match(summary.id, uuid, `${stage}: imported id is not a fresh UUID`);
  assert.ok(
    !originalIndex.profiles.some(({ id }) => id === summary.id),
    `${stage}: imported identity reused`,
  );
  currentTimestamp(summary.createdAt, fixture);
  assert.deepEqual(
    summary,
    {
      id: summary.id,
      name: fixture.activeProfileName,
      createdAt: summary.createdAt,
      updatedAt: summary.createdAt,
    },
    `${stage}: unexpected imported summary`,
  );
  const expectedIndex = {
    ...structuredClone(originalIndex),
    activeProfileId: switched ? summary.id : fixture.activeProfileId,
    profiles: [...structuredClone(originalIndex.profiles), summary],
  };
  assert.deepEqual(
    index,
    expectedIndex,
    `${stage}: index changed beyond the authorized import/switch`,
  );
  const portable = fixture.portableManifest;
  const expectedManifest = {
    schema: 1,
    id: summary.id,
    name: portable.name,
    tf2Root: fixture.tf2Root,
    launchOptions: portable.launchOptions,
    launchSyncPending: true,
    files: portable.files,
    hudRoots: [],
    mods: portable.mods,
    preloader: emptyPreloader,
  };
  const manifestPath = `profiles/${summary.id}/manifest.json`;
  assert.deepEqual(
    readJson(join(fixture.data, manifestPath)),
    expectedManifest,
    `${stage}: imported ownership or metadata differs`,
  );
  const expectedFiles = {
    ...fixture.baseline.data.files,
    "profiles/index.json": observed.data.files["profiles/index.json"],
    [manifestPath]: observed.data.files[manifestPath],
  };
  for (const file of portable.files) {
    if (file.storage === "exclusive")
      expectedFiles[`profiles/${summary.id}/files/${file.path}`] = file.sha256;
  }
  assert.deepEqual(
    observed.data.files,
    expectedFiles,
    `${stage}: old library bytes or imported payloads differ`,
  );
  // Blob ingestion can leave its empty parent, never a staged member or link.
  assert.deepEqual(
    observed.data.directories.filter((path) => path !== "profiles/blobs/sha256/.incoming"),
    directoriesForFiles(expectedFiles),
    `${stage}: unexpected staging or product directories`,
  );
  assert.deepEqual(
    observed.live,
    fixture.baseline.live,
    `${stage}: exact exported payload projection changed`,
  );
  return checkpoint(fixture, switched ? "switched" : "imported", stage, observed, archiveProof, {
    profiles: 3,
    activeProfileId: index.activeProfileId,
    importedProfileId: summary.id,
    importedProfileName: summary.name,
    importedPayloadsVerified: portable.files.length,
    importedPreloaderEmpty: true,
    launchSyncPending: true,
    index,
    manifest: expectedManifest,
  });
}

export function assertDevelopmentPackageImported(fixture, archiveProof, stage) {
  return candidateState(fixture, archiveProof, false, stage);
}

export function assertDevelopmentPackageSwitched(fixture, importedCheckpoint, stage) {
  assert.equal(importedCheckpoint.schema, 1);
  assert.equal(
    importedCheckpoint.phase,
    "imported",
    "Switch needs the validated import checkpoint",
  );
  assert.equal(
    importedCheckpoint.scratch,
    fixture.scratch,
    "Import checkpoint belongs to another case",
  );
  const current = candidateState(fixture, importedCheckpoint.archiveProof, true, stage);
  assert.equal(current.importedProfileId, importedCheckpoint.importedProfileId);
  const { "profiles/index.json": _oldIndexHash, ...before } = importedCheckpoint.dataHashes;
  const { "profiles/index.json": _newIndexHash, ...after } = current.dataHashes;
  assert.deepEqual(after, before, `${stage}: switch rewrote a library payload or manifest`);
  assert.deepEqual(
    current.liveHashes,
    importedCheckpoint.liveHashes,
    `${stage}: switch payload differs from imported source`,
  );
  // Import already sets launchSyncPending:true. NoAccount leaves it true and
  // mark_launch_sync_pending has no metadata change to commit (switch.rs:299).
  assert.deepEqual(current.index, {
    ...importedCheckpoint.index,
    activeProfileId: current.importedProfileId,
  });
  return current;
}

export function assertDevelopmentPackageCheckpoint(fixture, saved, stage) {
  assert.equal(saved.schema, 1);
  assert.equal(saved.scratch, fixture.scratch, "Checkpoint belongs to another case");
  assert.ok(["preserved", "imported", "switched"].includes(saved.phase));
  const current =
    saved.phase === "preserved"
      ? assertDevelopmentPackagePreserved(fixture, stage, saved.archiveProof)
      : candidateState(fixture, saved.archiveProof, saved.phase === "switched", stage);
  for (const key of ["dataHashes", "liveHashes", "exportHashes"])
    assert.deepEqual(current[key], saved[key], `${stage}: ${key} changed after checkpoint`);
  return { ...current, exactCheckpointPreserved: true, checkpointStage: saved.stage };
}
