import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { publicProfileFixture } from "./package-smoke-fixture.mjs";
import {
  previousReleaseVersion,
  releaseAssetVersion,
  releaseInstallerName,
  releaseVersion,
} from "./release-version.mjs";
import { verifyMinisign } from "./verify-release.mjs";

export const REPOSITORY = "rndaom/execs";
export const DEVELOPMENT_CONFIG = "execs-development-package-config.json";
export const unsignedConfig = { bundle: { createUpdaterArtifacts: false } };
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Tauri changes only its embedded bundle-kind marker for a Debian package. */
export function assertDebianBundledBinary(buildBinary, bundledBinary) {
  const original = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_UNK");
  const debian = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_DEB");
  assert.equal(original.length, debian.length);
  assert.equal(buildBinary.length, bundledBinary.length, "Debian executable size changed");
  const offset = buildBinary.indexOf(original);
  assert.ok(offset >= 0, "Build executable lacks Tauri's bundle marker");
  assert.equal(buildBinary.indexOf(original, offset + 1), -1, "Ambiguous Tauri bundle marker");
  const expected = Buffer.from(buildBinary);
  debian.copy(expected, offset);
  assert.equal(
    sha256(bundledBinary),
    sha256(expected),
    "Debian executable differs beyond Tauri's bundle-kind marker",
  );
  return {
    buildSha256: sha256(buildBinary),
    packagedSha256: sha256(bundledBinary),
    markerOffset: offset,
  };
}

export function assertDevelopmentHost(env = process.env, platform = process.platform) {
  assert.equal(platform, "linux", "Development package smoke currently implements Linux only");
  assert.equal(env.CI, "true", "Development package smoke requires CI");
  assert.equal(env.GITHUB_ACTIONS, "true", "Development package smoke requires GitHub Actions");
  assert.equal(env.RUNNER_ENVIRONMENT, "github-hosted", "Self-hosted workers are refused");
  assert.equal(env.GITHUB_REPOSITORY, REPOSITORY, "Unexpected package qualification repository");
  assert.ok(env.RUNNER_TEMP && isAbsolute(env.RUNNER_TEMP), "RUNNER_TEMP must be absolute");
  assert.ok(!env.GITHUB_REF?.startsWith("refs/tags/"), "Tag runs are refused");
  for (const key of [
    "TAURI_SIGNING_PRIVATE_KEY",
    "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
    "WINDOWS_CERTIFICATE",
    "WINDOWS_CERTIFICATE_PASSWORD",
  ]) {
    assert.ok(!env[key], `Signing secrets must not enter this unsigned workflow: ${key}`);
  }
}

