// Download pinned upstream data outside the checkout; never target a real install.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const work = mkdtempSync(join(tmpdir(), "execs-pinned-huds-"));
const cases = join(work, "cases");
const catalog = join(work, "catalog");
mkdirSync(catalog, { recursive: true });
const fixtures = JSON.parse(
  readFileSync(join(import.meta.dirname, "hud-regression-fixtures.json"), "utf8"),
);
async function download(url, sha256, destination) {
  const response = await fetch(url, {
    headers: { "User-Agent": "execs-release-verification (+https://github.com/rndaom/execs)" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) {
    throw new Error(`Pinned fixture hash mismatch: ${url}`);
  }
  writeFileSync(destination, bytes);
}
for (const fixture of fixtures) {
  const destination = join(cases, fixture.id);
  mkdirSync(destination, { recursive: true });
  await download(fixture.archiveUrl, fixture.archiveSha256, join(destination, "archive.bin"));
  await download(fixture.schemaUrl, fixture.schemaSha256, join(destination, "schema.json"));
}
for (const [name, url, hash] of [
  [
    "hypnotizehud.zip",
    "https://codeload.github.com/Hypnootize/hypnotizehud/zip/82d332540a82ab085ff1a14b9aef774982ac5b9e",
    "73e8ed011c9b912eeb5bdbbae61c6539e14f9f61ddcc7171d2c542995504c241",
  ],
  [
    "kinhud.zip",
    "https://codeload.github.com/kindredtf/kinhud/zip/ed528471a18eaaea7b97db689050491ab2db3316",
    "6e851dd05357817f3fe1046ef1285069c71787b2bf6160ca90d4e9a1d710e9d0",
  ],
  [
    "m0re-rockz.zip",
    "https://codeload.github.com/rrkkss/m0re-edit/zip/431e2e9eb9f37e51fc3c4f679b2c3ed5a54ed5ca",
    "5c8a7022d73b6521dd6fd3f269644f4d0723a6db46dfd021b386dc4830c6bba9",
  ],
])
  await download(url, hash, join(catalog, name));
const options = {
  cwd: repo,
  stdio: "inherit",
  env: { ...process.env, EXECS_HUD_AUDIT_FIXTURES: cases, EXECS_HUD_FIXTURES: catalog },
};
const cargo = [
  "test",
  "--manifest-path",
  "apps/desktop/src-tauri/Cargo.toml",
  "-p",
  "execs-core",
  "--locked",
];
console.log(`Pinned HUD fixture evidence: ${work}`);
execFileSync(
  "cargo",
  [
    ...cargo,
    "--test",
    "hud_catalog_options",
    "--test",
    "hud_expression_archives",
    "--",
    "--ignored",
  ],
  options,
);
execFileSync(
  "cargo",
  [...cargo, "pinned_catalog_huds_install_update_and_preserve_payloads", "--", "--ignored"],
  options,
);
