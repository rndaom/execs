import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { verifyMinisign } from "../../verify-release.mjs";
import { qualifyPackagedWorker } from "./packaged-worker.mjs";

assert.equal(process.env.CI, "true");
assert.equal(process.platform, "win32");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
const source = process.env.CANDIDATE_SHA;
const expectedHash = process.env.INSTALLER_SHA256;
assert.match(source ?? "", /^[a-f0-9]{40}$/);
assert.match(expectedHash ?? "", /^[a-f0-9]{64}$/);
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 180000,
    ...options,
  });
assert.equal(run("git", ["rev-parse", "HEAD"]).trim(), source, "Build the exact candidate source");
const config = JSON.parse(readFileSync("apps/desktop/src-tauri/tauri.conf.json", "utf8"));
assert.equal(config.version, "0.1.7");
const scratch = join(process.env.RUNNER_TEMP, "execs-windows-candidate");
mkdirSync(scratch, { recursive: true });
const release = JSON.parse(
  run("gh", [
    "release",
    "view",
    "v0.1.7",
    "--repo",
    "rndaom/execs",
    "--json",
    "isDraft,tagName,assets,targetCommitish",
  ]),
);
assert.equal(release.isDraft, true, "This probe only consumes the private candidate");
assert.equal(release.tagName, "v0.1.7");
const name = "execs_0.1.7_x64-setup.exe";
const asset = release.assets.find((asset) => asset.name === name);
assert.ok(asset, "Candidate installer missing");
assert.equal(
  asset.digest,
  `sha256:${expectedHash}`,
  "Candidate installer changed since qualification was requested",
);
run("gh", [
  "release",
  "download",
  "v0.1.7",
  "--repo",
  "rndaom/execs",
  "--pattern",
  name,
  "--pattern",
  `${name}.sig`,
  "--dir",
  scratch,
]);
const bytes = readFileSync(join(scratch, name));
const sha256 = createHash("sha256").update(bytes).digest("hex");
assert.equal(sha256, expectedHash);
assert.equal(bytes.length, asset.size);
verifyMinisign(
  bytes,
  readFileSync(join(scratch, `${name}.sig`), "utf8"),
  config.plugins.updater.pubkey,
);
writeFileSync(
  join(scratch, "candidate-source.json"),
  `${JSON.stringify(
    {
      source,
      installer: name,
      installerSha256: sha256,
      signed: true,
      originalBuildRun: "35491010492",
      releaseTargetCommitish: release.targetCommitish,
      probeCommit: process.env.GITHUB_SHA,
    },
    null,
    2,
  )}\n`,
);
const install = join(scratch, "installed");
run(join(scratch, name), ["/S", `/D=${install}`]);
const application = join(install, "execs.exe");
const version = run(
  "powershell",
  [
    "-NoProfile",
    "-Command",
    "(Get-Item -LiteralPath $env:EXECS_PROBE_APP).VersionInfo.ProductVersion",
  ],
  {
    env: { ...process.env, EXECS_PROBE_APP: application },
  },
).trim();
assert.equal(version, "0.1.7");
await qualifyPackagedWorker(application, process.env, join(scratch, "files-worker"));
console.log(
  "PASS: existing signed Windows candidate executes its exact source worker under packaged CSP",
);
