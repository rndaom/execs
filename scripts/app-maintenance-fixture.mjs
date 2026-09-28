import assert from "node:assert/strict";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Files execs itself writes into its data folder on an ordinary start: the
 * activity log that Copy diagnostics reads, and the record of the once-per-
 * version tidy-up. Preservation checks validate their shape and then leave
 * them out, exactly like the disposable absorb hint; every profile byte,
 * recovery record and other data-folder entry stays compared exactly.
 */
export const ACTIVITY_LOG = "logs/activity.log";
export const TIDY_MARKER = "maintenance/tidy-up.json";

const MAX_ACTIVITY_LOG_BYTES = 256 * 1024;
// `activity_log.rs`: an RFC 3339 UTC second, a short kind and one bounded line.
const ACTIVITY_LINE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z [A-Za-z0-9-]{1,32}: [^\r\n]{0,401}$/u;

function regularFile(path, maximum, label) {
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), `${label}: not a regular file`);
  assert.ok(stat.size <= maximum, `${label}: too large`);
  return readFileSync(path);
}

export function assertActivityLog(path, stage) {
  const label = `${stage}: invalid activity log`;
  const text = regularFile(path, MAX_ACTIVITY_LOG_BYTES, label).toString("utf8");
  assert.ok(text.endsWith("\n"), label);
  for (const line of text.slice(0, -1).split("\n")) assert.match(line, ACTIVITY_LINE, label);
}

export function assertTidyMarker(path, stage) {
  const label = `${stage}: invalid tidy-up record`;
  const marker = JSON.parse(regularFile(path, 4096, label).toString("utf8"));
  assert.deepEqual(Object.keys(marker).sort(), ["incompleteRuns", "version"], label);
  assert.ok(Number.isSafeInteger(marker.version) && marker.version >= 1, label);
  assert.ok(
    Number.isSafeInteger(marker.incompleteRuns) &&
      marker.incompleteRuns >= 0 &&
      marker.incompleteRuns <= 3,
    label,
  );
}

/**
 * Validate and remove the app's own diagnostics and tidy-up record from an
 * observed `{ files, directories }` data-folder snapshot. Their folders are
 * removed only when the baseline lacked them and nothing else is inside.
 * Returns the paths that were set aside, for evidence.
 */
export function setAsideAppMaintenance(dataRoot, observed, baselineDirectories, stage) {
  const setAside = [];
  for (const [path, check] of [
    [ACTIVITY_LOG, assertActivityLog],
    [TIDY_MARKER, assertTidyMarker],
  ]) {
    if (!Object.hasOwn(observed.files, path)) continue;
    check(join(dataRoot, ...path.split("/")), stage);
    delete observed.files[path];
    setAside.push(path);
  }
  for (const folder of ["logs", "maintenance"]) {
    if (baselineDirectories.includes(folder)) continue;
    const inside = (path) => path.startsWith(`${folder}/`);
    if (Object.keys(observed.files).some(inside) || observed.directories.some(inside)) continue;
    observed.directories = observed.directories.filter((path) => path !== folder);
  }
  return setAside;
}
