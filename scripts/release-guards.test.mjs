import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { releaseVersion } from "./release-version.mjs";
import { verifyMinisign, verifyRelease } from "./verify-release.mjs";

function removeFixture(directory) {
  const target = resolve(directory);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.ok(basename(target).startsWith("execs-release-"));
  rmSync(target, { recursive: true });
}

function signatureFixture() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const id = Buffer.from("12345678");
  const bytes = Buffer.from("release test artifact");
  const sig = sign(null, createHash("blake2b512").update(bytes).digest(), privateKey);
  const comment = "timestamp:123456 file:test";
  const global = sign(null, Buffer.concat([sig, Buffer.from(comment)]), privateKey);
  const packet = Buffer.concat([Buffer.from("ED"), id, sig]).toString("base64");
  const signature = Buffer.from(
    `untrusted comment: test\n${packet}\ntrusted comment: ${comment}\n${global.toString("base64")}\n`,
  ).toString("base64");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const key = Buffer.from(
    `untrusted comment: test\n${Buffer.concat([Buffer.from("Ed"), id, raw]).toString("base64")}\n`,
  ).toString("base64");
  return { bytes, signature, key };
}

test("Minisign verification rejects changed bytes, signatures, keys and comments", () => {
  const { bytes, signature, key } = signatureFixture();
  verifyMinisign(bytes, signature, key);
  assert.throws(() => verifyMinisign(Buffer.from("changed"), signature, key));
  assert.throws(() => verifyMinisign(bytes, signatureFixture().signature, key));
  assert.throws(() => verifyMinisign(bytes, signature, signatureFixture().key));
  const changed = Buffer.from(
    Buffer.from(signature, "base64").toString().replace("timestamp:123456", "timestamp:123457"),
  ).toString("base64");
  assert.throws(() => verifyMinisign(bytes, changed, key));
});

test("release validation binds signatures to both assets and their release", () => {
  const directory = mkdtempSync(join(tmpdir(), "execs-release-guards-"));
  try {
    const { bytes, signature, key } = signatureFixture();
    const release = { tag_name: "v0.1.1", assets: [] };
    const manifest = { version: "0.1.1", platforms: { "linux-x86_64-deb": {} } };
    for (const [platform, name] of [
      ["windows-x86_64", "execs_0.1.1_x64-setup.exe"],
      ["linux-x86_64", "execs_0.1.1_amd64.AppImage"],
    ]) {
      const url = `https://github.com/rndaom/execs/releases/download/v0.1.1/${name}`;
      release.assets.push({ name, browser_download_url: url, size: bytes.length });
      manifest.platforms[platform] = { url, signature };
      writeFileSync(join(directory, name), bytes);
      writeFileSync(join(directory, `${name}.sig`), signature);
    }
    assert.equal(
      verifyRelease(structuredClone(manifest), release, directory, "0.1.1", key).platforms[
        "linux-x86_64-deb"
      ],
      undefined,
    );
    const other = structuredClone(manifest);
    other.platforms["linux-x86_64"].url = "https://example.org/other.AppImage";
    assert.throws(() => verifyRelease(other, release, directory, "0.1.1", key));
    other.platforms["linux-x86_64"].url =
      "https://api.github.com/repos/rndaom/execs/releases/assets/2";
    release.assets[1].url = other.platforms["linux-x86_64"].url;
    verifyRelease(other, release, directory, "0.1.1", key);
    delete other.platforms["linux-x86_64"];
    assert.throws(() => verifyRelease(other, release, directory, "0.1.1", key));
    assert.throws(() => verifyRelease(manifest, release, directory, "0.1.2", key));
  } finally {
    removeFixture(directory);
  }
});

test("all product versions, the tag and substantive notes must agree", () => {
  const root = mkdtempSync(join(tmpdir(), "execs-release-version-"));
  try {
    for (const path of ["apps/desktop", "apps/desktop/src-tauri", "apps/desktop/src-tauri/core"])
      mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, "apps/desktop/package.json"), '{"version":"0.1.1"}');
    writeFileSync(join(root, "apps/desktop/src-tauri/tauri.conf.json"), '{"version":"0.1.1"}');
    for (const file of [
      "apps/desktop/src-tauri/Cargo.toml",
      "apps/desktop/src-tauri/core/Cargo.toml",
    ])
      writeFileSync(join(root, file), '[package]\nversion = "0.1.1"\n');
    writeFileSync(join(root, "CHANGELOG.md"), "## [0.1.1]\n\n### Fixed\n\n- A real fix.\n");
    assert.equal(releaseVersion(root, "v0.1.1"), "0.1.1");
    assert.throws(() => releaseVersion(root, "v0.1.0"));
    writeFileSync(join(root, "apps/desktop/src-tauri/core/Cargo.toml"), 'version = "0.1.0"\n');
    assert.throws(() => releaseVersion(root));
    writeFileSync(join(root, "apps/desktop/src-tauri/core/Cargo.toml"), 'version = "0.1.1"\n');
    writeFileSync(join(root, "CHANGELOG.md"), "## [0.1.1]\n\n### Fixed\n");
    assert.throws(() => releaseVersion(root));
  } finally {
    removeFixture(root);
  }
});

test("release workflow always waits for the reusable CI gate", () => {
  const yaml = readFileSync(".github/workflows/release.yml", "utf8");
  assert.match(yaml, /uses: \.\/\.github\/workflows\/ci.yml/);
  assert.match(yaml, /build:\s*\n\s*needs: \[validate\]/);
  assert.match(yaml, /node scripts\/verify-release.mjs/);
});
