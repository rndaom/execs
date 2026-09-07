import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { extractChangelogSection } from "./release-notes.mjs";

// Product releases remain stable triplets. A numeric build revision is the
// only supported hotfix suffix; its bound matches the NSIS version resource.
export function parseReleaseVersion(version) {
  assert.equal(typeof version, "string", "Release version must be a string");
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+([1-9]\d{0,4}))?$/.exec(version);
  assert.ok(
    match && match[0] === version,
    "Release version must be stable semver with an optional numeric +N hotfix revision",
  );
  const revision = Number(match[4] ?? 0);
  assert.ok(revision <= 65535, "Hotfix revision must be between 1 and 65535");
  return { baseVersion: `${match[1]}.${match[2]}.${match[3]}`, revision };
}

export function releaseName(version) {
  const { baseVersion, revision } = parseReleaseVersion(version);
  return `execs v${baseVersion}${revision ? ` — Hotfix ${revision}` : ""}`;
}

// Some upload paths sanitize '+' to '.'. GitHub can also retain the literal
// '+', so inspect actual release assets instead of assuming either spelling.
export function releaseAssetVersion(version) {
  parseReleaseVersion(version);
  return version.replace("+", ".");
}

export function releaseInstallerName(release, version, windows) {
  parseReleaseVersion(version);
  assert.equal(release.tagName, `v${version}`, "Previous installer tag mismatch");
  assert.equal(release.isDraft, false, "Previous installer must be public");
  const names = [version, releaseAssetVersion(version)].map(
    (value) => `execs_${value}_${windows ? "x64-setup.exe" : "amd64.AppImage"}`,
  );
  const matches = release.assets.filter((asset) => names.includes(asset.name));
  assert.equal(matches.length, 1, "Exactly one previous installer revision is required");
  return matches[0].name;
}

function isOlderRelease(previous, current) {
  const parts = (value) => {
    const { baseVersion, revision } = parseReleaseVersion(value);
    return [...baseVersion.split(".").map(BigInt), BigInt(revision)];
  };
  const before = parts(previous);
  const after = parts(current);
  const different = before.findIndex((part, index) => part !== after[index]);
  return different !== -1 && before[different] < after[different];
}

export function releaseVersion(root, tag) {
  const read = (path) => readFileSync(resolve(root, path), "utf8");
  const versions = [
    JSON.parse(read("apps/desktop/package.json")).version,
    JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json")).version,
    ...["apps/desktop/src-tauri/Cargo.toml", "apps/desktop/src-tauri/core/Cargo.toml"].map(
      (path) => read(path).match(/^version = "([^"]+)"$/m)?.[1],
    ),
  ];
  const version = versions[0];
  parseReleaseVersion(version);
  assert.ok(
    versions.every((value) => value === version),
    `Product versions disagree: ${versions}`,
  );
  if (tag) assert.equal(tag, `v${version}`, "Tag must match all four product versions");
  const notes = extractChangelogSection(read("CHANGELOG.md"), version);
  assert.match(notes, /^- \S/m, "Release notes must contain at least one user-facing entry");
  return version;
}

export function previousReleaseVersion(root, version) {
  parseReleaseVersion(version);
  const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
  const releases = [
    ...changelog.matchAll(
      /^## \[([^\]\r\n]+)\](?:[ \t]+[-–—][ \t]+\d{4}-\d{2}-\d{2})?[ \t]*\r?$/gm,
    ),
  ]
    .map((match) => match[1])
    .filter((value) => value !== "Unreleased");
  for (const release of releases) parseReleaseVersion(release);
  assert.equal(new Set(releases).size, releases.length, "Duplicate release in CHANGELOG.md");
  const current = releases.indexOf(version);
  assert.notEqual(current, -1, `Release ${version} is missing from CHANGELOG.md`);
  assert.ok(releases[current + 1], `Release ${version} has no previous release in CHANGELOG.md`);
  const previous = releases[current + 1];
  assert.ok(
    isOlderRelease(previous, version),
    `Previous changelog release ${previous} must be older than ${version}`,
  );
  return previous;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const version = releaseVersion(process.cwd(), process.argv[2]);
  console.log(process.argv[3] === "--name" ? releaseName(version) : version);
}
