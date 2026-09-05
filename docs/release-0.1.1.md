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

- [x] Candidate frontend and Windows/Linux Rust CI passed at `80f5345`.
- [x] Public 0.1.0 profile fixture imports without changing its files.
- [x] Real studiomdl builds complete with `CREATE_NO_WINDOW` enabled.
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

No release has been published during preparation. Product-source checks below
use `80f5345`; later release-script/documentation changes require fresh CI and
installer validation before the candidate is frozen.

| Check | Result |
|---|---|
| [CI run 33933994635](https://github.com/rndaom/execs/actions/runs/33933994635) | Frontend, Rust Windows and Rust Linux passed. Release run 33933994057 independently passed the same reusable CI gates. |
| Local frontend | 391 tests passed (104 cfglint, 276 desktop, 11 release scripts), Biome clean, TypeScript/Vite production build passed. The existing large-chunk advisory remains. |
| Local Windows Rust | Format, locked Clippy with all targets and the release probe, and 626 workspace tests passed. Four normally ignored live-service tests also passed explicitly. The two optional PCF reference-corpus tests require an unavailable external corpus. |
| Public compatibility | The exact candidate core, built using its committed lockfile, loaded a library captured by public v0.1.0 and imported its ZIP. All three synthetic cfg/custom files and `-novid` launch options were preserved byte-for-byte; the imported profile stayed inactive. Earlier base validation also confirmed a re-export could be read by public v0.1.0. This is source-level fixture evidence, not a test of every historical profile. |
| Actual viewmodel compiler | The pinned archive (SHA-256 `68b14e6537d1ee3b8b2d0cc1e92f12d4a7fd0f68eb5f12d2f0aa3231a60ee9c3`) and installed TF2 `studiomdl.exe` compiled all 64 groups across all nine classes. Full-hide output: 2,705,830 bytes in 6.18 seconds; weapon-only: 3,573,214 bytes in 8.44 seconds. Both VPKs parsed and contained all nine MDLs. Writes stayed in temporary staging. No in-game rendering or visual console-window observation is claimed. |
| Live sources | mastercomfig VPK digests, comfig sound resolution, HUD thread resolution, and GameBanana browse/search/install-policy tests passed on the candidate. |
| Signature verifier | Both real published 0.1.0 artifacts passed signature, sidecar, asset-size, release-URL and digest verification against the unchanged production public key. Negative tests reject altered bytes, signatures, keys and trusted comments. |

## Field validation still required before publication

Automated regressions cover Cloud dual writes and retry markers, autosave
deferral/flush, process resampling at live-write boundaries, interrupted profile
recovery, byte-exact preloader rollback, and a resized/replaced game archive.
These passed on the candidate. They use controlled fixtures and injected races;
they do not establish a real Steam Cloud server round trip or Casual-server
acceptance of the installed artifacts.

The remaining field pass uses a backed-up test profile on a spare TF2 install:

1. Capture, switch and absorb with Steam Cloud enabled, disabled and offline;
   restart Steam/TF2 and confirm cfg, packs and pending Cloud writes persist.
2. Change a setting immediately before switching profiles; start TF2 while a
   mutation is pending, confirm writes stop and the draft saves after it exits.
3. Apply/restore preload, restart after an interrupted operation, and validate
   restore after a game update. Confirm stock bytes and a Casual-server join.

The user's live library/game has not been downgraded, rewritten or interrupted
to manufacture this evidence. A green installer workflow does not check these
field items automatically.
