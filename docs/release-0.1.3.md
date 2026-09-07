# 0.1.3 release record

Prepared September 6, 2026 from public `v0.1.2` (`64b7b81`) on
`rndaom/release-0.1.3`. Published September 7, 2026 at 19:30 UTC after owner
authorization. The earlier candidate evidence is retained below.

## Scope

- RND-212: keep Binds recording available as a deferred profile draft while
  TF2 runs.
- RND-233: map DOM right and middle mouse buttons to Source `mouse2` and
  `mouse3` correctly.
- RND-234: synchronize tracked removals from the complete post-game
  `config.cfg` state.
- RND-253: preserve imported HUD options after matching a differently named
  local folder to its catalog identity, without merging a colliding pack.
- RND-254: stop absorb before the next restore, repair, config or Cloud
  mutation if TF2 starts mid-operation.
- RND-255: re-import execs profile exports containing small highly
  compressible assets while retaining entry, aggregate and byte limits.

## September 6 local gates

- All four product versions and the dated changelog section agree at 0.1.3.
- 104 cfglint tests, 360 desktop tests and 13 release-script tests pass.
- Locked Rust workspace tests pass: 98 Tauri crate tests and 556 core tests,
  with seven absorb-integrity integration tests; six live-network tests remain
  intentionally ignored.
- Biome, Rustfmt, strict all-target Clippy, production frontend build and
  `git diff --check` pass.
- The Windows release binary and unsigned NSIS installer build locally. The
  packaged binary starts outside the Codex MSIX identity and reports 0.1.3.
- Third-party notices cover 453 packages. pnpm and RustSec report no known
  vulnerabilities; RustSec retains 17 allowed upstream GTK/UNIC maintenance
  warnings.

## Real TF2 transition

Tested against the valid app-440 installation at
`D:\Steam\steamapps\common\Team Fortress 2` with Steam already running.

1. Snapshot the active manifest, live cfg, managed Binds cfg, Steam Cloud cfg,
   localconfig, part files and maintenance markers.
2. Launch the 0.1.3 release binary through Explorer; startup changes none of
   the snapshot targets and `GetPackageFullName` returns 15700 (no package
   identity).
3. Launch TF2 through execs. The real `tf_win64.exe` process appears and execs
   shows the running banner and disables heavy writes.
4. Record a Jump draft from `mwheeldown` to `f12`. Active manifest, live cfg,
   managed Binds cfg and Cloud cfg remain byte-identical while TF2 runs. Steam
   updates its own `localconfig.vdf` during launch, as expected.
5. After the TF2 process exits, execs clears the lock and writes the deferred
   Binds draft. Restore Jump to `mwheeldown`; the managed cfg returns to its
   exact pre-test hash. No `.execs-part` or maintenance marker remains.

TF2 ignored a normal `WM_CLOSE` request during this run, so the process was
stopped after a 30-second graceful-close timeout. The test proves the real
Steam launch, process detection, locked draft and process-exit transition; it
does not claim an in-menu quit-path check.

## Release infrastructure corrections

- Private dispatch and matching tag builds share one product-tag concurrency
  lock before either can mutate the draft release.
- A private dispatch requires the matching `vX.Y.Z` input and validates it
  against all product versions.
- Package smoke derives the immediately previous published version from
  ordered changelog history. The 0.1.3 candidate therefore tests the required
  0.1.2 to 0.1.3 signed updater path rather than the stale 0.1.1 path.

## Original candidate gates

The non-publishing release workflow was required before tagging. It
provides the genuine Ubuntu 22.04 compile, AppImage and `.deb` builds, Xvfb
startup, dpkg install, signed Windows NSIS updater, 0.1.2 upgrade/data
preservation, packaged notices and final two-platform `latest.json`
verification. The successful refreshed candidate and publication runs are
recorded below.

## September 7 candidate refresh

The release preparation includes the existing uncommitted GameBanana redirect
and archive-choice fixes, HUD cfg compatibility changes, and post-update
release-notes sheet. These additions are included in the 0.1.3 changelog.

Review corrected Rust formatting, joined wrapped changelog bullets in the
release-notes sheet, completed its bundled 0.1.3 notes, and guarded access to
unavailable webview storage so it cannot interrupt startup or update installation.
Regression tests cover wrapped notes, unavailable storage and the throwing
localStorage property getter at React startup.

The archive review also found that loose alternatives at different wrapper
depths could be silently dropped. Import now refuses that ambiguous selection;
the regression test covers default/materials alongside alternatives/red/materials.

