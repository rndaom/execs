# Current public package fixture

These two ZIPs were emitted by the unmodified public **v0.2.1** core at
`ebb2d507635f314675a481a0c8b5d683fb4502cf`. They are new exports of synthetic
cfg, VPK and HUD profiles, not relabeled v0.2.0 archives. The payloads deliberately
match the earlier compatibility cases. The tagged core writes the VPKs and export
manifests itself; the smoke scripts author only disposable library identities,
index, settings and TF2 root. Despite the directory name, the Linux development
package job uses the same exports (see [development-package-v021.md](../development-package-v021.md)).

Generation verified all 325 extracted files against the Git tag's blob hashes:
159 core files, the workspace Cargo.lock and 165 files of the vendored
`unrar-ng-sys` copy. All 121 registry dependencies match the tagged Cargo.lock
versions and checksums. The retained harness asserts unchanged source libraries
and synthetic live files. No application, installer, Steam or TF2 was launched.
No player files were read. Both APPDATA and XDG_DATA_HOME were isolated inside
the child process.

`fixture.json` retains the exact parsed export manifests, base64 payloads and ZIP
hashes. Every payload was checked against its manifest, and every ZIP member
against the manifest's file list, before recording it. The ZIPs are retained
unchanged as `no-hud.zip` and `single-hud.zip`; `generation.json` records the
generation checks. `harness/` retains the executed source and lock.

The harness is the v0.2.0 one with four changes, none to the exporter: the
revision and labels name v0.2.1, the mod record sets the new optional
`inactive_pack` field to `None` (the v0.2.1 struct requires it), and its
`Cargo.toml` applies the tagged workspace's `[patch.crates-io]` so `execs-core`
builds against the same vendored `unrar-ng-sys` the release does, rather than
the crates.io package. v0.2.0 had no RAR support and needed neither.

GitHub's current public release was checked with `gh release view` and the remote
annotated tag (`7231943e`) was resolved independently to the commit above. Its
downloaded `release-commit.json` reports run `36495684486` and the same commit.
The Windows installer, AppImage, Debian package and their signatures were
downloaded using `gh release download`; their sizes and SHA-256 hashes match
GitHub's asset metadata. All three signatures passed `verifyPublicPackage` against
the product's configured updater public key. No installer binary is included here.
The fixtures pin these metadata values and refuse a changed public release, asset,
signature, or publication time.

The Windows capability probe is independent of the development app version.
It installs only the current public build on an isolated GitHub-hosted worker,
checks genuine profile-menu input, reviews both custom packs, exports via the
native Save dialog, and verifies normal close and exact preservation. Public
v0.2.1 writes its activity log, tidy-up record, absorb hint and window placement
on start and close; the check validates and sets those aside as the Linux checks
do, and compares every other byte exactly. It does not build or publish a release. The historical release-upgrade fixture
(`package-smoke-v020.json`, from [windows-package-v020](../windows-package-v020/README.md))
and its guards remain unchanged. Local unit and fixture checks do not substitute
for the complete hosted installer/WebView2 run.

## Reproduce the exports

Extract `apps/desktop/src-tauri/core`, `apps/desktop/src-tauri/vendor/unrar-ng-sys`
and `apps/desktop/src-tauri/Cargo.lock` from `v0.2.1` into a new `tagged-source/`
directory. Copy this retained `harness/` beside it. From that harness run:

```text
cargo run --offline --locked -j1 -- <fresh absolute results directory>
```

The output directory must not exist. Offline execution requires the locked crates
in the local cache. On Windows, a short `CARGO_TARGET_DIR` avoids the 260-character
linker path limit. The unmodified core's write lock refuses to create the source
profiles while TF2 (`tf_win64.exe` or `tf.exe`) is running, even though only the
disposable root is written; close the game first. ZIP byte hashes need not match a
later execution's timestamp; the retained ZIPs, their manifest values and every
payload hash are the evidence for this run. To refresh the public baseline, run the
actual new public core and check its release metadata, downloads and signatures
again; never relabel these exports or remove the stale-baseline refusal.
