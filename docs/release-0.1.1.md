# 0.1.1 release candidate

This bugfix release branches from `843a830` (PR #39). Creator ZIP imports and
profile-owned preloader selections from PR #40 stay in 0.2.0. The release is
prepared separately so main can retain that work.

## Decisions

- Compatible internal recovery metadata needed to fix data loss is permitted in
  a patch. It must preserve older libraries/exports and existing write targets.
  New features and incompatible formats remain minor-release work.
- The owner confirmed on September 4 that the existing CompVMInstaller, Venom
  Crosshairs and TF2Hitsounds integrations should continue. Permission requests
  were courtesy outreach and have not received replies. This is the owner's
  release disposition, not a claim of an explicit license grant from an author.
  Existing pins and credits stay intact. Source/license evidence is recorded
  separately from that decision in THIRD_PARTY.md and the packaged notices.
- RUSTSEC-2024-0429 is retained as a documented dependency risk for this patch.
  glib 0.18.5 is inherited by Linux's GTK3/Tauri stack; blindly upgrading to the
  incompatible fixed glib line would not remove GTK3's dependency. The locked
  Linux source graph has no affected API reference outside glib itself. The
  fresh check covers 404 packages and is rerun in Linux CI. This is a textual
  source check, not a formal proof about generated code. Any affected API use,
  dependency version change, or relevant upstream fix requires reassessment.
  No application exploit or reachable crash through this iterator was found.
  See [RustSec](https://rustsec.org/advisories/RUSTSEC-2024-0429.html) and
  [the upstream fix](https://github.com/gtk-rs/gtk-rs-core/pull/1343).
- GTK3/proc-macro-error/unic maintenance advisories remain upstream maintenance
  risks; they are not counted as additional instances of the iterator defect.
- Authenticode is still planned separately. Minisign verification remains the
  update authenticity check; this patch does not change the updater key or URL.

## Packaged notices

`notices/DEPENDENCIES.txt` carries full notices for the 453 dependency packages
in the supported Windows/Linux build graphs and production JavaScript tree.
`notices/CONTENT.txt` carries the comfig screenshot and cvar reference licenses.
Crates that omit notices use version-specific, checked-in supplemental texts
retrieved from their recorded source revisions. Inter's full OFL and Phosphor's
MIT notice are included. Linux builds additionally include the builder's system
package copyright records and common license texts in `LINUX-SYSTEM.txt`.

The Tauri resource map installs these files under `notices/` beside the Windows
executable and in the Linux resource directory. The packaged smoke checks verify
that the notice bundle is actually present in Windows, AppImage and .deb output.
`node scripts/third-party-notices.mjs --check` fails if the locked inventory drifts.

## Release gates

- [ ] Exact-candidate frontend and Windows/Linux Rust CI passed.
- [ ] Public 0.1.0 profile fixture imports without changing its files.
- [ ] Real studiomdl build completes without visible child consoles.
- [ ] Windows signed updater installs over 0.1.0 in a disposable worker.
- [ ] Linux signed updater replaces a 0.1.0 AppImage; .deb installs and starts.
- [ ] Packaged apps start, preserve app data and carry the notice bundle.
- [ ] Both release artifacts verify against the unchanged production public key.
- [ ] Manual game/Cloud/recovery scenarios and limitations recorded below.
- [ ] Draft release contains the final notes and exact source commit evidence.

The Release workflow runs the reusable CI workflow before building, checks all
four versions and substantive notes, refuses overwriting a public release,
checks the actual updater-install paths, and verifies artifact signatures and
manifest URLs against the draft's assets. Manual runs leave the release a draft.
Only a version tag publishes after these gates succeed.

## Validation record

Results are filled in from the exact candidate, rather than inferred from
earlier PRs. No release has been published during preparation.
