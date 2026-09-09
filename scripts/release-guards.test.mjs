import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { releaseNotesFromChangelog } from "./release-notes.mjs";
import {
  parseReleaseVersion,
  previousReleaseVersion,
  releaseAssetVersion,
  releaseInstallerName,
  releaseName,
  releaseVersion,
} from "./release-version.mjs";
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
    const release = { tag_name: "v0.1.1", draft: true, prerelease: false, assets: [] };
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

test("draft URL identity accepts its stable signed API assets and refuses temporary feed URLs", () => {
  const directory = mkdtempSync(join(tmpdir(), "execs-release-draft-"));
  try {
    const { bytes, signature, key } = signatureFixture();
    const version = "0.1.3+1";
    const slug = "untagged-da3cb7d716e6735787e3";
    const release = {
      tag_name: `v${version}`,
      draft: true,
      prerelease: false,
      html_url: `https://github.com/rndaom/execs/releases/tag/${slug}`,
      assets: [],
    };
    const manifest = { version, platforms: {} };
    for (const [id, platform, suffix] of [
      [1, "windows-x86_64", "x64-setup.exe"],
      [2, "linux-x86_64", "amd64.AppImage"],
    ]) {
      const name = `execs_${version}_${suffix}`;
      const url = `https://api.github.com/repos/rndaom/execs/releases/assets/${id}`;
      release.assets.push({
        name,
        url,
        browser_download_url: `https://github.com/rndaom/execs/releases/download/${slug}/${encodeURIComponent(name)}`,
        size: bytes.length,
      });
      manifest.platforms[platform] = { url, signature };
      writeFileSync(join(directory, name), bytes);
      writeFileSync(join(directory, `${name}.sig`), signature);
    }
    verifyRelease(structuredClone(manifest), release, directory, version, key);
    const wrongDraft = structuredClone(release);
    wrongDraft.html_url = wrongDraft.html_url.replace(slug, "untagged-deadbeef");
    assert.throws(() => verifyRelease(manifest, wrongDraft, directory, version, key));
    const temporary = structuredClone(manifest);
    temporary.platforms["windows-x86_64"].url = release.assets[0].browser_download_url;
    assert.throws(() => verifyRelease(temporary, release, directory, version, key));
    const wrongTag = { ...release, tag_name: "v0.1.3" };
    assert.throws(() => verifyRelease(manifest, wrongTag, directory, version, key));
  } finally {
    removeFixture(directory);
  }
});

test("previous installers use actual published asset names with literal or sanitized revisions", () => {
  for (const spelling of ["0.1.3+1", "0.1.3.1"]) {
    const release = {
      tagName: "v0.1.3+1",
      isDraft: false,
      assets: [
        { name: `execs_${spelling}_x64-setup.exe` },
        { name: `execs_${spelling}_amd64.AppImage` },
      ],
    };
    assert.equal(releaseInstallerName(release, "0.1.3+1", true), release.assets[0].name);
    assert.equal(releaseInstallerName(release, "0.1.3+1", false), release.assets[1].name);
    assert.throws(() => releaseInstallerName({ ...release, isDraft: true }, "0.1.3+1", true));
    assert.throws(() => releaseInstallerName(release, "0.1.3", true));
    assert.throws(() => releaseInstallerName({ ...release, assets: [] }, "0.1.3+1", true));
    assert.throws(() =>
      releaseInstallerName(
        { ...release, assets: [...release.assets, release.assets[0]] },
        "0.1.3+1",
        true,
      ),
    );
  }
});

function writeProductVersion(root, version) {
  for (const path of ["apps/desktop", "apps/desktop/src-tauri", "apps/desktop/src-tauri/core"])
    mkdirSync(join(root, path), { recursive: true });
  for (const path of ["apps/desktop/package.json", "apps/desktop/src-tauri/tauri.conf.json"])
    writeFileSync(join(root, path), JSON.stringify({ version }));
  for (const path of [
    "apps/desktop/src-tauri/Cargo.toml",
    "apps/desktop/src-tauri/core/Cargo.toml",
  ])
    writeFileSync(join(root, path), `[package]\nversion = "${version}"\n`);
}

