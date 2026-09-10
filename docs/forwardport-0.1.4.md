# Maintenance integration into 0.2.0

This integration combines main `3939937` with the 0.1.4 maintenance candidate
and the maintenance history missing from main. It retains creator ZIP review
and profile-owned preloader selections. The four development version files
are 0.2.0; this branch does not publish that version.

Conflict resolution retains the newer maintenance HUD statistics, redirects,
draft guards and HUD containment. Creator archive review still verifies the
same open ZIP's hash before and after extraction; the archive compression
budget is passed to that extraction rather than opening a second file.
Profile switching validates the target before preparing its preloader and
uses the maintained HUD backup path during replacement.

The creator trust test now expects the credential warning first, matching the
maintained cfg validator. Reviewed imports preserve exact bytes, export still
refuses credentials, and a changed ZIP invalidates approval.

[PR #45](https://github.com/rndaom/execs/pull/45) merged into main at
`f0bfa7a14346baca1ea9f1edd0d269f9581d77f3`. Final local validation passes
418 desktop, 105 cfglint, 24 release-script and 700 Linux native/integration
tests, plus Biome, the production build, Rust formatting and Clippy. Frontend,
Windows and Linux CI also pass.

The integration includes [PR #46](https://github.com/rndaom/execs/pull/46):
the Linux AppImage output wrapper, host Wayland policy and artifact regression
check. The separately verified maintenance release
[0.1.4](https://github.com/rndaom/execs/releases/tag/v0.1.4) was published on
September 10 at 01:32 UTC (September 9 in America/New_York), following owner
authorization. See `docs/release-0.1.4.md` for signed upgrade, public download
and affected-host launch evidence.

The development version remains 0.2.0 and is not released. RND-251 remains
open for the cumulative live-game, Steam Cloud and Casual validation matrix.
