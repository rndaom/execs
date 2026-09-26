import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { regularFile, sha256, verifyPublicPackage } from "./development-package-guard.mjs";
import { publicProfileFixture, seedPackageFixture } from "./package-smoke-fixture.mjs";
import { releaseInstallerName } from "./release-version.mjs";

export { sha256, verifyPublicPackage };

export function assertWindowsHost(env, event, platform = process.platform, arch = process.arch) {
  assert.equal(platform, "win32", "Hosted Windows only");
  assert.equal(arch, "x64");
  for (const [key, value] of Object.entries({
    CI: "true",
    GITHUB_ACTIONS: "true",
    RUNNER_OS: "Windows",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY: "rndaom/execs",
  }))
    assert.equal(env[key], value, `Refused ${key}`);
  assert.ok(win32.isAbsolute(env.RUNNER_TEMP ?? ""), "Absolute Windows RUNNER_TEMP required");
  assert.match(env.GITHUB_REF ?? "", /^refs\/(heads|pull)\//, "Tags are refused");
  assert.ok(["workflow_dispatch", "pull_request"].includes(env.GITHUB_EVENT_NAME));
  assert.equal(event.repository?.full_name, "rndaom/execs");
  if (env.GITHUB_EVENT_NAME === "pull_request")
    assert.equal(event.pull_request?.head?.repo?.full_name, "rndaom/execs", "Fork refused");
  for (const key of Object.keys(env))
    if (/^(TAURI_SIGNING_PRIVATE_KEY(?:_PASSWORD)?|WINDOWS_CERTIFICATE(?:_PASSWORD)?)$/i.test(key))
      assert.ok(!env[key], `Signing secret refused: ${key}`);
}

export function assertHostObservation(value) {
  assert.notEqual(value.sid, "S-1-5-18", "SYSTEM cannot host WebView2");
  assert.match(value.sid ?? "", /^S-1-5-/);
  assert.equal(value.packageCode, 15700, "Packaged launch context refused");
  assert.deepEqual(value.playerProcesses, [], "Existing execs/Steam/TF2 process refused");
  assert.deepEqual(value.steamRegistry, [], "Steam discovery refused");
  assert.deepEqual(value.productLocations, [], "Existing product data or installation refused");
  return value;
}

const equalPath = (a, b) =>
  process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;

/** Existing ancestors must be ordinary and resolve inside an ordinary owned root. */
export function containedPath(root, path, missingLeaf = false) {
  assert.ok(isAbsolute(root) && isAbsolute(path));
  const canonical = resolve(root);
  assert.ok(equalPath(realpathSync(root), canonical), `Redirected root: ${root}`);
  assert.ok(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink());
  const part = relative(canonical, resolve(path));
  assert.ok(part && !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`));
  const components = part.split(sep);
  let current = canonical;
  for (const [index, component] of components.entries()) {
    current = join(current, component);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT" && missingLeaf && index === components.length - 1) return path;
      throw error;
    }
    assert.ok(!stat.isSymbolicLink(), `Linked path: ${current}`);
    assert.ok(equalPath(realpathSync(current), resolve(current)), `Redirected path: ${current}`);
    assert.ok(stat.isFile() || stat.isDirectory(), `Special path: ${current}`);
    if (index < components.length - 1) assert.ok(stat.isDirectory());
  }
  return path;
}

export function snapshotTree(root) {
  assert.ok(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink());
  const files = {};
  const directories = [];
  let count = 0;
  function visit(path) {
    assert.ok(++count < 256, "Unexpected fixture inventory size");
    containedPath(root, path);
    const name = relative(root, path).split(sep).join("/");
    if (lstatSync(path).isDirectory()) {
      directories.push(name);
      for (const child of readdirSync(path).sort()) visit(join(path, child));
    } else files[name] = sha256(regularFile(path, 2 * 1024 * 1024));
  }
  for (const child of readdirSync(root).sort()) visit(join(root, child));
  return { files, directories: directories.sort() };
}

export function selectPreviousNsis(release, version) {
  assert.equal(release.tagName, `v${version}`);
  assert.equal(release.isDraft, false);
  assert.equal(release.isPrerelease, false);
  assert.ok(release.publishedAt && Number.isFinite(Date.parse(release.publishedAt)));
  const name = releaseInstallerName(release, version, true);
  function asset(expected, maximum) {
    const values = release.assets.filter((value) => value.name === expected);
    assert.equal(values.length, 1, `Ambiguous asset: ${expected}`);
    const value = values[0];
    const url = new URL(value.url);
    assert.equal(url.origin, "https://github.com");
    assert.equal(url.search + url.hash, "");
    assert.equal(
      decodeURIComponent(url.pathname),
      `/rndaom/execs/releases/download/v${version}/${expected}`,
    );
    assert.ok(Number.isInteger(value.size) && value.size > 0 && value.size <= maximum);
    return value;
  }
  return {
    kind: "nsis",
    artifact: asset(name, 512 * 1024 * 1024),
    signature: asset(`${name}.sig`, 16384),
  };
}

export function seedWindowsFixture(scratch, version) {
  const fixture = seedPackageFixture(scratch, true, version);
  for (const name of ["tmp", "webview", "exports"]) mkdirSync(join(scratch, name));
  const index = fixture.metadata["index.json"];
  const activeProfileId = index.activeProfileId;
  const activeProfileName = fixture.metadata[`${activeProfileId}/manifest.json`].name;
  const source = publicProfileFixture.sources.find((value) => value.case === "no-hud");
  assert.ok(source);
  return {
    ...fixture,
    scratch,
    activeProfileId,
    activeProfileName,
    exportPath: join(scratch, "exports", "previous-ui-export.zip"),
    webview: join(scratch, "webview"),
    portableManifest: { ...structuredClone(source.manifest), name: activeProfileName },
    baseline: { data: snapshotTree(fixture.data), live: snapshotTree(fixture.tf2Root) },
  };
}

export function windowsAppEnvironment(fixture, env) {
  const inherited = {};
  for (const key of [
    "SystemRoot",
    "WINDIR",
    "PATH",
    "PATHEXT",
    "COMSPEC",
    "USERPROFILE",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "ProgramData",
  ])
    if (env[key]) inherited[key] = env[key];
  return {
    ...inherited,
    ...fixture.childEnv,
    TEMP: join(fixture.scratch, "tmp"),
    TMP: join(fixture.scratch, "tmp"),
  };
}

export function assertWindowsFixturePreserved(fixture, proof = null) {
  for (const path of [
    fixture.data,
    fixture.library,
    fixture.tf2Root,
    fixture.webview,
    dirname(fixture.exportPath),
  ])
    containedPath(fixture.scratch, path);
  assert.equal(fixture.data, join(fixture.childEnv.APPDATA, "execs"));
  const data = snapshotTree(fixture.data);
  const live = snapshotTree(fixture.tf2Root);
  assert.deepEqual(data, fixture.baseline.data, "Original app-data bytes/inventory changed");
  assert.deepEqual(live, fixture.baseline.live, "Original live bytes/inventory changed");
  const exported = snapshotTree(dirname(fixture.exportPath));
  if (proof) {
    assert.equal(proof.path, fixture.exportPath);
    assert.deepEqual(proof.manifest, fixture.portableManifest);
  }
  assert.deepEqual(
    exported,
    { files: proof ? { "previous-ui-export.zip": proof.sha256 } : {}, directories: [] },
    "Unexpected export bytes/destination",
  );
  return {
    recordedAt: new Date().toISOString(),
    data,
    live,
    exported,
    originalBytesPreserved: true,
  };
}

/** Read-only ZIP inspection independent of the app/exporter implementation. */
export function inspectWindowsExport(fixture, python = "python") {
  containedPath(fixture.scratch, fixture.exportPath);
  const before = sha256(regularFile(fixture.exportPath, 2 * 1024 * 1024));
  const result = spawnSync(
    python,
    ["-I", fileURLToPath(new URL("./windows-package-zip.py", import.meta.url)), fixture.exportPath],
    {
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 128 * 1024,
      windowsHide: true,
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      },
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, `ZIP inspection failed: ${result.stderr}`);
  const proof = { schema: 1, path: fixture.exportPath, ...JSON.parse(result.stdout) };
  assert.equal(proof.sha256, before);
  assert.equal(sha256(regularFile(fixture.exportPath)), before, "Export changed during inspection");
  assert.deepEqual(proof.manifest, fixture.portableManifest, "Portable manifest changed");
  const expected = new Map([["execs-profile.json", null]]);
  for (const file of fixture.portableManifest.files)
    expected.set(file.storage === "shared" ? `blobs/${file.sha256}` : `files/${file.path}`, {
      sha256: file.sha256,
      bytes: Buffer.from(publicProfileFixture.payloads[file.sha256], "base64").length,
    });
  assert.deepEqual(proof.members.map((entry) => entry.name).sort(), [...expected.keys()].sort());
  for (const member of proof.members) {
    const wanted = expected.get(member.name);
    if (wanted)
      assert.deepEqual(
        { sha256: member.sha256, bytes: member.bytes },
        wanted,
        `Payload changed: ${member.name}`,
      );
  }
  assertWindowsFixturePreserved(fixture, proof);
  return proof;
}

export function assertNormalExit(receipt) {
  assert.equal(receipt.request, "owned-native-window-close");
  assert.equal(receipt.code, 0);
  assert.equal(receipt.signal, null);
  assert.equal(receipt.observedBeforeCleanup, true);
  assert.equal(receipt.forced, false);
  assert.ok(Number.isFinite(Date.parse(receipt.exitedAt)));
  return receipt;
}
