#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const INSTALL_FOOTER = [
  "---",
  "",
  "Windows: `execs_*_x64-setup.exe` (SmartScreen: More info → Run anyway).",
  "Linux: AppImage (self-updating) or `.deb` (first install only).",
  "",
].join("\n");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function headingPattern(version) {
  const date = "(?:[ \\t]+[\\-\\u2013\\u2014][ \\t]+\\d{4}-\\d{2}-\\d{2})?";
  return new RegExp(`^## \\[${escapeRegExp(version)}\\]${date}[ \\t]*$`, "m");
}

/** One `## [version]` body from a Keep a Changelog file. */
export function extractChangelogSection(markdown, version) {
  const wanted = version === "Unreleased" ? "Unreleased" : version.replace(/^v/i, "");
  const match = headingPattern(wanted).exec(markdown);
  if (!match) {
    throw new Error(`CHANGELOG.md has no '## [${wanted}]' section.`);
  }
  const rest = markdown.slice(match.index + match[0].length);
  const next = /^## \[/m.exec(rest);
  const body = (next ? rest.slice(0, next.index) : rest).trim();
  if (!body) {
    throw new Error(`CHANGELOG.md section '${wanted}' is empty.`);
  }
  return body;
}

export function formatGithubReleaseNotes(section) {
  return `${section}\n\n${INSTALL_FOOTER}`;
}

export function releaseNotesFromChangelog(markdown, version) {
  return formatGithubReleaseNotes(extractChangelogSection(markdown, version));
}

export function changelogPath(from = import.meta.url) {
  return join(dirname(fileURLToPath(from)), "..", "CHANGELOG.md");
}

function main(argv) {
  const version = argv[2];
  if (!version) {
    console.error("usage: node scripts/release-notes.mjs <version>");
    process.exit(2);
  }
  process.stdout.write(releaseNotesFromChangelog(readFileSync(changelogPath(), "utf8"), version));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv);
}
