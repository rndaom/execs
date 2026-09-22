import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import {
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
import test from "node:test";
import {
  assertDevelopmentHost,
  developmentVersions,
  prepareUnsignedConfig,
  regularFile,
  requireContained,
  selectPublicPackage,
  sha256,
  unsignedConfig,
  verifyPublicPackage,
} from "./development-package-guard.mjs";
import {
  DevelopmentPackageSession,
  selectOwnedDialog,
  verifyAppImageMount,
} from "./development-package-native.mjs";
import {
  assertNoPlayerProcesses,
  candidateName,
  finishPackageCase,
} from "./development-package-smoke.mjs";
import { publicProfileFixture } from "./package-smoke-fixture.mjs";

function fixture(fn) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "execs-development-guard-test-")));
  try {
    fn(root);
  } finally {
    assert.equal(dirname(root), realpathSync(tmpdir()));
    assert.ok(basename(root).startsWith("execs-development-guard-test-"));
    assert.equal(realpathSync(root), root);
    rmSync(root, { recursive: true, force: true });
  }
}

test("development host gate rejects player hosts, tags, forks and signing secrets before work", () => {
  const env = {
    CI: "true",
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY: "rndaom/execs",
    RUNNER_TEMP: resolve(tmpdir()),
    GITHUB_REF: "refs/pull/60/merge",
  };
  assertDevelopmentHost(env, "linux");
  for (const change of [
    { CI: "false" },
    { GITHUB_ACTIONS: "false" },
    { RUNNER_ENVIRONMENT: "self-hosted" },
    { GITHUB_REPOSITORY: "other/execs" },
    { RUNNER_TEMP: "relative" },
    { GITHUB_REF: "refs/tags/v0.2.0" },
    { TAURI_SIGNING_PRIVATE_KEY: "test-only-not-a-key" },
    { TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "test-password" },
  ])
    assert.throws(() => assertDevelopmentHost({ ...env, ...change }, "linux"));
  assert.throws(() => assertDevelopmentHost(env, "win32"), /Linux only/);
});

test("unsigned configuration is a fresh contained file and cannot reuse or redirect a destination", () =>
  fixture((root) => {
    const path = prepareUnsignedConfig(root);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), unsignedConfig);
    assert.throws(() => prepareUnsignedConfig(root));
    assert.throws(() => requireContained(root, root));
    assert.throws(() => requireContained(root, join(root, "..", "elsewhere")));
    const target = join(root, "target");
    mkdirSync(target);
    const link = join(root, "linked");
    symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => prepareUnsignedConfig(link), /redirected/);
  }));

test("development version rehearsal uses actual repository history without changing it", () =>
  fixture((root) => {
    const repository = resolve(".");
    const original = readFileSync(join(repository, "CHANGELOG.md"));
    const versions = developmentVersions(repository, root);
    assert.equal(`v${versions.previousVersion}`, publicProfileFixture.exporterTag);
    assert.equal(
      versions.version,
      JSON.parse(readFileSync(join(repository, "apps/desktop/package.json"))).version,
    );
    assert.equal(versions.historySha256, sha256(original));
    assert.ok(readFileSync(join(repository, "CHANGELOG.md")).equals(original));
    assert.ok(
      readFileSync(join(root, "version-inputs/CHANGELOG.md"), "utf8").includes(
        `## [${versions.version}]`,
      ),
    );
  }));

function release(kind = "deb", version = "0.1.8") {
  const name = `execs_${version}_amd64.${kind === "deb" ? "deb" : "AppImage"}`;
  return {
    tagName: `v${version}`,
    isDraft: false,
    isPrerelease: false,
    publishedAt: "2026-09-21T02:26:18Z",
    assets: [name, `${name}.sig`].map((name) => ({
      name,
      size: 100,
      url: `https://github.com/rndaom/execs/releases/download/v${version}/${name}`,
    })),
  };
}

