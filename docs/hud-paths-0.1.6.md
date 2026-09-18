# Windows HUD install paths — RND-303

Assigned to 0.1.6 by the owner on September 17, 2026. Maintenance patch starts
from public `v0.1.5` (`9976464`). Forward-port the fix to main after integration.

## Root cause

HypnotizeHUD catalog revision `82d332540a82ab085ff1a14b9aef774982ac5b9e`
contains `materials/vgui/replay/thumbnails/flag_icons/objectives_flagpanel_compass_grey_with_red.vtf`.
The downloaded codeload ZIP SHA256 is
`73e8ed011c9b912eeb5bdbbae61c6539e14f9f61ddcc7171d2c542995504c241`.

Under the reporting host's ordinary Roaming profile path, the profile UUID,
`.mutation-data/<transaction>/new/tf/custom/hypnotizehud/` and `.execs-part`
make this staging filename 260 characters before the terminating NUL.
`LongPathsEnabled` is 0 on this host. Rust's filesystem functions create the
temporary file successfully, but the direct `MoveFileExW` calls in `hash.rs`
use ordinary paths and fail at the atomic replacement. The profile error
wrapper hides the operation and filename behind the generic library message.
The app manifest's `longPathAware` setting does not suffice without OS policy.

An isolated native Windows probe created a source file on a 388-character path:
`MoveFileExW` with flags 9 and ordinary paths returned false / Win32 error 3.
The same source and destination with the verbatim prefix succeeded, with
identical contents. No installed TF2 or real profile data was written.

## Prepared repair

Both atomic file replacement and no-replace directory backup moves convert
their endpoints through canonicalized parents. On Windows these are absolute
verbatim paths, including UNC handling. Leaves are appended unchanged: the
destination may not exist and a leaf link must not be dereferenced by the
conversion. Existing containment, link, atomicity and write-lock checks stay
in place. No registry change, renamed HUD asset or profile schema change.

Regression coverage adds long-path atomic creation/replacement and directory
movement, plus HUD install/update with the real long relative asset name and
checks for both library/live content and preservation of the previous HUD.

## Validation status

- Native Win32 reproduction: passed (ordinary paths fail with error 3;
  extended paths succeed).
- Rust formatting and diff whitespace checks: passed.
- Initial local Cargo attempts were blocked by Windows Application Control
  error 4551. An official side-by-side Rust 1.96.0 toolchain subsequently ran
  the full Windows workspace suite successfully without a security-policy change.
- Windows long-path regressions and actual pinned HypnotizeHUD install/update
  pass in disposable fixtures with `LongPathsEnabled=0`. The full candidate
  suite passes 769 native tests; workspace Clippy and formatting also pass.
- Previous-public profile compatibility passes. Final Linux CI and signed
  installer/updater results are tracked in [the release record](release-0.1.6.md).

Tracked in [RND-303](https://linear.app/rndaom/issue/RND-303/fix-windows-long-path-hud-installs-failing-with-profile-library-os).