test("stable hotfix versions accept only canonical positive bounded numeric revisions", () => {
  for (const version of ["0.1.3", "0.1.3+1", "0.1.3+9", "0.1.3+10", "0.1.3+65535"])
    assert.doesNotThrow(() => parseReleaseVersion(version), version);
  for (const version of [
    "0.1.3+0",
    "0.1.3+01",
    "0.1.3+0001",
    "0.1.3+65536",
    "0.1.3+99999999999999999999",
    "0.1.3+hotfix1",
    "0.1.3+1.2",
    "0.1.3+1-extra",
    "0.1.3+1+2",
    "0.1.3+",
    "0.1.3-rc.1",
    "0.1.3-rc.1+1",
    "00.1.3",
    "0.01.3",
    "0.1.03",
    "v0.1.3+1",
    "0.1.3+1\n",
    " 0.1.3+1",
  ])
    assert.throws(() => parseReleaseVersion(version), undefined, version);
  assert.equal(releaseName("0.1.3"), "execs v0.1.3");
  assert.equal(releaseName("0.1.3+1"), "execs v0.1.3 — Hotfix 1");
  assert.equal(releaseAssetVersion("0.1.3"), "0.1.3");
  assert.equal(releaseAssetVersion("0.1.3+1"), "0.1.3.1");
  assert.equal(releaseAssetVersion("0.1.3+65535"), "0.1.3.65535");
});

test("a hotfix requires its own exact tag, four source versions and substantive changelog section", () => {
  const root = mkdtempSync(join(tmpdir(), "execs-release-hotfix-"));
  try {
    writeProductVersion(root, "0.1.3+1");
    const changelog =
      "## [Unreleased]\n\n## [0.1.3+1] - 2026-09-07\n\n- Fix profile isolation.\n\n## [0.1.3]\n\n- Original release.\n\n## [0.1.2]\n\n- Previous release.\n";
    writeFileSync(join(root, "CHANGELOG.md"), changelog);
    assert.equal(releaseVersion(root, "v0.1.3+1"), "0.1.3+1");
    assert.throws(() => releaseVersion(root, "v0.1.3"));
    assert.throws(() => releaseVersion(root, "v0.1.3%2B1"));
    const notes = releaseNotesFromChangelog(changelog, "0.1.3+1");
    assert.match(notes, /Fix profile isolation/);
    assert.doesNotMatch(notes, /Original release|Previous release/);
    for (const path of [
      "apps/desktop/package.json",
      "apps/desktop/src-tauri/tauri.conf.json",
      "apps/desktop/src-tauri/Cargo.toml",
      "apps/desktop/src-tauri/core/Cargo.toml",
    ]) {
      const fullPath = join(root, path);
      const original = readFileSync(fullPath, "utf8");
      writeFileSync(fullPath, original.replaceAll("0.1.3+1", "0.1.3"));
      assert.throws(() => releaseVersion(root, "v0.1.3+1"), undefined, path);
      writeFileSync(fullPath, original);
    }
    writeFileSync(join(root, "CHANGELOG.md"), "## [0.1.3]\n\n- Original release.\n");
    assert.throws(() => releaseVersion(root, "v0.1.3+1"));
    writeFileSync(join(root, "CHANGELOG.md"), "## [0.1.3+1]\n\n### Fixed\n");
    assert.throws(() => releaseVersion(root, "v0.1.3+1"));
    writeProductVersion(root, "0.1.3+01");
    writeFileSync(join(root, "CHANGELOG.md"), "## [0.1.3+01]\n\n- Invalid revision.\n");
    assert.throws(() => releaseVersion(root, "v0.1.3+01"));
  } finally {
    removeFixture(root);
  }
});