test("public package selection binds exact version, public state, signature and asset origin", () => {
  for (const kind of ["appimage", "deb"]) {
    const value = release(kind);
    assert.equal(selectPublicPackage(value, "0.1.8", kind).artifact.name, value.assets[0].name);
    for (const patch of [
      { isDraft: true },
      { isPrerelease: true },
      { tagName: "v0.1.7" },
      { publishedAt: "" },
      { assets: value.assets.slice(0, 1) },
      { assets: [...value.assets, value.assets[0]] },
      {
        assets: value.assets.map((asset) => ({
          ...asset,
          url: asset.url.replace("github.com", "example.com"),
        })),
      },
      { assets: value.assets.map((asset) => ({ ...asset, url: `${asset.url}?mutable=true` })) },
      { assets: value.assets.map((asset) => ({ ...asset, size: 0 })) },
    ])
      assert.throws(() => selectPublicPackage({ ...value, ...patch }, "0.1.8", kind));
  }
});

test("package authenticity refuses tampered downloaded bytes before any executable use", () =>
  fixture((root) => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const bytes = Buffer.from("authored test package bytes");
    const id = Buffer.alloc(8, 7);
    const signature = sign(null, bytes, privateKey);
    const comment = "timestamp:1";
    const encodedSignature = Buffer.from(
      `untrusted comment: test\n${Buffer.concat([Buffer.from("Ed"), id, signature]).toString("base64")}\ntrusted comment: ${comment}\n${sign(null, Buffer.concat([signature, Buffer.from(comment)]), privateKey).toString("base64")}\n`,
    ).toString("base64");
    const key = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
    const encodedKey = Buffer.from(
      `untrusted comment: test\n${Buffer.concat([Buffer.from("Ed"), id, key]).toString("base64")}\n`,
    ).toString("base64");
    const selected = {
      kind: "deb",
      artifact: { name: "fixture.deb", size: bytes.length },
      signature: { name: "fixture.deb.sig", size: Buffer.byteLength(encodedSignature) },
    };
    writeFileSync(join(root, "fixture.deb"), bytes);
    writeFileSync(join(root, "fixture.deb.sig"), encodedSignature);
    assert.equal(verifyPublicPackage(root, selected, encodedKey).signatureVerified, true);
    writeFileSync(join(root, "fixture.deb"), Buffer.alloc(bytes.length, 1));
    assert.throws(() => verifyPublicPackage(root, selected, encodedKey), /signature is invalid/);
    assert.throws(() => regularFile(join(root, "fixture.deb"), 2), /size/);
  }));

test("GTK dialog selection refuses a foreign PID, ambiguous window or different title", () => {
  const window = { id: 123, pid: 700, title: "Export profile", deleteProtocol: true };
  assert.equal(selectOwnedDialog({ windows: [window] }, 700, "Export profile").id, 123);
  assert.throws(() => selectOwnedDialog({ windows: [window] }, 701, "Export profile"));
  assert.throws(() =>
    selectOwnedDialog({ windows: [window, { ...window, id: 124 }] }, 700, "Export profile"),
  );
  assert.throws(() => selectOwnedDialog({ windows: [window] }, 700, "Import profile"));
  assert.throws(() =>
    selectOwnedDialog({ windows: [{ ...window, deleteProtocol: false }] }, 700, "Export profile"),
  );
});

test("configuration entrypoint refuses a local host before creating any file", () => {
  const result = spawnSync(
    process.execPath,
    [resolve("scripts/development-package-guard.mjs"), "--prepare"],
    { env: { ...process.env, CI: "false" }, encoding: "utf8", timeout: 5_000 },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /implements Linux only|requires CI/);
});

