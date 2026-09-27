# 0.2.0 readiness — release audit, September 27, 2026

This updates readiness only. The owner explicitly requested no 0.2.0 release,
tag or publication. The previously completed release work remains accepted;
this checkpoint records the Inventory and production Sounds/control changes
without reopening unrelated Done issues or claiming new platform acceptance.

## Prior qualified baseline

- PR #60 merged the previous 0.2.0 scope into `main` at `acd39fb7`.
- [Private candidate 36313433526](https://github.com/rndaom/execs/actions/runs/36313433526)
  succeeded on `8e77a2219683e0a4450f21d1aaf9ed7cef95c0b0`, including Windows/Linux
  builds, signed updater upgrades from public v0.1.8, profile preservation and
  feed verification. This remains evidence for that exact prior candidate.
- The audit independently downloaded the draft Windows installer, Linux AppImage
  and deb, signature sidecars, updater feed and provenance record. All three
  installer signatures, published asset digests and four updater entries verified against
  the repository's updater public key. `release-commit.json` confirms the exact
  prior revision and run above; these artifacts do not include later changes.

## Audit starting point and hosted checks

The failures below describe the code tested at the start of the audit. The
audit fixes are now included in this release branch: the storage regression,
regenerated release-specific notices, dependency patches and Profiles keyboard
fix. Fresh results must come from [PR #136's checks](https://github.com/rndaom/execs/pull/136/checks)
on the updated revision; the earlier failed runs remain part of the record.

- [Inventory PR #137](https://github.com/rndaom/execs/pull/137) merged into `main`
  at `7353b7260b89ab0375679f5a919172226297b916`.
- At the start of the audit, [Release PR #136](https://github.com/rndaom/execs/pull/136) was at
  `0ab52ed0a17487dedd438863f30a5e802984b2f9`, which incorporates that merge.
  Its earlier green head `27adf931` is historical evidence. That revision was
  not green: [main CI](https://github.com/rndaom/execs/actions/runs/36331656478)
  and [release CI](https://github.com/rndaom/execs/actions/runs/36331793659)
  fail the Linux storage symlink fixture's stale Downloads byte expectation
  (1,380 expected; 1,400 observed after the comfig.app cache was restored).
- [Linux package checks](https://github.com/rndaom/execs/actions/runs/36331793662)
  stop at packaged credits verification: `CREDITS.txt` does not match
  `THIRD_PARTY.md`. The repairs need fresh hosted checks before either failure
  can be marked resolved in the release evidence.
- Commit `c9169a76` restores the production comfig.app sound library and changes
  shared controls. This is an additional production delta requiring refreshed
  package evidence even while Inventory remains development-only.
- A later owner request adds a Sounds preview volume dock (preview level, mute
  and Stop; previews only, never TF2's cvars or files). The owner tried it in the
  development app. It is part of the same production delta.
- The private draft still targets `8e77a221`; public v0.1.8 remains latest.
  All four product version files agree on 0.2.0. The release branch has the
  required nonempty 0.2.0 changelog section and passes the version guard; `main`
  intentionally retains those notes under Unreleased until release preparation
  is integrated. No tag or publication occurred during this audit.

## Inventory implementation checkpoint

The `rndaom/inventory-manager` work adds a ten-column, five-row backpack;
Ctrl/Shift selection; single/group drag/drop; repeating held-arrow page turns;
actual-slot sorting by name, quality and type; Undo/Redo; compact inspection;
account-owned protected favorites, saved layouts/searches and operation history.
Sorting leaves protected items fixed and uses the same reviewed layout path as
dragging. Compressed search results cannot be dragged as if they were real slots.

Native development builds support reviewed Steam moves, four plain tradable
metal conversions and confirmed single-item deletion. Exact account/raw-item
baselines, installed-schema eligibility, single-use review tokens, a durable
intent journal and complete-cache reconciliation guard every operation. Unknown
outcomes never replay automatically. The 10,000-move bound covers the supported
whole backpack. No unlicensed Jengerer implementation or product assets were
imported; the reference inspired an independent implementation.

After testing the updated development app, the owner reported: “Okay, I think it
works.” This records positive owner feedback on the current interaction flow.
It does not invent individual crafting/deletion, Linux, or packaged acceptance
results that were not supplied. Agents did not move, consume or delete live items.

A later pass the same day, which the owner called "absolutely perfect", adds
Valve's own item renders and description lines for a public Steam inventory
(painted weapons, war paints and kits look as in game), quoted Name Tags with
the original name, description tags, a TF2-style Inspect panel, batched metal
crafting and Valve's premium-only random hat recipe with a reveal. Those crafts
were exercised only in the simulator; a read-only test fetched the owner's real
inventory art through the app's network client. The owner then tested live
crafting in the development app and reported that it works. Which recipes and
counts were used was not specified, and Linux and packaged builds remain
untested.

## Remaining delta before shipping 0.2.0

Inventory is **still development-only in source**: production navigation and
rendering exclude it, native release commands refuse, and release helper entry
points cannot mutate. This is an explicit readiness item, not a claim that the
new manager is already in the signed release candidate.

1. Complete and record Inventory-specific live/platform acceptance using
   [LIVE-TESTING.md](audits/2026-09-27-inventory-usability/LIVE-TESTING.md), including
   exact in-game positions, the four metal recipes including a batch, a random
   hat, deletion, refusal and unknown-outcome recovery, and Steam item art. Preserve the owner's positive interaction feedback.
2. Enable the production Inventory surface and native entry points only with
   that qualification, then integrate the final changes into the release branch.
3. Obtain green hosted Windows/Linux checks for the audit repairs, and refresh
   the private signed candidate on the resulting revision. Verify the production
   Sounds and shared-control delta, package notices, and the signed upgrade from
   public v0.1.8. The previous successful candidate cannot attest to later code.
4. Keep PR #136's description and release notes aligned with the final code and
   test results. The September 27 follow-up corrected the PR and Linear
   descriptions. Recheck them against the new PR revision and its results. Keep
   development-only features clearly distinguished from what the release offers.
5. Keep publication waiting for a separate explicit owner request. Updating
   readiness or committing this work does not authorize tagging or publishing.

The earlier whole-application sign-offs remain intact. The work above is the
incremental Inventory/production-delta/revised-candidate gate, tracked under
existing RND-208.

## Validation of this checkpoint

The [September 27 release audit](audits/2026-09-27-release-readiness/README.md)
records the current repairs and remaining release gates. Fresh local checks:

- 1,223 desktop tests, 170 cfglint tests and 111 script checks pass; five
  Linux-only script checks skip on Windows. Biome, TypeScript and the production
  frontend build pass, with the existing large-chunk warning.
- Windows Rust workspace: 1,041 passed, 33 ignored. Inventory helper: 27 passed.
  Formatting and strict workspace/helper Clippy pass. After the rustls patch,
  the 145 application tests pass again (8 ignored), as does workspace Clippy.
- Patched Vitest to 4.1.11 and updater rustls to 0.23.45. Fresh application,
  promo and helper dependency audits report zero vulnerability findings. Desktop
  Rust retains six inherited maintenance warnings and the documented GLib
  unsoundness warning; its existing affected-API disposition check passes.
- Regenerated notices verify all 466 dependency packages. The Linux symlink
  regression now compares complete reports before/after the link; hosted Linux
  execution remains pending. A new ordinary-CI test catches stale credits.
- Fixture visual checks of Comfig, Sounds/library, Profiles and development
  Inventory fit at 1200×800 and 960×640. The repaired two-stage Profiles Escape
  behavior and focus return pass both regression and browser checks. This is
  fixture evidence, not live artwork/audio or native/package acceptance.
- AGENTS.md remains local and untracked; the public product specification is
  [ARCHITECTURE.md](ARCHITECTURE.md). The history/credential pattern audit found
  no recognizable secrets within its documented scope. No history was rewritten.

### Earlier implementation evidence

Art and crafting pass: 1,219 desktop tests, 170 cfglint tests, 1,039 Rust
workspace tests and 27 helper tests passed; Biome, workspace/helper Clippy,
rustfmt and the production build passed. Earlier counts follow.

- Full frontend suite: 1,206 desktop tests, 170 cfglint tests and 110 script
  checks passed; five platform-dependent script checks skipped.
- Standalone Inventory helper: 26 protocol/session/wire tests passed.
- Biome, TypeScript, workspace and helper Clippy with warnings denied pass.
  Rust formatting passes. The production frontend build passes with its existing
  large-chunk warning. The native development executable was rebuilt.
- Full Windows Rust workspace: 1,032 tests passed, 32 opt-in tests ignored.
  The first attempt stopped at five existing command-fixture tests with
  `GameRunning`; after the owner closed TF2, the complete rerun passed without
  bypassing the normal process guard.
- No new Linux, packaged or live mutation result is inferred from these checks.

The earlier audit and UI screenshots are dated history. Current behavior and
manual checks live in the linked Inventory testing document.