Local verification: frontend suite, production frontend build, Biome, locked
Windows Rust workspace tests, strict all-target Clippy, Rustfmt, release-version
guard, packaged notices for 453 dependencies and whitespace checks pass.
The full pnpm advisory check reports no known vulnerabilities. A fresh
cargo-audit 0.22.2 scan of the product lockfile succeeds with 17 allowed upstream
warnings: 16 unmaintained dependencies and the existing GLib VariantStrIter
unsoundness advisory (RUSTSEC-2024-0429). The repository's affected-API source
check passes across the locked 404-package Linux graph; this remains a textual
check rather than a formal reachability proof.

All four normally ignored live network checks pass: GameBanana browsing and
categories, mastercomfig release digests, the comfig hitsound object, and stale
HUD thread rejection. The two PCF reference-corpus tests remain excluded.

A separate source-built probe links the actual public v0.1.2 core at 64b7b81
and the candidate core. It exports a fixture containing config.cfg, autoexec.cfg
and a 1 MiB highly compressible custom texture through the old exporter, then
imports through 0.1.3. All three manifest hashes and launch options survive;
the fixture's live files stay byte-identical. Probe and export are retained
under `.artifacts/profile-compat-probe` and `.artifacts/profile-compat-result`.
This checks the public exporter source, not UI interaction with the old binary.

Fresh visual inspection could not be completed: browser control had no connected
browser, and native desktop capture failed with unavailable input geometry and
missing foreground process identity. A shell attempt to open Edge was rejected
by automatic approval review with only "blocked by policy". No fresh screenshot
or in-game visual claim is made. Existing real-TF2 evidence above remains from
September 6; automated React startup and packaged startup are separate checks.

The earlier successful private workflow was
[34053212253](https://github.com/rndaom/execs/actions/runs/34053212253), for
`18f7065d9005ce8ff2fb71bd5abcfd1a17d0ada7`. It does not verify these new additions.
The refreshed non-publishing workflow below supersedes that earlier draft.
The public release remains 0.1.2 throughout preparation.

## Verified refreshed candidate

[Release workflow 34152571915](https://github.com/rndaom/execs/actions/runs/34152571915)
succeeded for implementation `b874383b6bee8f8f250c33c71f7823b0c553687c`.
Frontend validation, Windows/Linux Rust validation, both package builds,
both signed 0.1.2-to-0.1.3 upgrade checks and final artifact verification passed.
Publication was skipped as required for a private dispatch.

Downloaded Linux and Windows smoke reports independently confirm version 0.1.3,
previous version 0.1.2, verified signatures, installed updates, preserved user
data, packaged notices and successful packaged startup. The downloaded NSIS and
AppImage files also pass the local `verify-release.mjs` signature, size, digest
and updater-entry checks. `release-commit.json` matches this commit and run;
both generic platform entries are present and .deb is excluded from self-update.
Evidence and signed assets are in `.artifacts/release-0.1.3-34152571915/`.

Two additional DOM interaction tests pass for readable wrapped notes, Close,
Escape, the exact release link, missing-note fallback and link-open errors.
TypeScript and Biome pass with those tests. The follow-up evidence commit changes
only documentation and this test, leaving the verified product source unchanged.

The 0.1.3 Linear milestone records the complete frozen candidate scope; the next
minor already has its three-feature budget. GitHub has no open issues or pull
requests requiring patch triage. Tagging/publication, public-inbox closure and
milestone completion were reserved for release time. The fresh visual walkthrough
limitation above remains explicit; the automated release gates are complete.

## Published release

The owner authorized publication on September 7, 2026. Tag `v0.1.3` points to
`2dbec18022b7f1158d9ca216508cc5f25e65e404`; only the changelog date changed after
the final candidate evidence commit. [Publishing workflow 34154173866](https://github.com/rndaom/execs/actions/runs/34154173866)
passed all validation, Windows/Linux builds, both signed 0.1.2 upgrade checks,
final artifact verification and publication.

[execs v0.1.3](https://github.com/rndaom/execs/releases/tag/v0.1.3) became public
at 19:30:44 UTC. GitHub public latest and the canonical updater feed both resolve
to 0.1.3. Windows NSIS and Linux AppImage downloads and signature sidecars were
downloaded without authentication and independently verified against the public
release metadata, signing key and digests. Both updater asset URLs return binary
data without authentication with the updater's application/octet-stream header.
Release notes match the changelog, .deb is excluded from self-update, and
release-commit.json matches the tag commit and publishing workflow.

Evidence is retained under `.artifacts/public-0.1.3/`. All six tracked 0.1.3
Linear fixes are Done and the milestone records publication. No open GitHub
issues required release closure. The existing 0.1.4 and 0.2.0 milestones remain
the next work buckets; maintenance fixes still need to flow into 0.2.0.
