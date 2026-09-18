# Creator ZIP import for 0.1.6

The owner reported `unexpected zip entry: cfg/user.scr` when importing another
player's cfg/custom ZIP on September 17, 2026.

## Cause

Public `v0.1.5` routes every profile ZIP through `classify_zip_entry`, which
accepts only `execs-profile.json`, `files/` and `blobs/`. A creator ZIP beginning
with `cfg/user.scr` fails at that format gate, before cfg validation. Removing
that file alone would only move the failure to the next cfg/custom entry.

Creator detection and review were implemented in PR #40 on main, but kept out
of the public maintenance releases. The source history establishes a missing
release feature; it does not establish which earlier build the reporter used.
The reported source ZIP was not supplied for this investigation.

## Maintenance adaptation

Branch `rndaom/0.1.6-creator-import` starts at public `v0.1.5`. The owner assigns
the bounded creator import feature (RND-201) to 0.1.6. It reuses main's import
reader, themed review, backend-owned single-use token and confirmation flow.
It excludes profile-owned preloader metadata and switch changes. The native
profile and ZIP schemas remain unchanged.

Creator cfg/custom roots can be wrapped or split across custom folders.
TF2 Advanced Options definitions in `cfg/user.scr` are preserved byte-for-byte.
Capture and absorb also retain this file in vanilla and mastercomfig setups. The
review discloses default config seeding, legacy hitsound relocation and cfg
findings. Approved cfg bytes remain unchanged. Native exports still use their
strict validation, including when a manifest is malformed. ZIP hash, root,
write lock, traversal, collisions, parser and archive limits remain checked.
Import creates a new library profile without changing the active setup.

## Initial backport validation

- The exact first-entry `cfg/user.scr` fixture passes review, import and explicit
  switch for root, `tf/`, wrapper and wrapper-plus-`tf/` layouts. It verifies
  skipped counts, preserved payload hashes and unchanged live/library state
  during review. Import alone preserves the active profile.
- Existing ZIP regressions cover split bundles, missing defaults, changed ZIP
  bytes, cfg trust, VPK privacy, malformed native manifests, traversal,
  collisions, compression limits and native schema-one round trips.
- Hook regressions cover review-before-save, picker/review cancellation,
  no automatic switch, game-running refusal and retained import errors.
- Windows workspace tests: 730 passed, 9 intentionally ignored.
- Frontend suite: 527 desktop and 140 cfglint tests passed; the subsequent
  expanded import-hook suite passed all 13 tests (three added).
- Release scripts: 21 passed, three platform-specific skips. Frontend lint,
  TypeScript/production build, Rust formatting and whitespace checks passed.
- Windows workspace Clippy passed with `--target x86_64-pc-windows-msvc` and
  warnings denied. The implicit-target invocation failed loading the external
  `phf_macros` dependency; the explicit target separates host procedural macros
  from the target's static-CRT build.

These counts record the initial backport, before the complete 0.1.6 integration.
The reporter's exact ZIP was not supplied. Final integration evidence follows.

The owner clarified that user.scr must be supported. The added lifecycle regression
checks capture, edited bytes (including CRLF), absorb, export/re-import and switching
to an empty profile and back, in both cfg layers and with case-varied filenames.
Other unrelated .scr files remain outside the loose cfg inventory.

## Independent maintenance audit (September 18)

RND-201's issue history assigns this backport to 0.1.6 and has no discussion
comments. The audit of `ebf3cce` and `0532160` found no additional production
change necessary: confirmation consumes the backend token, checks the current
install and game lock, verifies the opened ZIP before and after extraction, and
publishes an inactive profile through the existing creation transaction. Native
ZIP validation and the profile schema remain unchanged. Trusted creator cfg and
VPK contents are preserved, while private export remains refused.

Valve's installed TF2 `tf2_misc_dir.vpk` indexes `cfg/user_default.scr`, a
13,979-byte options definition in `tf2_misc_005.vpk`. The inspected app 440
installation reports PatchVersion 10828683; that definition's SHA-256 is
`d8f4cf14cebc84082b555fe4277f05aa5959cbd2b2e9f920252f43fe70b6b020`.
Its documented syntax describes cvar prompts, typed controls and defaults;
its actual definitions also contain categories, sliders and buttons. This
supports preserving Advanced Options definitions as opaque bytes instead of
processing them as console cfg commands. The archive was read only and its
payload is not vendored. No loose `cfg/user.scr` existed in this installation,
so this inspection does not claim an in-game custom-options smoke test.

The import dialog, profile-library hook and library helper suites passed all
30 tests independently. A new native regression checks that a successful review
cannot bypass a later game lock or library-root mismatch, with byte snapshots
confirming neither install nor the library changes.

## Integrated Windows verification

Windows Application Control initially refused the installed Rust compiler with
`os error 4551`. An official Rust 1.96.0 toolchain installed alongside it runs
successfully without changing security policy. The integrated Windows workspace
suite passes 769 tests, with 16 opt-in tests explicitly ignored by the normal
run; workspace Clippy also passes with warnings denied. This includes the
creator ZIP, user.scr lifecycle and confirmation-boundary regressions.

The actual public v0.1.5 core exports a synthetic profile that 0.1.6 imports into
both empty and active libraries, re-exports byte-for-byte unchanged, and imports
again. All 11 payloads, four mod records, HUD metadata, shared storage and ignored
packs survive; the active profile, source library and synthetic install trees
remain unchanged. This checks public-export compatibility without using the
installed profile library or launching TF2.

The signed candidate workflow
[35353749221](https://github.com/rndaom/execs/actions/runs/35353749221)
passed Windows/Linux validation, package builds and installer/updater checks;
publication was skipped. See the
[0.1.6 release record](release-0.1.6.md) for final integration provenance and gates.