export function requireContained(root, path) {
  assert.ok(isAbsolute(root) && isAbsolute(path));
  const part = relative(root, path);
  assert.ok(
    part && !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`),
    `Path escapes owned directory: ${path}`,
  );
  return path;
}

export function regularFile(path, maximum = 512 * 1024 * 1024) {
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), `Expected ordinary file: ${path}`);
  assert.ok(stat.size > 0 && stat.size <= maximum, `Unexpected file size: ${path}`);
  return readFileSync(path);
}

export function prepareUnsignedConfig(parent) {
  assert.ok(isAbsolute(parent));
  assert.equal(realpathSync(parent), resolve(parent), "Runner temporary root is redirected");
  const path = join(parent, DEVELOPMENT_CONFIG);
  writeFileSync(path, `${JSON.stringify(unsignedConfig)}\n`, { flag: "wx" });
  return path;
}

/** Rehearse the release heading in an owned copy, never change development history. */
export function developmentVersions(repository, scratch) {
  const copy = join(scratch, "version-inputs");
  mkdirSync(copy);
  for (const path of [
    "apps/desktop/package.json",
    "apps/desktop/src-tauri/tauri.conf.json",
    "apps/desktop/src-tauri/Cargo.toml",
    "apps/desktop/src-tauri/core/Cargo.toml",
  ]) {
    const destination = join(copy, path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(repository, path), destination);
  }
  const version = JSON.parse(readFileSync(join(copy, "apps/desktop/package.json"), "utf8")).version;
  const history = readFileSync(join(repository, "CHANGELOG.md"), "utf8");
  const hasCurrent = history.split(/\r?\n/).some((line) => line.startsWith(`## [${version}]`));
  const rehearsed = hasCurrent
    ? history
    : history.replace(/^## \[Unreleased\][^\r\n]*$/m, `## [${version}]`);
  writeFileSync(join(copy, "CHANGELOG.md"), rehearsed);
  assert.equal(releaseVersion(copy), version);
  const previousVersion = previousReleaseVersion(copy, version);
  assert.equal(
    `v${previousVersion}`,
    publicProfileFixture.exporterTag,
    "Previous public export fixture must be refreshed, not relabeled",
  );
  return {
    version,
    previousVersion,
    historySha256: sha256(history),
    temporaryHeadingRehearsal: !hasCurrent,
  };
}

export function selectPublicPackage(release, version, kind) {
  assert.ok(["appimage", "deb"].includes(kind));
  assert.equal(release.tagName, `v${version}`);
  assert.equal(release.isDraft, false);
  assert.equal(release.isPrerelease, false);
  assert.ok(release.publishedAt && Number.isFinite(Date.parse(release.publishedAt)));
  const names = [...new Set([version, releaseAssetVersion(version)])].map(
    (value) => `execs_${value}_amd64.deb`,
  );
  const name =
    kind === "appimage"
      ? releaseInstallerName(release, version, false)
      : (() => {
          const matches = release.assets.filter((asset) => names.includes(asset.name));
          assert.equal(matches.length, 1, "Expected exactly one previous Debian package");
          return matches[0].name;
        })();
  const select = (selectedName, maximum) => {
    const matches = release.assets.filter((asset) => asset.name === selectedName);
    assert.equal(matches.length, 1, `Missing or ambiguous public asset: ${selectedName}`);
    const asset = matches[0];
    assert.equal(basename(asset.name), asset.name);
    const url = new URL(asset.url);
    assert.equal(url.origin, "https://github.com");
    assert.equal(url.search + url.hash, "");
    assert.equal(
      decodeURIComponent(url.pathname),
      `/${REPOSITORY}/releases/download/v${version}/${asset.name}`,
    );
    assert.ok(Number.isInteger(asset.size) && asset.size > 0 && asset.size <= maximum);
    return asset;
  };
  return {
    kind,
    artifact: select(name, 512 * 1024 * 1024),
    signature: select(`${name}.sig`, 16 * 1024),
  };
}

export function verifyPublicPackage(directory, selected, publicKey) {
  const bytes = regularFile(join(directory, selected.artifact.name));
  const signature = regularFile(join(directory, selected.signature.name), 16 * 1024);
  assert.equal(
    bytes.length,
    selected.artifact.size,
    "Public artifact length differs from release metadata",
  );
  assert.equal(signature.length, selected.signature.size);
  verifyMinisign(bytes, signature.toString("utf8"), publicKey);
  return {
    kind: selected.kind,
    path: join(directory, selected.artifact.name),
    name: selected.artifact.name,
    url: selected.artifact.url,
    bytes: bytes.length,
    sha256: sha256(bytes),
    signatureVerified: true,
  };
}

export function downloadPublicPackages(directory, previousVersion, publicKey) {
  const fields = "tagName,isDraft,isPrerelease,publishedAt,assets";
  const view = (tag) =>
    JSON.parse(
      execFileSync("gh", ["release", "view", ...tag, "--repo", REPOSITORY, "--json", fields], {
        encoding: "utf8",
        timeout: 60_000,
      }),
    );
  const latest = view([]);
  assert.equal(
    latest.tagName,
    `v${previousVersion}`,
    "Public latest advanced; review history and actual exporter fixtures before testing",
  );
  const release = view([`v${previousVersion}`]);
  const packages = {};
  for (const kind of ["appimage", "deb"]) {
    const selected = selectPublicPackage(release, previousVersion, kind);
    execFileSync(
      "gh",
      [
        "release",
        "download",
        `v${previousVersion}`,
        "--repo",
        REPOSITORY,
        "--dir",
        directory,
        "--pattern",
        selected.artifact.name,
        "--pattern",
        selected.signature.name,
      ],
      { stdio: "inherit", timeout: 180_000 },
    );
    packages[kind] = verifyPublicPackage(directory, selected, publicKey);
  }
  return { release, packages };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  assertDevelopmentHost();
  assert.equal(process.argv[2], "--prepare");
  console.log(prepareUnsignedConfig(process.env.RUNNER_TEMP));
}
