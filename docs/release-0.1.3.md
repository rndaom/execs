# 0.1.3 release candidate

Prepared September 6, 2026 from public `v0.1.2` (`64b7b81`) on
`rndaom/release-0.1.3`. This is a private candidate record. No 0.1.3 tag or
public release exists until the owner authorizes release.

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

## Local gates

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

## Candidate-only gates

The non-publishing release workflow must still pass on this exact commit. It
provides the genuine Ubuntu 22.04 compile, AppImage and `.deb` builds, Xvfb
startup, dpkg install, signed Windows NSIS updater, 0.1.2 upgrade/data
preservation, packaged notices and final two-platform `latest.json`
verification. Record its run and draft asset results here before declaring the
candidate ready to tag.

