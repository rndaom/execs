import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  changelogPath,
  extractChangelogSection,
  formatGithubReleaseNotes,
  releaseNotesFromChangelog,
} from "./release-notes.mjs";

const FIXTURE = `# Changelog

## [Unreleased]

### Fixed

- HUD catalog empty state.

## [0.2.0] - 2026-10-01

### Added

- Example feature.

## [0.1.0] — 2026-09-03

First public release.

### Added

- Profiles.
`;

test("extracts a dated section and stops at the next heading", () => {
  const body = extractChangelogSection(FIXTURE, "0.2.0");
  assert.match(body, /Example feature/);
  assert.doesNotMatch(body, /Profiles/);
  assert.doesNotMatch(body, /HUD catalog/);
});

test("accepts an em-dash date and a v prefix", () => {
  const body = extractChangelogSection(FIXTURE, "v0.1.0");
  assert.equal(body, "First public release.\n\n### Added\n\n- Profiles.");
});

test("extracts Unreleased", () => {
  assert.match(extractChangelogSection(FIXTURE, "Unreleased"), /HUD catalog empty state/);
});

test("throws when the version is missing", () => {
  assert.throws(() => extractChangelogSection(FIXTURE, "0.9.0"), /no '## \[0\.9\.0\]' section/);
});

test("throws when the version section is empty", () => {
  const empty = "## [Unreleased]\n\n## [0.1.0] - 2026-09-03\n";
  assert.throws(() => extractChangelogSection(empty, "0.1.0"), /section '0\.1\.0' is empty/);
});

test("formats the GitHub install footer", () => {
  const notes = formatGithubReleaseNotes("### Fixed\n\n- Crash.");
  assert.match(notes, /### Fixed/);
  assert.match(notes, /More info → Run anyway/);
  assert.match(notes, /AppImage/);
});

test("reads the repo changelog for 0.1.0", () => {
  const notes = releaseNotesFromChangelog(readFileSync(changelogPath(), "utf8"), "0.1.0");
  assert.match(notes, /First public release/);
  assert.match(notes, /Profiles/);
  assert.doesNotMatch(notes, /## \[0\.1\.0\]/);
});
