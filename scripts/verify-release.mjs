import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { changelogPath, releaseNotesFromChangelog } from "./release-notes.mjs";
import { parseReleaseVersion, releaseAssetVersion } from "./release-version.mjs";

// Tauri's public key and .sig files are base64-encoded Minisign text documents.
export function verifyMinisign(bytes, encodedSignature, encodedPublicKey) {
  const keyLines = Buffer.from(encodedPublicKey.trim(), "base64")
    .toString("utf8")
    .trim()
    .split(/\r?\n/);
  const lines = Buffer.from(encodedSignature.trim(), "base64")
    .toString("utf8")
    .trim()
    .split(/\r?\n/);
  assert.equal(lines.length, 4, "Expected a complete Minisign signature");
  assert.ok(lines[2].startsWith("trusted comment: "), "Missing trusted comment");
  const packet = Buffer.from(lines[1], "base64");
  const keyPacket = Buffer.from(keyLines[1], "base64");
  assert.equal(packet.length, 74);
  assert.equal(keyPacket.length, 42);
  assert.ok(packet.subarray(2, 10).equals(keyPacket.subarray(2, 10)), "Wrong signing key");
  const algorithm = packet.subarray(0, 2).toString();
  assert.ok(algorithm === "ED" || algorithm === "Ed", "Unsupported Minisign algorithm");
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), keyPacket.subarray(10)]),
    format: "der",
    type: "spki",
  });
  const signature = packet.subarray(10);
  const payload = algorithm === "ED" ? createHash("blake2b512").update(bytes).digest() : bytes;
  assert.ok(verify(null, payload, key, signature), "Artifact signature is invalid");
  assert.ok(
    verify(
      null,
      Buffer.concat([signature, Buffer.from(lines[2].slice(17))]),
      key,
      Buffer.from(lines[3], "base64"),
    ),
    "Trusted comment signature is invalid",
  );
}

export function verifyRelease(manifest, release, directory, version, publicKey) {
  parseReleaseVersion(version);
  assert.equal(manifest.version, version, "Updater version mismatch");
  assert.equal(release.tag_name, `v${version}`, "Release tag mismatch");
  assert.equal(release.draft, true, "Refusing to replace assets of an already public release");
  assert.equal(release.prerelease, false, "Product releases must not be prereleases");
  // GitHub and tauri-action can spell + as either + or %2B in URL paths.
  // Normalize only that encoding, never remove or reinterpret the revision.
  const sameUrl = (left, right) =>
    typeof left === "string" && left.replace(/%2b/gi, "+") === right.replace(/%2b/gi, "+");
  const platforms = { "windows-x86_64": ".exe", "linux-x86_64": ".AppImage" };
  for (const [platform, suffix] of Object.entries(platforms)) {
    const entry = manifest.platforms?.[platform];
    assert.ok(entry?.url && entry?.signature, `Incomplete ${platform} updater entry`);
    const asset = release.assets.find(
      (item) => sameUrl(item.url, entry.url) || sameUrl(item.browser_download_url, entry.url),
    );
    assert.ok(
      asset?.name.endsWith(suffix),
      `${platform} must reference this release's ${suffix} asset`,
    );
    assert.equal(basename(asset.name), asset.name, "Unsafe asset name");
    assert.ok(
      [version, releaseAssetVersion(version)].some((value) => asset.name.includes(`_${value}_`)),
      "Asset filename version mismatch",
    );
    const download = new URL(asset.browser_download_url);
    assert.equal(download.origin, "https://github.com", "Unexpected release download host");
    assert.equal(download.search + download.hash, "", "Unexpected release download suffix");
    const segments = download.pathname.split("/").map(decodeURIComponent);
    assert.equal(segments.length, 7, "Unexpected release download path");
    assert.deepEqual(
      segments.slice(3),
      ["releases", "download", `v${version}`, asset.name],
      "Asset URL must name this exact release tag and artifact",
    );
    const bytes = readFileSync(join(directory, asset.name));
    assert.equal(bytes.length, asset.size, "Downloaded asset size mismatch");
    const sidecar = readFileSync(join(directory, `${asset.name}.sig`), "utf8").trim();
    assert.equal(entry.signature.trim(), sidecar, "Updater signature disagrees with sidecar");
    verifyMinisign(bytes, sidecar, publicKey);
    if (asset.digest) {
      assert.equal(`sha256:${createHash("sha256").update(bytes).digest("hex")}`, asset.digest);
    }
  }
  for (const [alias, generic] of [
    ["windows-x86_64-nsis", "windows-x86_64"],
    ["linux-x86_64-appimage", "linux-x86_64"],
  ]) {
    if (manifest.platforms[alias])
      assert.deepEqual(manifest.platforms[alias], manifest.platforms[generic]);
  }
  delete manifest.platforms["linux-x86_64-deb"];
  return manifest;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [directory, version] = process.argv.slice(2);
  const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
  const manifest = verifyRelease(
    readJson(join(directory, "latest.json")),
    readJson(join(directory, "release.json")),
    directory,
    version,
    readJson("apps/desktop/src-tauri/tauri.conf.json").plugins.updater.pubkey,
  );
  // tauri-action initially writes the draft placeholder into the updater feed.
  // Publish the same substantive changelog notes as the GitHub release body.
  manifest.notes = releaseNotesFromChangelog(readFileSync(changelogPath(), "utf8"), version);
  writeFileSync(join(directory, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Verified signed Windows and Linux artifacts for ${version}`);
}
