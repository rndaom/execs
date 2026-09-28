#!/usr/bin/env node
// Reports whether the pinned upstream sources execs reads at runtime have
// moved on: comfig.app's hit sound list and TF2HUD.Editor's HUD option
// schemas. Both are pinned to one commit so a bad upstream change never
// reaches players unreviewed, which also means new uploads and schema fixes
// arrive only when a release bumps the pin. Run before every release:
//
//   node scripts/pinned-sources.mjs          # report
//   node scripts/pinned-sources.mjs --check  # exit 1 when a tracked path changed
//
// Uses GitHub's public API without a token (60 requests an hour).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCES = [
  {
    name: "comfig.app hit sound list",
    file: "apps/desktop/src-tauri/src/hitsound_fetch.rs",
    constant: "COMFIG_INDEX_COMMIT",
    repo: "mastercomfig/comfig-app",
    path: "src/ssg/hitsounds.json",
  },
  {
    name: "TF2HUD.Editor HUD option schemas",
    file: "apps/desktop/src-tauri/src/hud_fetch.rs",
    constant: "SCHEMA_COMMIT",
    repo: "CriticalFlaw/TF2HUD.Editor",
    path: "src/HUDEditor/JSON/",
  },
];

/** The 40-hex commit a `const NAME: &str = "…";` line pins. */
export function pinnedCommit(source, constant) {
  const match = new RegExp(`const ${constant}: &str = "([0-9a-f]{40})";`).exec(source);
  if (!match) throw new Error(`${constant} is not a pinned 40-character commit`);
  return match[1];
}

/** True when the newest commit touching the tracked path comes after the pin. */
export function pinIsBehind(compareStatus) {
  return compareStatus === "ahead" || compareStatus === "diverged";
}

async function github(path) {
  const response = await fetch(`https://api.github.com/${path}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "execs-release-check" },
  });
  if (!response.ok) throw new Error(`GitHub returned ${response.status} for ${path}`);
  return response.json();
}

async function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const check = process.argv.includes("--check");
  let stale = false;
  for (const source of SOURCES) {
    const commit = pinnedCommit(readFileSync(`${root}/${source.file}`, "utf8"), source.constant);
    // The newest upstream commit that touched the tracked file or folder.
    const [latest] = await github(
      `repos/${source.repo}/commits?path=${encodeURIComponent(source.path)}&per_page=1`,
    );
    console.log(`${source.name}: pinned ${commit.slice(0, 8)} (${source.constant})`);
    if (!latest) {
      console.log("  upstream has no commits for the tracked path");
      continue;
    }
    const compare = await github(`repos/${source.repo}/compare/${commit}...${latest.sha}`);
    if (pinIsBehind(compare.status)) {
      stale = true;
      console.log(
        `  ${source.path} changed upstream at ${latest.sha.slice(0, 8)} (${latest.commit.committer.date}).`,
      );
      console.log(`  Review it, bump ${source.constant} in ${source.file}, and rerun the tests.`);
    } else {
      console.log(`  current: ${source.path} has not changed since the pin`);
    }
  }
  if (check && stale) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