test("updater history selects the immediately preceding stable release or numeric hotfix", () => {
  const root = mkdtempSync(join(tmpdir(), "execs-release-history-"));
  try {
    const releases = ["0.1.4", "0.1.3+10", "0.1.3+9", "0.1.3+2", "0.1.3+1", "0.1.3", "0.1.2"];
    writeFileSync(
      join(root, "CHANGELOG.md"),
      `## [Unreleased]\r\n\r\n${releases.map((version) => `## [${version}] - 2026-09-07\r\n\r\n- A release.\r\n`).join("\r\n")}`,
    );
    for (const [index, version] of releases.slice(0, -1).entries())
      assert.equal(previousReleaseVersion(root, version), releases[index + 1]);
    for (const [current, previous] of [
      ["0.1.3+1", "0.1.3+2"],
      ["0.1.3+1", "0.1.3+1"],
      ["0.1.3", "0.1.3+1"],
      ["0.1.3+2", "0.1.4"],
      ["0.1.3+1", "0.1.3+0"],
      ["0.1.3+1", "0.1.3+01"],
    ]) {
      writeFileSync(
        join(root, "CHANGELOG.md"),
        `## [${current}]\n\n- Current.\n\n## [${previous}]\n\n- Previous.\n`,
      );
      assert.throws(
        () => previousReleaseVersion(root, current),
        undefined,
        `${current} after ${previous}`,
      );
    }
  } finally {
    removeFixture(root);
  }
});

