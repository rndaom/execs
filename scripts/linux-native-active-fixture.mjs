import assert from "node:assert/strict";
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
import { regularTreeHashes } from "./linux-native-fixture.mjs";
import { linuxSteamCandidates } from "./package-smoke-fixture.mjs";

export const ACTIVE_HELPER = "tf/cfg/native-fixture.cfg";
export const EXPLICIT_APPEND = "// native explicit Save accepted\n";
export const DISCARD_APPEND = "// native close Discard must never reach disk\n";
export const CLOSE_SAVE_APPEND = "// native close Save accepted\n";
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const timestamp = "2026-09-22T00:00:00Z";
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const jsonBytes = (value) => `${JSON.stringify(value, null, 2)}\n`;

function ordinaryDirectory(path, stage) {
  const stat = lstatSync(path);
  assert.ok(!stat.isSymbolicLink() && stat.isDirectory(), `${stage}: invalid directory ${path}`);
  assert.equal(realpathSync(path), resolve(path), `${stage}: fixture root was redirected: ${path}`);
}

function contained(root, path, stage) {
  const part = relative(root, path);
  assert.ok(
    part && !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`),
    `${stage}: path is outside its fixture: ${path}`,
  );
}

function ordinaryTree(root) {
  const directories = [];
  function visit(path) {
    const stat = lstatSync(path);
    assert.ok(!stat.isSymbolicLink(), `Fixture contains a link: ${path}`);
    if (stat.isDirectory()) {
      if (path !== root) directories.push(relative(root, path).split(sep).join("/"));
      for (const name of readdirSync(path).sort()) visit(join(path, name));
    } else {
      assert.ok(stat.isFile(), `Fixture contains a non-file: ${path}`);
    }
  }
  visit(root);
  return { files: regularTreeHashes(root), directories: directories.sort() };
}

/** Unlike existsSync, this also refuses dangling links in a discovery path. */
function assertSteamAbsent(fixture, stage) {
  for (const candidate of linuxSteamCandidates(fixture.childEnv)) {
    const base = candidate.startsWith(`${fixture.childEnv.HOME}${sep}`)
      ? fixture.childEnv.HOME
      : fixture.childEnv.XDG_DATA_HOME;
    contained(base, candidate, stage);
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
        `${stage}: linked or invalid Steam discovery path: ${current}`,
      );
      assert.notEqual(current, candidate, `${stage}: discoverable Steam directory: ${candidate}`);
    }
  }
}

function protectedSnapshot(fixture, changed, stage) {
  ordinaryDirectory(fixture.parent, stage);
  assert.equal(dirname(fixture.scratch), fixture.parent, `${stage}: fixture parent changed`);
  for (const path of [
    fixture.scratch,
    ...Object.values(fixture.childEnv),
    fixture.data,
    fixture.library,
    fixture.tf2Root,
  ]) {
    ordinaryDirectory(path, stage);
    if (path !== fixture.scratch) contained(fixture.scratch, path, stage);
  }
  assert.equal(fixture.data, join(fixture.childEnv.XDG_DATA_HOME, "execs"));
  assert.equal(fixture.library, join(fixture.data, "profiles"));
  assert.equal(fixture.tf2Root, join(fixture.scratch, "fixture-tf2"));
  assertSteamAbsent(fixture, stage);
  const data = ordinaryTree(fixture.data);
  const live = ordinaryTree(fixture.tf2Root);
  const emptyMutation = `profiles/${fixture.profileId}/.mutation-data`;
  const dataDirectories = data.directories.filter((path) => changed && path === emptyMutation);
  assert.ok(dataDirectories.length <= 1);
  assert.deepEqual(
    data.directories.filter((path) => !dataDirectories.includes(path)),
    fixture.dataTree.directories,
    `${stage}: unexpected product directories (including recovery state)`,
  );
  assert.deepEqual(
    live.directories,
    fixture.liveTree.directories,
    `${stage}: live directories changed`,
  );
  assert.deepEqual(
    Object.keys(data.files).sort(),
    Object.keys(fixture.dataTree.files).sort(),
    `${stage}: product files added or removed`,
  );
  assert.deepEqual(
    Object.keys(live.files).sort(),
    Object.keys(fixture.liveTree.files).sort(),
    `${stage}: live files added or removed`,
  );
  return { data, live };
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

export function activeHelperText(profile) {
  assert.ok(["A", "B"].includes(profile));
  return `${Array.from({ length: 128 }, (_, index) =>
    index === 79
      ? `// ${profile} horizontal selection ${"owned-fixture-".repeat(24)}SELECTION-${profile}`
      : `// ${profile} native Files fixture line ${String(index + 1).padStart(3, "0")}`,
  ).join("\n")}\n// ${profile} original final sentinel\n`;
}

/** Two authored Vanilla profiles. No Steam folders, executable, packs or imported player data. */
export function seedLinuxNativeActiveFixture(parent) {
  assert.ok(parent && isAbsolute(parent), "Active native parent must be absolute");
  assert.equal(realpathSync(parent), resolve(parent), "Active native parent must not be a link");
  const scratch = mkdtempSync(join(parent, "execs-linux-native-active-"));
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
  mkdirSync(join(tf2Root, "tf", "custom"), { recursive: true });
  put(tf2Root, "tf/steam.inf", "ProductName=tf\nappID=440\n");
  put(
    tf2Root,
    "tf/cfg/config_default.cfg",
    "// owned active native fixture default\nsensitivity 3\n",
  );
  const settings = {
    schema: 1,
    tf2Root,
    preferences: { checkForUpdatesOnStartup: false, motion: "system" },
  };
  put(data, "settings.json", jsonBytes(settings));
  const metadata = {};
  const profiles = [];
  for (const [index, label] of ["A", "B"].entries()) {
    const id = `f2000002-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    const name = `Native Files ${label}`;
    const payloads = {
      "tf/cfg/config.cfg": `// owned native ${label} config\nsensitivity ${index === 0 ? "2.5" : "3.5"}\n`,
      [ACTIVE_HELPER]: activeHelperText(label),
    };
    const manifest = {
      schema: 1,
      id,
      name,
      tf2Root,
      launchOptions: "",
      launchSyncPending: false,
      files: Object.entries(payloads).map(([path, bytes]) => ({
        path,
        sha256: sha256(bytes),
        storage: "exclusive",
      })),
      hudRoots: [],
      preloader: { addons: [], particleMods: [], profileParticleMods: [] },
    };
    metadata[`${id}/manifest.json`] = manifest;
    put(library, `${id}/manifest.json`, jsonBytes(manifest));
    for (const [path, bytes] of Object.entries(payloads)) {
      put(library, `${id}/files/${path}`, bytes);
      if (index === 0) put(tf2Root, path, bytes);
    }
    profiles.push({ id, name, createdAt: timestamp, updatedAt: timestamp });
  }
  metadata["index.json"] = { schema: 1, tf2Root, activeProfileId: profiles[0].id, profiles };
  put(library, "index.json", jsonBytes(metadata["index.json"]));
  const fixture = {
    parent,
    scratch,
    childEnv,
    data,
    library,
    tf2Root,
    profileId: profiles[0].id,
    otherProfileId: profiles[1].id,
    activeId: profiles[0].id,
    helperPath: ACTIVE_HELPER,
    configPath: "tf/cfg/config.cfg",
    settings,
    metadata,
    libraryHashes: regularTreeHashes(library),
    liveHashes: regularTreeHashes(tf2Root),
    settingsHash: sha256(readFileSync(join(data, "settings.json"))),
    helperText: activeHelperText("A"),
    initialText: activeHelperText("A"),
    otherText: activeHelperText("B"),
    selectionLine: 80,
    selectionText: "SELECTION-A",
    seededAt: new Date().toISOString(),
    dataTree: ordinaryTree(data),
    liveTree: ordinaryTree(tf2Root),
    provenance: {
      authored:
        "Two schema-1 Vanilla profiles with wholly authored cfg payloads and comment-only helpers; A active and mirrored exactly, B an unchanged control. No Steam or game executable. Not an upgrade test.",
    },
  };
  assertLinuxNativeActiveFixture(fixture, "original", "seeded");
  return fixture;
}