test("runtime entrypoint refuses a player host before package or native commands", () => {
  const result = spawnSync(process.execPath, [resolve("scripts/development-package-smoke.mjs")], {
    env: { ...process.env, CI: "false" },
    encoding: "utf8",
    timeout: 5_000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /implements Linux only|requires CI/);
});

test("candidate and process selection refuses ambiguity, wrong revision and player processes", () => {
  assert.equal(
    candidateName(["execs_0.2.0_amd64.deb", "execs_0.1.8_amd64.deb"], "0.2.0", "deb"),
    "execs_0.2.0_amd64.deb",
  );
  assert.throws(() => candidateName(["execs_0.1.8_amd64.deb"], "0.2.0", "deb"));
  assert.throws(() =>
    candidateName(["execs_0.2.0_amd64.deb", "execs_0.2.0_amd64.deb"], "0.2.0", "deb"),
  );
  assertNoPlayerProcesses("node\nWebKitWebProcess\n");
  for (const processName of ["execs", "steam", "tf_linux64", "tf_win64.exe"])
    assert.throws(() => assertNoPlayerProcesses(`node\n ${processName}\n`));
});

test("normal AppImage identity requires its exact private read-only FUSE mount", () => {
  const path = "/owned/tmp/.mount_execs123/usr/bin/execs";
  const line =
    "100 24 0:45 / /owned/tmp/.mount_execs123 ro,nosuid,nodev - fuse.AppImage execs ro,user_id=1001";
  assert.equal(verifyAppImageMount(path, "/owned/tmp", line).filesystem, "fuse.AppImage");
  for (const changed of [
    line.replace("fuse.AppImage", "ext4"),
    line.replace("ro,nosuid,nodev", "rw,nosuid,nodev"),
    line.replace(".mount_execs123", ".mount_other"),
    `${line}\n${line}`,
  ])
    assert.throws(() => verifyAppImageMount(path, "/owned/tmp", changed));
  assert.throws(() =>
    verifyAppImageMount("/owned/tmp/extracted/usr/bin/execs", "/owned/tmp", line),
  );
  assert.throws(() => verifyAppImageMount(path, "/different/tmp", line));
});

test("failed native work retains its original failure and still detects post-cleanup corruption", async () => {
  const original = new Error("native selector unavailable");
  const cleanup = new AggregateError([new Error("driver cleanup failed")], "cleanup wrapper");
  const row = {};
  const events = [];
  const expected = Buffer.from("original fixture payload");
  const actual = Buffer.from(expected);
  const error = await finishPackageCase({
    primaryError: original,
    row,
    cleanup: () => {
      events.push("cleanup");
      actual[0] ^= 1;
      throw cleanup;
    },
    compare: () => {
      events.push("compare");
      assert.deepEqual(actual, expected, "fixture corruption");
    },
    save: () => {
      events.push("save");
      assert.equal(row.status, "failed");
    },
  });
  assert.ok(error instanceof AggregateError);
  assert.equal(error.cause, original);
  assert.equal(error.errors[0], original);
  assert.equal(error.errors[1], cleanup);
  assert.match(error.errors[2].message, /fixture corruption/);
  assert.deepEqual(events, ["cleanup", "compare", "save"]);
  assert.deepEqual(
    row.finalization.map(({ status }) => status),
    ["failed", "failed"],
  );
  assert.match(row.finalization[0].causes[0], /driver cleanup failed/);
});

test("successful native work cannot mask cleanup, comparison or evidence-write failure", async () => {
  for (const failedStage of ["cleanup", "compare", "save"]) {
    const failure = new Error(failedStage);
    const events = [];
    const action = (stage) => () => {
      events.push(stage);
      if (stage === failedStage) throw failure;
    };
    const row = {};
    assert.equal(
      await finishPackageCase({
        row,
        cleanup: action("cleanup"),
        compare: action("compare"),
        save: action("save"),
      }),
      failure,
    );
    assert.equal(row.status, "failed");
    assert.deepEqual(events, ["cleanup", "compare", "save"]);
  }
  const row = {};
  assert.equal(
    await finishPackageCase({ row, cleanup: () => {}, compare: () => {}, save: () => {} }),
    undefined,
  );
  assert.equal(row.status, "passed");
});

test("driver cleanup reports an unexplained close failure without a native process", async () => {
  const report = { checks: [] };
  const session = new DevelopmentPackageSession({ report });
  const failure = new Error("driver unavailable");
  session.driver = {
    close: async () => {
      throw failure;
    },
  };
  await assert.rejects(
    session.stop(),
    (error) => error instanceof AggregateError && error.errors[0] === failure,
  );
  assert.equal(report.checks[0].nativeAlreadyExited, false);
  assert.match(report.checks[0].error, /driver unavailable/);
  await session.stop();
});
