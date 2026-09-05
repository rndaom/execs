import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { extractChangelogSection } from "./release-notes.mjs";

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
  assert.match(version, /^\d+\.\d+\.\d+$/, "Release version must be stable semver");
  assert.ok(
    versions.every((value) => value === version),
    `Product versions disagree: ${versions}`,
  );
  if (tag) assert.equal(tag, `v${version}`, "Tag must match all four product versions");
  const notes = extractChangelogSection(read("CHANGELOG.md"), version);
  assert.match(notes, /^- \S/m, "Release notes must contain at least one user-facing entry");
  return version;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(releaseVersion(process.cwd(), process.argv[2]));
}
