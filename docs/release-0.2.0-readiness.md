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

## Current integration and hosted checks

- [Inventory PR #137](https://github.com/rndaom/execs/pull/137) merged into `main`
  at `7353b7260b89ab0375679f5a919172226297b916`.
- [Release PR #136](https://github.com/rndaom/execs/pull/136) is open at
  `0ab52ed0a17487dedd438863f30a5e802984b2f9`, which incorporates that merge.
  Its earlier green head `27adf931` is historical evidence. The current PR is
  not green: [main CI](https://github.com/rndaom/execs/actions/runs/36331656478)
  and [release CI](https://github.com/rndaom/execs/actions/runs/36331793659)
  fail the Linux storage symlink fixture's stale Downloads byte expectation
  (1,380 expected; 1,400 observed after the comfig.app cache was restored).
- [Linux package checks](https://github.com/rndaom/execs/actions/runs/36331793662)
  stop at packaged credits verification: `CREDITS.txt` does not match
  `THIRD_PARTY.md`. Local repairs need fresh hosted checks before either failure
  can be marked resolved in the release evidence.
- Commit `c9169a76` restores the production comfig.app sound library and changes
  shared controls. This is an additional production delta requiring refreshed
  package evidence, as does Inventory now that release builds include it.
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

## Owner decision: Inventory ships in 0.2.0

On September 27, 2026 the owner decided that Inventory ships in 0.2.0: “it ships
in 0.2.0, it's ready, I tested it, it's good.” This replaces the earlier plan to
complete the [LIVE-TESTING.md](audits/2026-09-27-inventory-usability/LIVE-TESTING.md)
acceptance before enabling Inventory in release builds.

Release builds now include the Inventory sidebar entry and pane, its native read
and operation commands, and the `--inventory-read` and `--inventory-operation`
helper entry points. Only the release-build gating was removed. Single-use native
review tokens, exact account/capacity/raw-item baselines, the durable intent
journal written before any send, the write lock, reconciliation that never
replays a mutation and the refusal of the old direct Apply/Craft commands are
unchanged, and the browser test backpack keeps its simulator label.

The decision adds no results that were not reported. The owner tested the
Windows development app, including live crafting with unspecified recipes and
counts; agents moved, consumed or deleted no live item. Inventory has not run on
Linux or from a packaged build, and the candidate workflow's automated checks do
not contact Steam. Release builds enforce the app's content security policy,
which development builds do not; the pane's avatar, installed art and Steam
renders are `data:` and `blob:` images, which that policy allows.

Local Windows checks for this change: `pnpm test` (1,242 desktop tests, 170
cfglint tests and 111 script checks; five Linux-only script checks skip), Biome,
the production frontend build (existing large-chunk warning), rustfmt and
workspace Clippy with warnings denied pass. New frontend tests load the sidebar
groups and render the pane host with `DEV` off, and fail on the previous source;
the capability test expects live operations in every build while the old direct
commands still refuse. TF2 was open during the Rust workspace run: every
Inventory test passed, and 386 fixtures in unchanged code stopped at the normal
running-game guard, which was not bypassed, so the clean workspace result must
come from hosted CI or a rerun with TF2 closed. A local release-profile
executable (GUI subsystem; LTO off to save build time) answered
`--inventory-read` and `--inventory-operation` through a pipe with one prefixed
record each, refusing a missing Steam library and an empty request; rebuilt with
the previous `main.rs`, both printed nothing. No Steam session was opened.

## Remaining delta before shipping 0.2.0

Inventory is enabled in release builds in source, but no signed release
candidate has contained it yet.

1. Integrate the Inventory release enablement into the release branch.
2. Build the refreshed candidate in item 3 from a revision that includes it; the
   earlier candidate hid Inventory and cannot attest to it.
3. Integrate audit repairs, obtain green hosted Windows/Linux checks, and refresh
   the private signed candidate on the resulting revision. Verify the production
   Sounds and shared-control delta, package notices, and the signed upgrade from
   public v0.1.8. The previous successful candidate cannot attest to later code.
4. Keep PR #136's description and release notes aligned with the final code and
   test results. The September 27 follow-up corrected the PR and Linear
   descriptions: they now show the merged changes, failing hosted checks and
   still-local audit fixes. Recheck them when those fixes are integrated. Keep
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