export function expectedActiveText(fixture, phase) {
  assert.ok(
    ["original", "explicit-saved", "close-saved"].includes(phase),
    "Unknown active fixture phase",
  );
  return (
    fixture.helperText +
    (phase === "original" ? "" : EXPLICIT_APPEND) +
    (phase === "close-saved" ? CLOSE_SAVE_APPEND : "")
  );
}

/** Exact allowlist of two UI-authorized commits; no arbitrary caller-supplied hash baseline. */
export function assertLinuxNativeActiveFixture(fixture, phase, stage) {
  const text = expectedActiveText(fixture, phase);
  const changed = phase !== "original";
  const { data, live } = protectedSnapshot(fixture, changed, stage);
  const helperLibrary = `${fixture.profileId}/files/${ACTIVE_HELPER}`;
  const manifestPath = `${fixture.profileId}/manifest.json`;
  const allowed = new Set(
    changed ? [helperLibrary, manifestPath, "index.json"].map((path) => `profiles/${path}`) : [],
  );
  for (const [path, hash] of Object.entries(fixture.dataTree.files)) {
    if (!allowed.has(path))
      assert.equal(data.files[path], hash, `${stage}: unrelated product file changed: ${path}`);
  }
  const manifest = readJson(join(fixture.library, manifestPath));
  const expectedManifest = structuredClone(fixture.metadata[manifestPath]);
  expectedManifest.files.find((file) => file.path === ACTIVE_HELPER).sha256 = sha256(text);
  assert.deepEqual(
    manifest,
    expectedManifest,
    `${stage}: active manifest changed outside the helper hash`,
  );
  const index = readJson(join(fixture.library, "index.json"));
  const expectedIndex = structuredClone(fixture.metadata["index.json"]);
  if (changed) {
    const value = index.profiles?.[0]?.updatedAt;
    assert.match(
      value ?? "",
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
      `${stage}: invalid updatedAt`,
    );
    assert.ok(
      Date.parse(value) >= Math.floor(Date.parse(fixture.seededAt) / 1000) * 1000 &&
        Date.parse(value) <= Date.now(),
      `${stage}: updatedAt outside this run`,
    );
    expectedIndex.profiles[0].updatedAt = value;
  }
  assert.deepEqual(index, expectedIndex, `${stage}: index changed outside active updatedAt`);
  assert.equal(
    readFileSync(join(fixture.library, helperLibrary), "utf8"),
    text,
    `${stage}: library helper bytes differ`,
  );
  const expectedLive = { ...fixture.liveHashes, [ACTIVE_HELPER]: sha256(text) };
  assert.deepEqual(live.files, expectedLive, `${stage}: synthetic live files differ`);
  const settingsPath = join(fixture.data, "settings.json");
  assert.ok(lstatSync(settingsPath).isFile() && !lstatSync(settingsPath).isSymbolicLink());
  assert.equal(
    sha256(readFileSync(settingsPath)),
    fixture.settingsHash,
    `${stage}: settings bytes changed`,
  );
  assert.deepEqual(readJson(settingsPath), fixture.settings);
  return {
    schema: 1,
    stage,
    phase,
    scratch: fixture.scratch,
    recordedAt: new Date().toISOString(),
    activeProfileId: fixture.profileId,
    profiles: 2,
    helperSha256: sha256(text),
    helperBytes: Buffer.byteLength(text),
    libraryAndLiveMatch: true,
    unrelatedPayloadsAndMetadataPreserved: true,
    settingsPreserved: true,
    steamDirectoriesAbsent: true,
    protectedFiles: Object.keys(data.files).length + Object.keys(live.files).length,
    activeUpdatedAt: index.profiles[0].updatedAt,
    dataHashes: data.files,
    liveHashes: live.files,
    emptyMutationContainer: data.directories.includes(
      `profiles/${fixture.profileId}/.mutation-data`,
    ),
  };
}

/** A later Cancel, Discard or restart must not quietly rewrite saved metadata. */
export function assertLinuxNativeActiveCheckpoint(fixture, checkpoint, stage) {
  assert.equal(checkpoint.schema, 1, `${stage}: invalid checkpoint schema`);
  assert.equal(
    checkpoint.scratch,
    fixture.scratch,
    `${stage}: checkpoint belongs to another fixture`,
  );
  const current = assertLinuxNativeActiveFixture(fixture, checkpoint.phase, stage);
  assert.deepEqual(
    current.dataHashes,
    checkpoint.dataHashes,
    `${stage}: product bytes changed since checkpoint`,
  );
  assert.deepEqual(
    current.liveHashes,
    checkpoint.liveHashes,
    `${stage}: live bytes changed since checkpoint`,
  );
  return { ...current, exactCheckpointPreserved: true, checkpointStage: checkpoint.stage };
}
