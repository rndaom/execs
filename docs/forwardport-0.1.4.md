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

Local validation: 690 Windows Rust tests; frontend/cfglint and release tests;
Biome, production build, Rust formatting and Clippy. CI provides the separate
Linux check. The 0.1.4 private release candidate is built from its maintenance
branch, independently of this integration. Neither branch authorizes a tag,
public release, or closing the cumulative live-game validation gate.

The September 9 integration also carries PR #46: the Linux AppImage output
wrapper, host Wayland policy, and artifact regression check. The development
version remains 0.2.0; only the separately verified 0.1.4 maintenance candidate
is authorized for publication.