test("signed hotfix assets accept literal or encoded plus URLs and reject original-release substitutions", () => {
  const directory = mkdtempSync(join(tmpdir(), "execs-release-plus-"));
  try {
    const { bytes, signature, key } = signatureFixture();
    const version = "0.1.3+1";
    const release = { tag_name: `v${version}`, draft: true, prerelease: false, assets: [] };
    const manifest = { version, platforms: {} };
    for (const [platform, name] of [
      ["windows-x86_64", `execs_${version}_x64-setup.exe`],
      ["linux-x86_64", `execs_${version}_amd64.AppImage`],
    ]) {
      const literal = `https://github.com/rndaom/execs/releases/download/v${version}/${name}`;
      release.assets.push({
        name,
        browser_download_url: literal.replaceAll("+", "%2B"),
        size: bytes.length,
      });
      manifest.platforms[platform] = { url: literal, signature };
      writeFileSync(join(directory, name), bytes);
      writeFileSync(join(directory, `${name}.sig`), signature);
    }
    verifyRelease(structuredClone(manifest), release, directory, version, key);
    const encoded = structuredClone(manifest);
    for (const entry of Object.values(encoded.platforms))
      entry.url = entry.url.replaceAll("+", "%2b");
    verifyRelease(encoded, release, directory, version, key);
    // Accept upload paths that sanitize filenames without changing the tag.
    for (const [index, platform] of ["windows-x86_64", "linux-x86_64"].entries()) {
      const asset = release.assets[index];
      asset.name = asset.name.replace(version, releaseAssetVersion(version));
      const literal = `https://github.com/rndaom/execs/releases/download/v${version}/${asset.name}`;
      asset.browser_download_url = literal.replaceAll("+", "%2B");
      manifest.platforms[platform].url = literal;
      writeFileSync(join(directory, asset.name), bytes);
      writeFileSync(join(directory, `${asset.name}.sig`), signature);
    }
    verifyRelease(structuredClone(manifest), release, directory, version, key);
    for (const change of [
      (feed) => {
        feed.version = "0.1.3";
      },
      (_feed, source) => {
        source.tag_name = "v0.1.3";
      },
      (_feed, source) => {
        source.draft = false;
      },
      (_feed, source) => {
        source.prerelease = true;
      },
      (_feed, source) => {
        source.assets[0].name = "execs_0.1.3_x64-setup.exe";
      },
      (feed) => {
        feed.platforms["windows-x86_64"].url = feed.platforms["windows-x86_64"].url.replace(
          "v0.1.3+1/",
          "v0.1.3/",
        );
      },
      (feed, source) => {
        source.assets[0].browser_download_url = source.assets[0].browser_download_url.replace(
          "v0.1.3%2B1/",
          "v0.1.3/",
        );
        feed.platforms["windows-x86_64"].url = source.assets[0].browser_download_url;
      },
    ]) {
      const feed = structuredClone(manifest);
      const source = structuredClone(release);
      change(feed, source);
      assert.throws(() => verifyRelease(feed, source, directory, version, key));
    }
    writeFileSync(join(directory, release.assets[0].name), Buffer.from("changed hotfix payload"));
    assert.throws(() => verifyRelease(manifest, release, directory, version, key));
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
    writeFileSync(
      join(root, "CHANGELOG.md"),
      "## [0.1.1]\n\n### Fixed\n\n- A real fix.\n\n## [0.1.0]\n\n### Added\n\n- First release.\n",
    );
    assert.equal(releaseVersion(root, "v0.1.1"), "0.1.1");
    assert.equal(previousReleaseVersion(root, "0.1.1"), "0.1.0");
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

test("package smoke derives and passes the immediately previous changelog release", () => {
  const smoke = readFileSync("scripts/smoke-packages.mjs", "utf8");
  const probe = readFileSync("apps/desktop/src-tauri/examples/updater_probe.rs", "utf8");
  assert.match(smoke, /const oldVersion = previousReleaseVersion\(process\.cwd\(\), version\)/);
  assert.match(smoke, /`v\$\{oldVersion\}`/);
  assert.doesNotMatch(smoke, /"v0\.1\.1"/);
  assert.match(smoke, /version,\s*oldVersion,\s*\]\);/);
  assert.doesNotMatch(smoke, /execs_0\.1\.1_/);
  assert.match(probe, /args\[4\]\.parse\(\)/);
  assert.doesNotMatch(probe, /context\.package_info_mut\(\)\.version = "0\.1\.1"/);
});

test("release workflow always waits for the reusable CI gate", () => {
  const yaml = readFileSync(".github/workflows/release.yml", "utf8");
  assert.match(yaml, /uses: \.\/\.github\/workflows\/ci.yml/);
  assert.match(yaml, /build:\s*\n\s*needs: \[validate\]/);
  assert.match(yaml, /node scripts\/verify-release.mjs/);
  assert.match(yaml, /--features release-probes --examples/);
  assert.match(yaml, /run: node scripts\/smoke-updater-check.mjs/);
  assert.match(yaml, /run: xvfb-run -a node scripts\/smoke-updater-check.mjs/);
  assert.ok(
    yaml.indexOf("scripts/smoke-updater-check.mjs") < yaml.indexOf("scripts/smoke-packages.mjs"),
  );
  assert.match(yaml, /already public; refusing to replace its assets/);
  assert.match(yaml, /node scripts\/release-version.mjs "\$RELEASE_TAG" --name/);
  assert.match(yaml, /releaseName: \$\{\{ steps\.release\.outputs\.name \}\}/);
  assert.match(yaml, /gh release edit "\$TAG" --draft=false --prerelease=false --latest/);
  assert.match(yaml, /node scripts\/release-version.mjs "\$TAG" --name/);
  assert.match(yaml, /--latest --title "\$name"/);
});

test("release candidates and tag builds share a product-tag concurrency lock", () => {
  const yaml = readFileSync(".github/workflows/release.yml", "utf8");
  assert.match(
    yaml,
    /workflow_dispatch:\s*\n\s*inputs:\s*\n\s*release_tag:\s*\n(?:\s+.*\n)*?\s*required: true/,
  );
  assert.match(
    yaml,
    /group: release-\$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.release_tag \|\| github\.ref_name \}\}/,
  );
  assert.match(yaml, /cancel-in-progress: false/);
  assert.match(
    yaml,
    /RELEASE_TAG: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.release_tag \|\| github\.ref_name \}\}/,
  );
  assert.match(yaml, /node scripts\/release-version.mjs "\$RELEASE_TAG"/);
  assert.match(yaml, /releaseDraft: true/);
  assert.match(yaml, /publish:\s*\n\s*needs: \[verify\]\s*\n\s*if: github\.event_name == 'push'/);
});
