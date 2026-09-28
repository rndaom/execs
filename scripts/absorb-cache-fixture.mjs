import assert from "node:assert/strict";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

function encodedTime(nanos) {
  return {
    secs_since_epoch: Number(nanos / 1_000_000_000n),
    nanos_since_epoch: Number(nanos % 1_000_000_000n),
  };
}

export function fixtureCacheStamp(path) {
  const source = lstatSync(path, { bigint: true });
  assert.ok(source.isFile() && !source.isSymbolicLink(), `Invalid fixture cache source: ${path}`);
  return {
    len: Number(source.size),
    modified: encodedTime(source.mtimeNs),
    created: encodedTime(source.birthtimeNs),
    ...(process.platform === "win32"
      ? {}
      : {
          identity: [
            Number(source.dev),
            Number(source.ino),
            Number(source.ctimeNs / 1_000_000_000n),
            Number(source.ctimeNs % 1_000_000_000n),
          ],
        }),
  };
}

export function fixtureCacheSources(tf2Root, manifestFiles) {
  return Object.fromEntries(
    manifestFiles
      .filter(
        (file) =>
          file.path.toLowerCase().startsWith("tf/custom/") &&
          !file.path.toLowerCase().endsWith(".cfg"),
      )
      .map((file) => {
        const path = join(tf2Root, file.path);
        return [path, fixtureCacheStamp(path)];
      }),
  );
}

function systemTime(value, label) {
  assert.deepEqual(
    Object.keys(value ?? {}).sort(),
    ["nanos_since_epoch", "secs_since_epoch"],
    label,
  );
  assert.ok(Number.isSafeInteger(value.secs_since_epoch) && value.secs_since_epoch >= 0, label);
  assert.ok(
    Number.isInteger(value.nanos_since_epoch) &&
      value.nanos_since_epoch >= 0 &&
      value.nanos_since_epoch < 1_000_000_000,
    label,
  );
  return BigInt(value.secs_since_epoch) * 1_000_000_000n + BigInt(value.nanos_since_epoch);
}

/** Validate one known fixture profile's disposable hint, never a filename glob. */
export function assertFixtureAbsorbCache(
  library,
  tf2Root,
  profileId,
  manifestFiles,
  stage,
  initialStamps = {},
) {
  const cachePath = join(library, profileId, "absorb-cache.json");
  const metadata = lstatSync(cachePath);
  assert.ok(
    metadata.isFile() && !metadata.isSymbolicLink() && metadata.size <= 64 * 1024,
    `${stage}: invalid absorb cache file`,
  );
  const cache = JSON.parse(readFileSync(cachePath, "utf8"));
  assert.deepEqual(
    Object.keys(cache ?? {}),
    ["entries"],
    `${stage}: unexpected absorb cache fields`,
  );
  assert.ok(
    cache.entries && typeof cache.entries === "object" && !Array.isArray(cache.entries),
    `${stage}: invalid absorb cache entries`,
  );
  const expected = new Map(
    manifestFiles
      .filter(
        (file) =>
          file.path.toLowerCase().startsWith("tf/custom/") &&
          !file.path.toLowerCase().endsWith(".cfg"),
      )
      .map((file) => [join(tf2Root, file.path), file]),
  );
  for (const [path, entry] of Object.entries(cache.entries)) {
    const file = expected.get(path);
    assert.ok(file, `${stage}: unexpected absorb cache source: ${path}`);
    assert.deepEqual(
      Object.keys(entry ?? {}).sort(),
      ["sha256", "stamp"],
      `${stage}: invalid absorb cache entry`,
    );
    assert.equal(entry.sha256, file.sha256, `${stage}: absorb cache hash differs from fixture`);
    const keys = Object.keys(entry.stamp ?? {}).sort();
    assert.deepEqual(
      keys,
      process.platform === "win32"
        ? ["created", "len", "modified"]
        : ["created", "identity", "len", "modified"],
      `${stage}: invalid absorb cache stamp`,
    );
    systemTime(entry.stamp.modified, stage);
    if (entry.stamp.created !== null) systemTime(entry.stamp.created, stage);
    // Switching replaces the live file, while the prior profile keeps its
    // old disposable observation. Permit only the authored baseline or the
    // current verified source metadata, never an arbitrary stale stamp.
    const known = [fixtureCacheStamp(path), initialStamps[path]].filter(Boolean);
    assert.ok(
      known.some((stamp) =>
        isDeepStrictEqual(entry.stamp, {
          ...stamp,
          created: entry.stamp.created === null ? null : stamp.created,
        }),
      ),
      `${stage}: absorb cache stamp differs from fixture observations`,
    );
  }
}
