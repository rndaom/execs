// Run the actual public exporter and candidate importer against disposable data.
// The public checkout and results remain in the printed temporary directory.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: repo, encoding: "utf8", ...options });
const candidateTree = run("git", ["rev-parse", "HEAD:apps/desktop/src-tauri/core"]).trim();
if (run("git", ["status", "--porcelain", "--", "apps/desktop/src-tauri/core"]).trim()) {
  throw new Error("Commit candidate core changes before verifying provenance.");
}
const work = mkdtempSync(join(tmpdir(), "execs-public-compat-"));
const oldRepo = join(work, "public");
const helper = join(work, "probe");
run("git", ["worktree", "add", "--detach", oldRepo, "v0.1.5"], {
  stdio: "inherit",
});
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
old_core = { package = "execs-core", path = ${tomlPath(join(oldRepo, "apps/desktop/src-tauri/core"))} }
new_core = { package = "execs-core", path = ${tomlPath(join(repo, "apps/desktop/src-tauri/core"))} }
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
    EXECS_COMPAT_OLD_REPO: oldRepo,
    EXECS_COMPAT_NEW_REPO: repo,
    EXECS_COMPAT_NEW_TREE: candidateTree,
  },
});
