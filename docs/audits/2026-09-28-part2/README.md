# Profile and customization fixes, part 2

This development work follows the [part 2 issue list](https://linear.app/rndaom/document/021-part-2-issue-list-8b5ca34b9603),
on top of `9bb166a0`, in [PR #145](https://github.com/rndaom/execs/pull/145).
It retains product version 0.2.0. It does not publish a release, tag, updater or installer.

## Scope and decisions

| Item | Result | Plan |
| --- | --- | --- |
| 1 | One stock cfg predicate protects shipped server/replay cfgs and game-owned Sixense bindings. Legacy manifests stop projecting them; old exports are verified before protected entries are skipped. | [Profile safety](profile-safety-plan.md) |
| 2 | After-game reconciliation validates menu values in each managed scope and edits only existing value tokens. | [Settings and Binds](settings-binds-plan.md) |
| 3 | Vanilla profiles show no selected preset and native/renderer gates prevent installing a loader over un-migrated cfgs. The issue's interim safety gate is used; automatic cfg migration is not implemented. | [Comfig](comfig-plan.md) |
| 4 | Exact 32-bit `tf.exe` detection joins existing Windows/Proton process names. | [Launch](launch-plan.md) |
| 5 | Release launch wait works with Steam open, checks TF2 twice, and ten-minute expiry retains the original start time across restart. | [Launch](launch-plan.md) |
| 6 | Every differing Steam value requires review, even with Steam closed. Adoption and replacement are tied to a fresh native baseline. Other operations leave Steam writes pending. | [Launch](launch-plan.md) |
| 7 | Fully owned HUD trees avoid duplicate live copies. Storage lists live/library backups and supports exact recovery to a chosen new folder or reviewed deletion. | [HUD storage](hud-storage-plan.md) |
| 8 | Journal-backed, install-bound material-bypass intent detects an external reset; recovery is explicit. | [Mods](mods-plan.md) |
| 9 | Optional package release/hash identity supports visible versions and same-release addon downloads. Unknown legacy versions require an explicit complete package update before adding addons. | [Comfig](comfig-plan.md) |
| 10 | Named per-pack decisions commit together and reject changed profile, inventory or library snapshots. | [Pack review](pack-prompt-plan.md) |
| 11 | World FOV offers 75–90; an older lower value displays its effective clamp without an unrelated rewrite. | [Settings and Binds](settings-binds-plan.md) |
| 12 | Packs retain byte identity while disabled, copy saved bytes to inactive profiles, and report GameBanana updates or unknown status. | [Mods](mods-plan.md) |
| 13 | Custom commands use cfg validation and existing key-conflict handling; class actions and voice choices are extended. | [Settings and Binds](settings-binds-plan.md) |
| 14 | Disposable metadata hints avoid hashing unchanged ordinary custom payloads during automatic absorb. Reviews, writes and switches still use full hashes. Incomplete scans refuse safely with the responsible path. | [Profile safety](profile-safety-plan.md) |

## Review and evidence

Focused workstreams researched source behavior, proposed plans, implemented fixes and ran regression
tests. A separate reviewer checked the plans and combined changes. Review corrections include
remaining automatic Steam writes, historical journal/ZIP compatibility and additive release metadata
in the older export schema. The existing shared components, colors, spacing and motion remain the
UI conventions.

Verification uses disposable filesystem fixtures and the browser preview. No player TF2, Steam
Cloud or profile library is modified for testing. Native process fixtures establish detection and
lock behavior; they do not replace retail TF2 acceptance on both operating systems. The vanilla
mastercomfig gate is intentional, not a claim that cfg migration is finished. Metadata hints cannot
detect every same-size edit with deliberately preserved timestamps; destructive operations never
trust those hints. GameBanana update timestamps indicate a newer listing, not which download variant
the player should choose.

## Final local verification

- `pnpm test`: 1,336 desktop tests, 171 cfglint tests and 114 script tests passed;
  five script tests skipped.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --locked -j1`:
  1,116 tests passed, 34 optional fixture/live-network tests ignored, no failures.
  The final run includes the corrected exact-byte Steam preservation assertion and regenerated
  disabled-mod serialization fixture. Its three frontend contract tests also passed separately.
- Workspace/all-target Clippy with `--locked -j1 -- -D warnings`, Rust formatting,
  `pnpm check`, `pnpm build`, and `git diff --check` passed. The production build retains the
  existing large-chunk advisory.
- Browser previews at 1200×800 and 960×640 checked Mods, Comfig, custom Binds, Gameplay,
  Steam replacement review and HUD recovery. Compact per-pack review names the profile,
  fits the viewport, and updates the switching consequences for mixed choices. Custom bind
  recording and Escape cancellation, disabled-mod status, copy dialog, FOV minimum 75,
  version/update text and Cancel focus were checked. No new layout defect was found.
- The public version files remain unchanged at 0.2.0. No release or tag was created.

The initial combined native run overlapped contract regeneration and failed only the old
serialization expectation. The complete suite above was rerun after regeneration and passed.
The first hosted native/package smoke runs then exposed their old no-cache fixture assumption.
The [reviewed fixture correction](review.md#hosted-fixture-compatibility-follow-up) accepts only
validated disposable hints and keeps the protected profile/live bytes exact. After that correction,
`node --test scripts/*.test.mjs` passed 151 tests with five platform skips; Biome and diff checks passed.
The next package run passed the cache checks and exposed an obsolete expectation that switching
tries an automatic Steam write. The harness now requires the exact native pending-review result,
then checks the imported UUID, complete disk projection and unchanged launch state after reopening.
The final script suite passed 154 tests with five platform skips; 39 targeted tests passed independent review.
Hosted checks on the pushed revision are available in [PR #145](https://github.com/rndaom/execs/pull/145/checks);
the earlier part 1 checks do not stand in for those checks. Retail gameplay, physical mouse
side buttons, native Linux UI and a packaged Steam round trip remain manual acceptance limits.
