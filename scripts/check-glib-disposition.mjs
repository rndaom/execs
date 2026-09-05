import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const metadata = JSON.parse(
  execFileSync(
    "cargo",
    [
      "metadata",
      "--locked",
      "--format-version",
      "1",
      "--filter-platform",
      "x86_64-unknown-linux-gnu",
      "--manifest-path",
      "apps/desktop/src-tauri/Cargo.toml",
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  ),
);
const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
const reachable = new Set();
function visit(id) {
  if (reachable.has(id)) return;
  reachable.add(id);
  for (const dependency of nodes.get(id)?.deps || []) visit(dependency.pkg);
}
visit(metadata.resolve.root);
const packages = metadata.packages.filter((pkg) => reachable.has(pkg.id));
const glib = packages.find((pkg) => pkg.name === "glib");
assert.equal(glib?.version, "0.18.5", "Reassess RND-205 when the Linux glib version changes");
const references = [];
function inspect(directory, pkg) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (["target", ".git", "node_modules"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) inspect(path, pkg);
    else if (entry.isFile() && entry.name.endsWith(".rs")) {
      const source = readFileSync(path, "utf8");
      if (/\b(?:VariantStrIter|array_iter_str)\b/.test(source))
        references.push(`${pkg.name}@${pkg.version}:${relative(dirname(pkg.manifest_path), path)}`);
    }
  }
}
for (const pkg of packages.filter((pkg) => pkg.id !== glib.id)) {
  // Only inspect each workspace package's own source; the Tauri root contains core and generated output.
  inspect(pkg.source ? dirname(pkg.manifest_path) : join(dirname(pkg.manifest_path), "src"), pkg);
}
assert.deepEqual(references, [], `Reassess RND-205: affected API references found: ${references}`);
console.log(
  JSON.stringify(
    {
      advisory: "RUSTSEC-2024-0429",
      disposition: "No affected API references outside glib in the locked Linux source graph",
      packages: packages.length,
      lockSha256: createHash("sha256")
        .update(readFileSync("apps/desktop/src-tauri/Cargo.lock"))
        .digest("hex"),
      limitations:
        "Textual source check, not a formal call-graph or generated-code reachability proof",
    },
    null,
    2,
  ),
);
