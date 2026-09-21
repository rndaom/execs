// Run the actual public exporter and candidate importer against disposable data.
// The public checkout and results remain in the printed temporary directory.
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const publicTag = "v0.1.7+2";
const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: repo, encoding: "utf8", ...options });
const candidateTree = run("git", ["rev-parse", "HEAD:apps/desktop/src-tauri/core"]).trim();
if (run("git", ["status", "--porcelain", "--", "apps/desktop/src-tauri/core"]).trim()) {
  throw new Error("Commit candidate core changes before verifying provenance.");
}
const work = mkdtempSync(join(tmpdir(), "execs-public-compat-"));
const publicRepo = join(work, "public");
const publicBuild = join(work, "public-build");
const helper = join(work, "probe");
run("git", ["worktree", "add", "--detach", publicRepo, publicTag], {
  stdio: "inherit",
});
// The next candidate can still carry the current public product version before
// release preparation. Cargo cannot lock two path packages with the same name
// and version, so compile a disposable copy of the verified public tree under a
// distinct probe-only build identity. The Rust probe still authenticates the
// untouched Git worktree, tag, commit and core tree before using its behavior.
cpSync(join(publicRepo, "apps/desktop/src-tauri/core"), publicBuild, { recursive: true });
const publicManifest = join(publicBuild, "Cargo.toml");
const publicManifestText = readFileSync(publicManifest, "utf8");
const publicBuildManifest = publicManifestText.replace(
  /^version = "0\.1\.7\+2"$/m,
  'version = "0.1.7+2.compat"',
);
if (publicBuildManifest === publicManifestText) {
  throw new Error("Public core version did not match the pinned compatibility baseline.");
}
writeFileSync(publicManifest, publicBuildManifest);
mkdirSync(join(helper, "src"), { recursive: true });
copyFileSync(join(repo, "scripts/compat-profile/main.rs"), join(helper, "src/main.rs"));
copyFileSync(join(repo, "apps/desktop/src-tauri/Cargo.lock"), join(helper, "Cargo.lock"));
const tomlPath = (path) => JSON.stringify(path.replaceAll("\\", "/"));
writeFileSync(
  join(helper, "Cargo.toml"),
  `[package]
name = "execs-public-export-compat"
version = "0.1.0"
edition = "2021"
publish = false

[dependencies]
public_core = { package = "execs-core", path = ${tomlPath(publicBuild)} }
candidate_core = { package = "execs-core", path = ${tomlPath(join(repo, "apps/desktop/src-tauri/core"))} }
serde_json = "1"
zip = { version = "2", default-features = false, features = ["deflate"] }

[workspace]
`,
);
console.log(`Compatibility fixture and results: ${helper}`);
run("cargo", ["run", "--offline", "--manifest-path", join(helper, "Cargo.toml"), "--", "result"], {
  stdio: "inherit",
  env: {
    ...process.env,
    EXECS_COMPAT_PUBLIC_REPO: publicRepo,
    EXECS_COMPAT_CANDIDATE_REPO: repo,
    EXECS_COMPAT_CANDIDATE_TREE: candidateTree,
  },
});
