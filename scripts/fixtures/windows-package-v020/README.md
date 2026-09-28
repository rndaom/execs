# Current public Windows package fixture

These two ZIPs were emitted by the unmodified public **v0.2.0** core at
`486070f6e60bbcb5879acb5ae527d659d9d60ac1`. They are new exports of synthetic
cfg, VPK and HUD profiles, not renamed v0.1.8 archives. The payloads deliberately
match the older compatibility cases. The tagged core writes the VPKs and export
manifests itself; the smoke script authors only disposable library identities,
index, settings and TF2 root.

Generation verified all 127 extracted core files against the Git tag's blob
hashes, and all 96 registry dependencies against its Cargo.lock versions and
checksums. The retained harness asserts unchanged source libraries and synthetic
live files. No application, installer, Steam or TF2 was launched. No player files
were read. Both APPDATA and XDG_DATA_HOME were isolated inside the child process.

`fixture.json` retains the exact parsed export manifests, base64 payloads and ZIP
hashes. Every payload was checked against its manifest before recording it. The
ZIPs are retained unchanged as `no-hud.zip` and `single-hud.zip`; `generation.json`
records the generation checks. `harness/` retains the executed source and lock.

GitHub's current public release was checked with `gh release view` and the remote
annotated tag was resolved independently to the commit above. Its downloaded
`release-commit.json` reports run `36362601224` and the same commit. The Windows
installer and signature were downloaded using `gh release download`; their sizes
and SHA-256 hashes match GitHub's asset metadata. The installer signature passed
`verifyPublicPackage` against the product's configured updater public key. No
installer binary is included here. The fixture pins these metadata values and
refuses a changed public release, asset, signature, or publication time.

This Windows capability probe is independent of the development app version.
It installs only the current public build on an isolated GitHub-hosted worker,
checks genuine profile-menu input, reviews both custom packs, exports via the
native Save dialog, and verifies normal close and exact preservation. It does
not build or publish a release. The historical v0.1.8 fixtures and release
upgrade guards remain unchanged. Local unit and fixture checks do not substitute
for the complete hosted installer/WebView2 run.

## Reproduce the exports

Extract `apps/desktop/src-tauri/core` and `apps/desktop/src-tauri/Cargo.lock` from
`v0.2.0` into a new `tagged-source/` directory. Copy this retained `harness/`
beside it. From that harness run:

```text
cargo run --offline --locked -j1 -- <fresh absolute results directory>
```

The output directory must not exist. Offline execution requires the locked crates
in the local cache. ZIP byte hashes need not match a later execution's timestamp;
the retained ZIPs, their manifest values and every payload hash are the evidence
for this run. To refresh the public baseline, run the actual new public core and
check its release metadata, downloads and signature again; never relabel these
exports or remove the stale-baseline refusal.
